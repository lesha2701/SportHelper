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
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.api.deps import AuthContext, get_db, get_settings_dep, is_admin, require_admin, require_admin_mfa
from app.config import Settings
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.repositories import admin as admin_repo
from app.schemas.admin import AdminAuditEntryOut, AdminOverviewOut, AdminUserOut, AdminUsersPageOut

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _user_out(row: dict) -> AdminUserOut:
    return AdminUserOut(
        id=row["id"],
        email=row["email"],
        email_verified=row["email_verified_at"] is not None,
        first_name=row["first_name"],
        last_name=row["last_name"],
        is_banned=row["is_banned"],
        banned_at=row["banned_at"],
        last_login_at=row["last_login_at"],
        created_at=row["created_at"],
        telegram_linked=row["telegram_linked"],
        is_deleted=row["deleted_at"] is not None,
    )


@router.get("/overview", response_model=AdminOverviewOut)
async def overview(
    ctx: AuthContext = Depends(require_admin), conn: asyncpg.Connection = Depends(get_db)
) -> AdminOverviewOut:
    stats = await admin_repo.get_project_stats(conn)
    return AdminOverviewOut(**{key: stats[key] for key in AdminOverviewOut.model_fields})


@router.get("/users", response_model=AdminUsersPageOut)
async def list_users(
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    ctx: AuthContext = Depends(require_admin_mfa),
    conn: asyncpg.Connection = Depends(get_db),
) -> AdminUsersPageOut:
    rows = await admin_repo.list_web_users(conn, limit=limit, offset=offset, query=q)
    return AdminUsersPageOut(total=await admin_repo.count_web_users(conn, q), items=[_user_out(r) for r in rows])


async def _set_banned(
    user_id: UUID, banned: bool, ctx: AuthContext, conn: asyncpg.Connection, settings: Settings
) -> AdminUserOut:
    if user_id == ctx.user["id"]:
        raise ConflictError("Нельзя заблокировать самого себя.", code="cannot_ban_self")
    target = await admin_repo.get_web_user(conn, user_id)
    if target is None or target["deleted_at"] is not None:
        raise NotFoundError("user not found")
    if banned and is_admin(target, settings):
        # Administrators are defined by server configuration; removing one is done there.
        raise ForbiddenError("Администратора нельзя заблокировать через API.", code="cannot_ban_admin")
    updated = await admin_repo.set_banned_by_id(conn, user_id, banned)
    if updated is None:
        raise NotFoundError("user not found")
    await admin_repo.record_audit(
        conn,
        admin_user_id=ctx.user["id"],
        action="ban" if banned else "unban",
        target_type="user",
        target_id=str(user_id),
    )
    return _user_out(updated)


@router.post("/users/{user_id}/ban", response_model=AdminUserOut)
async def ban_user(
    user_id: UUID,
    ctx: AuthContext = Depends(require_admin_mfa),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> AdminUserOut:
    return await _set_banned(user_id, True, ctx, conn, settings)


@router.post("/users/{user_id}/unban", response_model=AdminUserOut)
async def unban_user(
    user_id: UUID,
    ctx: AuthContext = Depends(require_admin_mfa),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> AdminUserOut:
    return await _set_banned(user_id, False, ctx, conn, settings)


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
            created_at=r["created_at"],
            admin=r["admin_email"] or (f"telegram:{r['admin_telegram_id']}" if r["admin_telegram_id"] else "unknown"),
        )
        for r in rows
    ]
