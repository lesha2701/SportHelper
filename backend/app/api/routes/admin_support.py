"""The administrators' queue of support requests. Taking, answering and closing are recorded in the audit trail. Every message of
the administrators is e-mailed to the author (when the server can send mail) and is always shown to them in «Поддержка» on the site."""
from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, BackgroundTasks, Depends, Query

from app.api.deps import AuthContext, get_db, get_settings_dep, require_admin_mfa, require_admin_write
from app.config import Settings
from app.core.exceptions import ConflictError, NotFoundError
from app.repositories import support as support_repo
from app.schemas.admin import PersonOut
from app.schemas.support import AnswerSupportIn, CloseSupportIn, SupportKind, SupportMessageOut, SupportPageOut, SupportRequestOut, SupportStatus
from app.services import accounts as accounts_service
from app.services import admin_audit
from app.services import email_templates as templates

router = APIRouter(prefix="/api/admin/support", tags=["admin"])


def _name(first: str | None, last: str | None) -> str:
    return " ".join(part for part in (first, last) if part)


def _out(r: dict) -> SupportRequestOut:
    return SupportRequestOut(
        id=r["id"],
        kind=r["kind"],
        subject=r["subject"],
        body=r["body"],
        status=r["status"],
        created_at=r["created_at"],
        author=PersonOut(id=r["author_id"], name=_name(r["author_first_name"], r["author_last_name"]), email=r["author_email"]),
        messages=[SupportMessageOut(**m) for m in r["messages"]],
        handled_by=r["handled_by_email"],
        handled_at=r["handled_at"],
    )


async def _get(conn: asyncpg.Connection, request_id: UUID) -> SupportRequestOut:
    row = await support_repo.get_request(conn, request_id)
    if row is None:
        raise NotFoundError("support request not found")
    return _out(row)


@router.get("", response_model=SupportPageOut)
async def list_requests(
    status: SupportStatus | None = None,
    kind: SupportKind | None = None,
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=1_000_000),
    ctx: AuthContext = Depends(require_admin_mfa),
    conn: asyncpg.Connection = Depends(get_db),
) -> SupportPageOut:
    total, rows = await support_repo.list_requests(conn, status=status, kind=kind, query=q, limit=limit, offset=offset)
    return SupportPageOut(total=total, limit=limit, offset=offset, items=[_out(r) for r in rows])


@router.get("/{request_id}", response_model=SupportRequestOut)
async def request_detail(
    request_id: UUID, ctx: AuthContext = Depends(require_admin_mfa), conn: asyncpg.Connection = Depends(get_db)
) -> SupportRequestOut:
    return await _get(conn, request_id)


@router.post("/{request_id}/take", response_model=SupportRequestOut)
async def take_request(
    request_id: UUID, ctx: AuthContext = Depends(require_admin_write), conn: asyncpg.Connection = Depends(get_db)
) -> SupportRequestOut:
    before = await _get(conn, request_id)
    try:
        async with conn.transaction():
            if not await support_repo.take(conn, request_id, ctx.user["id"]):
                raise NotFoundError("support request not found")
            await admin_audit.record(
                conn, ctx.user["id"], "support_take", target_type="support_request", target_id=request_id,
                before={"status": before.status}, after={"status": "in_progress"}, extra={"kind": before.kind},
            )
    except support_repo.BadTransition as exc:
        raise ConflictError(f"Обращение уже в статусе «{exc.current}».", code="bad_transition") from None
    return await _get(conn, request_id)


@router.post("/{request_id}/answer", response_model=SupportRequestOut)
async def answer_request(
    request_id: UUID,
    payload: AnswerSupportIn,
    background: BackgroundTasks,
    ctx: AuthContext = Depends(require_admin_write),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> SupportRequestOut:
    before = await _get(conn, request_id)
    try:
        async with conn.transaction():
            if not await support_repo.answer(conn, request_id, ctx.user["id"], payload.answer):
                raise NotFoundError("support request not found")
            await admin_audit.record(
                conn, ctx.user["id"], "support_answer", target_type="support_request", target_id=request_id,
                before={"status": before.status}, after={"status": "answered"}, extra={"kind": before.kind},
            )
    except support_repo.BadTransition as exc:
        raise ConflictError(f"Обращение закрыто, в нём больше нельзя писать (статус «{exc.current}»).", code="bad_transition") from None
    if before.author.email:
        first_name = before.author.name.split(" ")[0] if before.author.name else ""
        accounts_service.queue_email(
            background, templates.support_answer_email(settings, before.author.email, first_name, before.subject, payload.answer), settings
        )
    return await _get(conn, request_id)


@router.post("/{request_id}/close", response_model=SupportRequestOut)
async def close_request(
    request_id: UUID,
    payload: CloseSupportIn,
    ctx: AuthContext = Depends(require_admin_write),
    conn: asyncpg.Connection = Depends(get_db),
) -> SupportRequestOut:
    before = await _get(conn, request_id)
    try:
        async with conn.transaction():
            if not await support_repo.close(conn, request_id, ctx.user["id"]):
                raise NotFoundError("support request not found")
            await admin_audit.record(
                conn, ctx.user["id"], "support_close", target_type="support_request", target_id=request_id, reason=payload.note,
                before={"status": before.status}, after={"status": "closed"}, extra={"kind": before.kind},
            )
    except support_repo.BadTransition as exc:
        raise ConflictError(f"Обращение уже обработано (статус «{exc.current}»).", code="bad_transition") from None
    return await _get(conn, request_id)
