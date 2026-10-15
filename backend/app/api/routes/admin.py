"""Website administration.

Two levels, both enforced by dependencies rather than by "the user is signed in":

  * require_admin      - the account is an administrator (ADMIN_EMAILS, verified email).
                         Only aggregate, non-personal data.
  * require_admin_mfa  - additionally: two-factor is enabled AND the code was
                         entered in THIS session recently. Everything that shows
                         personal data or changes another person's account.

Having 2FA configured is never taken as proof it was passed: the second factor
is checked per session (`user_sessions.mfa_verified_at`).
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.api.deps import AuthContext, get_db, get_settings_dep, is_admin, require_admin, require_admin_mfa
from app.config import Settings
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.repositories import admin as admin_repo
from app.repositories import admin_users as admin_users_repo
from app.services import admin_audit
from app.repositories import mfa as mfa_repo
from app.repositories import admin_stats as admin_stats_repo
from app.schemas.admin import (
    AdminAuditEntryOut,
    AdminDashboardOut,
    AdminSessionOut,
    AdminUserCardOut,
    AdminUserRowOut,
    AdminUsersPageOut,
    BanRecordOut,
    BlockIn,
    ModerationEntryOut,
    UnblockIn,
    DashboardActivityOut,
    DashboardBookingsOut,
    DashboardModerationOut,
    DashboardTrainingsOut,
    DashboardUsersOut,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/session", response_model=AdminSessionOut)
async def admin_session(
    ctx: AuthContext = Depends(require_admin),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> AdminSessionOut:
    """The one admin endpoint that works before the second factor is entered: it only says what is still
    needed. Non-administrators get the same 403 as for every other admin route."""
    mfa = await mfa_repo.get(conn, ctx.user["id"])
    verified_at = ctx.session.get("mfa_verified_at")
    now = datetime.now(timezone.utc)
    return AdminSessionOut(
        is_admin=True,
        mfa_enabled=bool(mfa and mfa["enabled_at"]),
        mfa_verified=bool(verified_at and now - verified_at <= timedelta(hours=settings.admin_mfa_session_hours)),
        mfa_recent=bool(verified_at and now - verified_at <= timedelta(minutes=settings.admin_sensitive_mfa_minutes)),
    )


@router.get("/dashboard", response_model=AdminDashboardOut)
async def dashboard(
    ctx: AuthContext = Depends(require_admin_mfa), conn: asyncpg.Connection = Depends(get_db)
) -> AdminDashboardOut:
    d = await admin_stats_repo.get_dashboard(conn)
    return AdminDashboardOut(
        users=DashboardUsersOut(
            total=d["users_total"], new_today=d["users_new_today"], new_7d=d["users_new_7d"], new_30d=d["users_new_30d"],
            players=d["players"], coaches=d["coaches"], banned=d["users_banned"],
        ),
        activity=DashboardActivityOut(dau=d["dau"], wau=d["wau"], mau=d["mau"], tracking_since=d["activity_since"]),
        trainings=DashboardTrainingsOut(
            total=d["trainings_total"], active=d["trainings_active"], upcoming=d["trainings_upcoming"], completed=d["trainings_completed"]
        ),
        bookings=DashboardBookingsOut(total=d["bookings_total"], confirmed=d["bookings_confirmed"], upcoming=d["bookings_upcoming"]),
        moderation=DashboardModerationOut(new_complaints=d["new_complaints"], content_pending=d["content_pending"]),
        registrations=d["registrations"],
        active_users=d["active_users"],
        trainings_created=d["trainings_created"],
        bookings_created=d["bookings_created"],
    )


def _status(row: dict) -> str:
    if row["deleted_at"] is not None:
        return "deleted"
    if row["is_banned"]:
        return "banned"
    if row["email"] is not None and row["email_verified_at"] is None:
        return "unverified"
    return "active"


def _row_out(row: dict, settings: Settings) -> dict:
    return {
        "id": row["id"],
        "email": row["email"],
        "email_verified": row["email_verified_at"] is not None,
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "is_player": row["is_player"],
        "is_coach": row["is_coach"],
        "is_admin": is_admin({"email": row["email"], "email_verified_at": row["email_verified_at"], "is_banned": False, "deleted_at": row["deleted_at"]}, settings),
        "status": _status(row),
        "deletion_requested": row["deletion_requested_at"] is not None and row["deleted_at"] is None,
        "banned_until": row["banned_until"] if row["is_banned"] else None,
        "created_at": row["created_at"],
        "last_active_at": row["last_active_at"],
        "last_login_at": row["last_login_at"],
    }


@router.get("/users", response_model=AdminUsersPageOut)
async def list_users(
    q: str | None = Query(default=None, max_length=100),
    role: Literal["player", "coach", "none", "admin"] | None = None,
    status: Literal["active", "banned", "unverified", "deleted"] | None = None,
    sort: Literal["created_desc", "created_asc", "active_desc", "active_asc"] = "created_desc",
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=1_000_000),
    ctx: AuthContext = Depends(require_admin_mfa),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> AdminUsersPageOut:
    total, rows = await admin_users_repo.search_users(
        conn, query=q, role=role, status=status, sort=sort, admin_emails=settings.admin_emails_list, limit=limit, offset=offset
    )
    return AdminUsersPageOut(total=total, limit=limit, offset=offset, items=[AdminUserRowOut(**_row_out(r, settings)) for r in rows])


async def _card(conn: asyncpg.Connection, user_id: UUID, settings: Settings) -> AdminUserCardOut:
    row = await admin_users_repo.get_card(conn, user_id)
    if row is None:
        raise NotFoundError("user not found")
    bans = await admin_users_repo.list_bans(conn, user_id)
    history = await admin_users_repo.list_moderation_history(conn, user_id)
    return AdminUserCardOut(
        **_row_out(row, settings),
        ban_reason=row["ban_reason"] if row["is_banned"] else None,
        banned_at=row["banned_at"] if row["is_banned"] else None,
        telegram_linked=row["telegram_linked"],
        trainings_created=row["trainings_created"],
        teams_count=row["teams_count"],
        listings_count=row["listings_count"],
        files_count=row["files_count"],
        bans=[
            BanRecordOut(
                id=b["id"], reason=b["reason"], banned_at=b["banned_at"], expires_at=b["expires_at"], lifted_at=b["lifted_at"],
                lift_kind=b["lift_kind"], lift_reason=b["lift_reason"], admin=b["admin_email"], lifted_by=b["lifted_by_email"],
            )
            for b in bans
        ],
        history=[
            ModerationEntryOut(id=h["id"], action=h["action"], reason=h["reason"], result=h["result"], created_at=h["created_at"], admin=h["admin_email"])
            for h in history
        ],
    )


@router.get("/users/{user_id}", response_model=AdminUserCardOut)
async def user_card(
    user_id: UUID,
    ctx: AuthContext = Depends(require_admin_mfa),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> AdminUserCardOut:
    return await _card(conn, user_id, settings)


async def _refuse_if_protected(user_id: UUID, action: str, ctx: AuthContext, conn: asyncpg.Connection, settings: Settings) -> dict:
    """Self-blocking and blocking an administrator are refused (and the attempt is recorded). Administrators are
    defined by server configuration, so removing one is done there - which also means this API can never be used to
    lock every administrator out."""
    target = await admin_users_repo.get_card(conn, user_id)
    if target is None or target["deleted_at"] is not None:
        raise NotFoundError("user not found")
    if user_id == ctx.user["id"]:
        await admin_audit.record(conn, ctx.user["id"], action, target_type="user", target_id=user_id, result="denied", extra={"why": "self"})
        raise ConflictError("Нельзя заблокировать самого себя.", code="cannot_ban_self")
    if action == "ban" and is_admin({"email": target["email"], "email_verified_at": target["email_verified_at"], "is_banned": False, "deleted_at": None}, settings):
        await admin_audit.record(conn, ctx.user["id"], action, target_type="user", target_id=user_id, result="denied", extra={"why": "administrator"})
        raise ForbiddenError(
            "Администратора нельзя заблокировать через панель: уберите его адрес из ADMIN_EMAILS на сервере.", code="cannot_ban_admin"
        )
    return target


def _snapshot(card: dict) -> dict:
    return {"blocked": card["is_banned"], "until": card["banned_until"] if card["is_banned"] else None, "reason": card["ban_reason"] if card["is_banned"] else None}


@router.post("/users/{user_id}/ban", response_model=AdminUserCardOut)
async def ban_user(
    user_id: UUID,
    payload: BlockIn,
    ctx: AuthContext = Depends(require_admin_mfa),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> AdminUserCardOut:
    before = _snapshot(await _refuse_if_protected(user_id, "ban", ctx, conn, settings))
    expires = datetime.now(timezone.utc) + timedelta(days=payload.days) if payload.days else None
    try:
        async with conn.transaction():
            after = await admin_users_repo.block(conn, user_id, ctx.user["id"], payload.reason, expires)
            if after is None:
                raise NotFoundError("user not found")
            await admin_audit.record(
                conn, ctx.user["id"], "ban", target_type="user", target_id=user_id, reason=payload.reason,
                before=before, after=_snapshot(after), extra={"days": payload.days},
            )
    except admin_users_repo.AlreadyBlocked:
        raise ConflictError("Пользователь уже заблокирован.", code="already_banned") from None
    return await _card(conn, user_id, settings)


@router.post("/users/{user_id}/unban", response_model=AdminUserCardOut)
async def unban_user(
    user_id: UUID,
    payload: UnblockIn,
    ctx: AuthContext = Depends(require_admin_mfa),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> AdminUserCardOut:
    before = _snapshot(await _refuse_if_protected(user_id, "unban", ctx, conn, settings))
    try:
        async with conn.transaction():
            after = await admin_users_repo.unblock(conn, user_id, ctx.user["id"], payload.reason)
            if after is None:
                raise NotFoundError("user not found")
            await admin_audit.record(
                conn, ctx.user["id"], "unban", target_type="user", target_id=user_id, reason=payload.reason,
                before=before, after=_snapshot(after),
            )
    except admin_users_repo.NotBlocked:
        raise ConflictError("Пользователь не заблокирован.", code="not_banned") from None
    return await _card(conn, user_id, settings)


@router.get("/audit", response_model=list[AdminAuditEntryOut])
async def audit_log(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    ctx: AuthContext = Depends(require_admin_mfa),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[AdminAuditEntryOut]:
    rows = await admin_repo.list_audit(conn, limit=limit, offset=offset)
    return [
        AdminAuditEntryOut(
            id=r["id"],
            action=r["action"],
            target_type=r["target_type"],
            target_id=r["target_id"],
            details=json.loads(r["details"]) if isinstance(r["details"], str) else r["details"],
            reason=r["reason"],
            result=r["result"],
            created_at=r["created_at"],
            admin=r["admin_email"] or (f"telegram:{r['admin_telegram_id']}" if r["admin_telegram_id"] else "unknown"),
        )
        for r in rows
    ]
