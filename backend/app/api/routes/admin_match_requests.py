"""The administrators' queue of «Подобрать тренера» requests. Taking and closing are recorded in the audit trail."""
from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.api.deps import AuthContext, get_db, require_admin_mfa, require_admin_write
from app.core.exceptions import ConflictError, NotFoundError
from app.repositories import match_requests as repo
from app.schemas.admin import PersonOut
from app.schemas.match_requests import CloseMatchRequestIn, MatchRequestAdminOut, MatchRequestPageOut, MatchStatus
from app.services import admin_audit

router = APIRouter(prefix="/api/admin/match-requests", tags=["admin"])


def _out(r: dict) -> MatchRequestAdminOut:
    name = " ".join(part for part in (r["author_first_name"], r["author_last_name"]) if part)
    return MatchRequestAdminOut(
        **{k: r[k] for k in (
            "id", "sport", "goal", "level", "format", "city", "budget_min", "budget_max", "currency", "weekdays", "day_parts",
            "schedule_note", "comment", "status", "created_at", "admin_note", "handled_at",
        )},
        author=PersonOut(id=r["author_id"], name=name, email=r["author_email"]),
        handled_by=r["handled_by_email"],
    )


async def _get(conn: asyncpg.Connection, request_id: UUID) -> MatchRequestAdminOut:
    row = await repo.get_request(conn, request_id)
    if row is None:
        raise NotFoundError("match request not found")
    return _out(row)


@router.get("", response_model=MatchRequestPageOut)
async def list_requests(
    status: MatchStatus | None = None,
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=1_000_000),
    ctx: AuthContext = Depends(require_admin_mfa),
    conn: asyncpg.Connection = Depends(get_db),
) -> MatchRequestPageOut:
    total, rows = await repo.list_requests(conn, status=status, query=q, limit=limit, offset=offset)
    return MatchRequestPageOut(total=total, limit=limit, offset=offset, items=[_out(r) for r in rows])


@router.get("/{request_id}", response_model=MatchRequestAdminOut)
async def request_detail(
    request_id: UUID, ctx: AuthContext = Depends(require_admin_mfa), conn: asyncpg.Connection = Depends(get_db)
) -> MatchRequestAdminOut:
    return await _get(conn, request_id)


@router.post("/{request_id}/take", response_model=MatchRequestAdminOut)
async def take_request(
    request_id: UUID, ctx: AuthContext = Depends(require_admin_write), conn: asyncpg.Connection = Depends(get_db)
) -> MatchRequestAdminOut:
    before = await _get(conn, request_id)
    try:
        async with conn.transaction():
            if not await repo.take(conn, request_id, ctx.user["id"]):
                raise NotFoundError("match request not found")
            await admin_audit.record(
                conn, ctx.user["id"], "match_request_take", target_type="match_request", target_id=request_id,
                before={"status": before.status}, after={"status": "in_progress"}, extra={"sport": before.sport},
            )
    except repo.BadTransition as exc:
        raise ConflictError(f"Заявка уже в статусе «{exc.current}».", code="bad_transition") from None
    return await _get(conn, request_id)


@router.post("/{request_id}/close", response_model=MatchRequestAdminOut)
async def close_request(
    request_id: UUID,
    payload: CloseMatchRequestIn,
    ctx: AuthContext = Depends(require_admin_write),
    conn: asyncpg.Connection = Depends(get_db),
) -> MatchRequestAdminOut:
    before = await _get(conn, request_id)
    try:
        async with conn.transaction():
            if not await repo.close(conn, request_id, ctx.user["id"], payload.note):
                raise NotFoundError("match request not found")
            await admin_audit.record(
                conn, ctx.user["id"], "match_request_close", target_type="match_request", target_id=request_id, reason=payload.note,
                before={"status": before.status}, after={"status": "closed"}, extra={"sport": before.sport},
            )
    except repo.BadTransition as exc:
        raise ConflictError(f"Заявка уже обработана (статус «{exc.current}»).", code="bad_transition") from None
    return await _get(conn, request_id)
