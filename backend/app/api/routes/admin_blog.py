"""The administrators' side of the blog: the queue of articles waiting for approval, removing and restoring, hiding comments, trusted authors.
Every decision is recorded in the audit trail."""
from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.api.deps import AuthContext, get_db, require_admin_mfa, require_admin_write
from app.core.exceptions import ConflictError, NotFoundError
from app.repositories import blog as repo
from app.schemas.blog import AdminPostOut, AdminPostPageOut, AdminPostRowOut, ListingCardOut, PostStatus, ReasonIn, TrustedIn
from app.services import admin_audit
from app.services import blog as svc
from app.services import notifications as notifications_service

router = APIRouter(prefix="/api/admin/blog", tags=["admin"])


def _row(r: dict) -> AdminPostRowOut:
    return AdminPostRowOut(**{k: r[k] for k in AdminPostRowOut.model_fields})


async def _full(conn: asyncpg.Connection, post_id: UUID) -> AdminPostOut:
    r = await repo.admin_get(conn, post_id)
    if r is None:
        raise NotFoundError("Статья не найдена.", code="post_not_found")
    listing = await repo.listing_card(conn, r["listing_id"])
    return AdminPostOut(
        **_row(r).model_dump(), blocks=r["body"], image_ids=list(r["image_ids"]), listing=ListingCardOut(**listing) if listing else None,
        likes_count=r["likes_count"], comments_count=r["comments_count"],
    )


@router.get("/posts", response_model=AdminPostPageOut)
async def list_posts(
    status: PostStatus | None = None,
    q: str | None = Query(default=None, max_length=100),
    with_complaints: bool = False,
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=1_000_000),
    ctx: AuthContext = Depends(require_admin_mfa),
    conn: asyncpg.Connection = Depends(get_db),
) -> AdminPostPageOut:
    total, rows = await repo.admin_list(conn, status=status, query=q, with_complaints=with_complaints, limit=limit, offset=offset)
    return AdminPostPageOut(total=total, limit=limit, offset=offset, items=[_row(r) for r in rows])


@router.get("/pending-count")
async def pending_count(ctx: AuthContext = Depends(require_admin_mfa), conn: asyncpg.Connection = Depends(get_db)) -> dict[str, int]:
    return {"pending": await repo.pending_count(conn)}


@router.get("/posts/{post_id}", response_model=AdminPostOut)
async def post_detail(post_id: UUID, ctx: AuthContext = Depends(require_admin_mfa), conn: asyncpg.Connection = Depends(get_db)) -> AdminPostOut:
    return await _full(conn, post_id)


async def _decide(
    conn: asyncpg.Connection, ctx: AuthContext, post_id: UUID, *, status: str, action: str, reason: str | None, notify: str | None
) -> AdminPostOut:
    try:
        async with conn.transaction():
            before = await repo.review(conn, post_id, ctx.user["id"], status=status, reason=reason)
            if before is None:
                raise NotFoundError("Статья не найдена.", code="post_not_found")
            await admin_audit.record(
                conn, ctx.user["id"], action, target_type="post", target_id=post_id, reason=reason,
                before={"status": before["status"]}, after={"status": status}, extra={"title": before["title"], "author_id": before["author_id"]},
            )
            if notify == "approved":
                await notifications_service.schedule_post_review_notification(conn, before, approved=True)
            elif notify == "rejected":
                await notifications_service.schedule_post_review_notification(conn, before, approved=False, reason=reason)
    except repo.BadTransition as exc:
        raise ConflictError(f"Статья уже в статусе «{exc.current}».", code="bad_transition") from None
    svc.forget_picks()
    return await _full(conn, post_id)


@router.post("/posts/{post_id}/approve", response_model=AdminPostOut)
async def approve(post_id: UUID, ctx: AuthContext = Depends(require_admin_write), conn: asyncpg.Connection = Depends(get_db)) -> AdminPostOut:
    return await _decide(conn, ctx, post_id, status="published", action="post_approve", reason=None, notify="approved")


@router.post("/posts/{post_id}/reject", response_model=AdminPostOut)
async def reject(post_id: UUID, payload: ReasonIn, ctx: AuthContext = Depends(require_admin_write), conn: asyncpg.Connection = Depends(get_db)) -> AdminPostOut:
    return await _decide(conn, ctx, post_id, status="rejected", action="post_reject", reason=payload.reason, notify="rejected")


@router.post("/posts/{post_id}/remove", response_model=AdminPostOut)
async def remove(post_id: UUID, payload: ReasonIn, ctx: AuthContext = Depends(require_admin_write), conn: asyncpg.Connection = Depends(get_db)) -> AdminPostOut:
    return await _decide(conn, ctx, post_id, status="removed", action="post_remove", reason=payload.reason, notify="rejected")


@router.post("/posts/{post_id}/restore", response_model=AdminPostOut)
async def restore(post_id: UUID, ctx: AuthContext = Depends(require_admin_write), conn: asyncpg.Connection = Depends(get_db)) -> AdminPostOut:
    return await _decide(conn, ctx, post_id, status="published", action="post_restore", reason=None, notify=None)


@router.post("/comments/{comment_id}/hide", status_code=204, response_model=None)
async def hide_comment(
    comment_id: UUID, payload: ReasonIn, ctx: AuthContext = Depends(require_admin_write), conn: asyncpg.Connection = Depends(get_db)
) -> None:
    async with conn.transaction():
        row = await repo.hide_comment(conn, comment_id, ctx.user["id"], payload.reason)
        if row is None:
            raise NotFoundError("Комментарий не найден.", code="comment_not_found")
        await admin_audit.record(
            conn, ctx.user["id"], "post_comment_hide", target_type="post_comment", target_id=comment_id, reason=payload.reason,
            extra={"post_id": row["post_id"], "author_id": row["author_id"]},
        )


@router.get("/authors/{user_id}")
async def author_summary(user_id: UUID, ctx: AuthContext = Depends(require_admin_mfa), conn: asyncpg.Connection = Depends(get_db)) -> dict:
    row = await repo.author_summary(conn, user_id)
    if row is None:
        raise NotFoundError("Пользователь не найден.", code="user_not_found")
    return row


@router.put("/authors/{user_id}/trusted", status_code=204, response_model=None)
async def set_trusted(
    user_id: UUID, payload: TrustedIn, ctx: AuthContext = Depends(require_admin_write), conn: asyncpg.Connection = Depends(get_db)
) -> None:
    """A trusted author's articles go live after the automatic check, without waiting for an administrator."""
    async with conn.transaction():
        if not await repo.set_trusted(conn, user_id, ctx.user["id"], payload.trusted):
            raise NotFoundError("Пользователь не найден.", code="user_not_found")
        await admin_audit.record(
            conn, ctx.user["id"], "post_author_trusted" if payload.trusted else "post_author_untrusted", target_type="user", target_id=user_id,
            after={"trusted": payload.trusted},
        )
