"""The administrators' queue of complaints. Taking a complaint and deciding it are recorded in the audit trail;
acting on the reported thing (blocking, hiding) uses the ordinary moderation endpoints - the decision here records
the outcome."""
from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.api.deps import AuthContext, get_db, require_admin_mfa, require_admin_write
from app.core.exceptions import ConflictError, NotFoundError
from app.repositories import complaints as complaints_repo
from app.schemas.admin import (
    ComplaintOut,
    ComplaintReason,
    ComplaintsPageOut,
    ComplaintStatus,
    ComplaintTarget,
    ComplaintTargetOut,
    PersonOut,
    ResolveComplaintIn,
)
from app.services import admin_audit

router = APIRouter(prefix="/api/admin/complaints", tags=["admin"])


def _name(first: str | None, last: str | None) -> str:
    return " ".join(part for part in (first, last) if part)


def _out(r: dict) -> ComplaintOut:
    owner = (
        PersonOut(id=r["target_user_id"], name=_name(r["target_user_first_name"], r["target_user_last_name"]), email=r["target_user_email"])
        if r["target_user_id"]
        else None
    )
    return ComplaintOut(
        id=r["id"],
        status=r["status"],
        reason=r["reason"],
        comment=r["comment"],
        created_at=r["created_at"],
        reporter=PersonOut(id=r["reporter_id"], name=_name(r["reporter_first_name"], r["reporter_last_name"]), email=r["reporter_email"]),
        target=ComplaintTargetOut(type=r["target_type"], id=r["target_id"], label=r["target_label"], state=r["target_state"], owner=owner),
        other_open_on_target=r["other_open"],
        handled_by=r["handled_by_email"],
        handled_at=r["handled_at"],
        resolution=r["resolution"],
    )


async def _get(conn: asyncpg.Connection, complaint_id: UUID) -> ComplaintOut:
    row = await complaints_repo.get_complaint(conn, complaint_id)
    if row is None:
        raise NotFoundError("complaint not found")
    return _out(row)


@router.get("", response_model=ComplaintsPageOut)
async def list_complaints(
    status: ComplaintStatus | None = None,
    target_type: ComplaintTarget | None = None,
    reason: ComplaintReason | None = None,
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=1_000_000),
    ctx: AuthContext = Depends(require_admin_mfa),
    conn: asyncpg.Connection = Depends(get_db),
) -> ComplaintsPageOut:
    total, rows = await complaints_repo.list_complaints(
        conn, status=status, target_type=target_type, reason=reason, query=q, limit=limit, offset=offset
    )
    return ComplaintsPageOut(total=total, limit=limit, offset=offset, items=[_out(r) for r in rows])


@router.get("/{complaint_id}", response_model=ComplaintOut)
async def complaint_detail(
    complaint_id: UUID, ctx: AuthContext = Depends(require_admin_mfa), conn: asyncpg.Connection = Depends(get_db)
) -> ComplaintOut:
    return await _get(conn, complaint_id)


@router.post("/{complaint_id}/take", response_model=ComplaintOut)
async def take_complaint(
    complaint_id: UUID, ctx: AuthContext = Depends(require_admin_write), conn: asyncpg.Connection = Depends(get_db)
) -> ComplaintOut:
    before = await _get(conn, complaint_id)
    try:
        async with conn.transaction():
            if not await complaints_repo.take(conn, complaint_id, ctx.user["id"]):
                raise NotFoundError("complaint not found")
            await admin_audit.record(
                conn, ctx.user["id"], "complaint_take", target_type="complaint", target_id=complaint_id,
                before={"status": before.status}, after={"status": "in_progress"}, extra={"about": before.target.type},
            )
    except complaints_repo.BadTransition as exc:
        raise ConflictError(f"Жалоба уже в статусе «{exc.current}».", code="bad_transition") from None
    return await _get(conn, complaint_id)


@router.post("/{complaint_id}/resolve", response_model=ComplaintOut)
async def resolve_complaint(
    complaint_id: UUID,
    payload: ResolveComplaintIn,
    ctx: AuthContext = Depends(require_admin_write),
    conn: asyncpg.Connection = Depends(get_db),
) -> ComplaintOut:
    before = await _get(conn, complaint_id)
    try:
        async with conn.transaction():
            if not await complaints_repo.close(conn, complaint_id, ctx.user["id"], payload.status, payload.resolution):
                raise NotFoundError("complaint not found")
            await admin_audit.record(
                conn, ctx.user["id"], f"complaint_{payload.status}", target_type="complaint", target_id=complaint_id,
                reason=payload.resolution, before={"status": before.status}, after={"status": payload.status},
                extra={"about": before.target.type, "target_id": before.target.id},
            )
    except complaints_repo.BadTransition as exc:
        raise ConflictError(f"Жалоба уже закрыта (статус «{exc.current}»).", code="bad_transition") from None
    return await _get(conn, complaint_id)
