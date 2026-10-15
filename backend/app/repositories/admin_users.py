"""User administration queries: search, the admin's view of an account, blocking and unblocking.

Only what an administrator needs is selected - never the password hash, tokens, session ids or MFA data.
All queries are parameterised; the search text is escaped before it becomes a LIKE pattern."""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg

SORTS = {
    "created_desc": "u.created_at DESC, u.id",
    "created_asc": "u.created_at ASC, u.id",
    "active_desc": "u.last_active_at DESC NULLS LAST, u.created_at DESC, u.id",
    "active_asc": "u.last_active_at ASC NULLS LAST, u.created_at DESC, u.id",
}
ROLES = {"player", "coach", "none", "admin"}
STATUSES = {"active", "banned", "unverified", "deleted"}

# The block that is in force right now (a temporary one that has run out no longer counts).
_BANNED_NOW = "(u.is_banned AND (u.banned_until IS NULL OR u.banned_until > now()))"

_LIST_FIELDS = f"""
    u.id, u.email, u.email_verified_at, u.first_name, u.last_name, u.created_at, u.last_active_at, u.last_login_at,
    u.deleted_at, u.deletion_requested_at, {_BANNED_NOW} AS is_banned, u.banned_until,
    EXISTS(SELECT 1 FROM player_profiles p WHERE p.user_id = u.id) AS is_player,
    EXISTS(SELECT 1 FROM coach_profiles c WHERE c.user_id = u.id) AS is_coach
"""


def like_pattern(text: str | None) -> str | None:
    if not text or not text.strip():
        return None
    escaped = text.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _as_uuid(text: str | None) -> UUID | None:
    try:
        return UUID(text.strip()) if text else None
    except ValueError:
        return None


async def search_users(
    conn: asyncpg.Connection,
    *,
    query: str | None,
    role: str | None,
    status: str | None,
    sort: str,
    admin_emails: list[str],
    limit: int,
    offset: int,
) -> tuple[int, list[dict[str, Any]]]:
    order = SORTS.get(sort, SORTS["created_desc"])
    args = (like_pattern(query), _as_uuid(query), role, status, admin_emails, limit, offset)
    where = f"""
        WHERE ($1::text IS NULL OR u.email ILIKE $1 OR u.first_name ILIKE $1 OR u.last_name ILIKE $1
               OR (u.first_name || ' ' || COALESCE(u.last_name, '')) ILIKE $1
               OR ($2::uuid IS NOT NULL AND u.id = $2::uuid))
          AND ($3::text IS NULL
               OR ($3 = 'player' AND EXISTS(SELECT 1 FROM player_profiles p WHERE p.user_id = u.id))
               OR ($3 = 'coach' AND EXISTS(SELECT 1 FROM coach_profiles c WHERE c.user_id = u.id))
               OR ($3 = 'none' AND NOT EXISTS(SELECT 1 FROM player_profiles p WHERE p.user_id = u.id)
                               AND NOT EXISTS(SELECT 1 FROM coach_profiles c WHERE c.user_id = u.id))
               OR ($3 = 'admin' AND u.email_verified_at IS NOT NULL AND lower(u.email) = ANY($5::text[])))
          AND ($4::text IS NULL
               OR ($4 = 'deleted' AND u.deleted_at IS NOT NULL)
               OR ($4 = 'banned' AND u.deleted_at IS NULL AND {_BANNED_NOW})
               OR ($4 = 'unverified' AND u.deleted_at IS NULL AND u.email IS NOT NULL AND u.email_verified_at IS NULL)
               OR ($4 = 'active' AND u.deleted_at IS NULL AND NOT {_BANNED_NOW}
                   AND (u.email_verified_at IS NOT NULL OR u.email IS NULL)))
    """
    total = await conn.fetchval(f"SELECT count(*) FROM users u {where}", *args[:5])
    rows = await conn.fetch(
        f"SELECT {_LIST_FIELDS} FROM users u {where} ORDER BY {order} LIMIT $6 OFFSET $7", *args
    )
    return total, [dict(r) for r in rows]


async def get_card(conn: asyncpg.Connection, user_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"""
        SELECT {_LIST_FIELDS}, u.ban_reason, u.banned_at, (u.telegram_id IS NOT NULL) AS telegram_linked,
            (SELECT count(*) FROM trainings t WHERE t.created_by = u.id AND t.deleted_at IS NULL) AS trainings_created,
            (SELECT count(*) FROM team_members m WHERE m.user_id = u.id) AS teams_count,
            (SELECT count(*) FROM coach_listings l WHERE l.coach_user_id = u.id AND l.deleted_at IS NULL) AS listings_count,
            (SELECT count(*) FROM files f WHERE f.owner_id = u.id AND f.deleted_at IS NULL) AS files_count
        FROM users u WHERE u.id = $1
        """,
        user_id,
    )
    return dict(row) if row else None


async def list_bans(conn: asyncpg.Connection, user_id: UUID, limit: int = 50) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT b.id, b.reason, b.banned_at, b.expires_at, b.lifted_at, b.lift_kind, b.lift_reason,
               a.email AS admin_email, l.email AS lifted_by_email
        FROM user_bans b
        LEFT JOIN users a ON a.id = b.admin_user_id
        LEFT JOIN users l ON l.id = b.lifted_by
        WHERE b.user_id = $1
        ORDER BY b.banned_at DESC
        LIMIT $2
        """,
        user_id,
        limit,
    )
    return [dict(r) for r in rows]


async def list_moderation_history(conn: asyncpg.Connection, user_id: UUID, limit: int = 50) -> list[dict[str, Any]]:
    """Every administrative action recorded against this account (blocks, unblocks, ...)."""
    rows = await conn.fetch(
        """
        SELECT a.id, a.action, a.reason, a.result, a.created_at, u.email AS admin_email
        FROM admin_audit_log a LEFT JOIN users u ON u.id = a.admin_user_id
        WHERE a.target_type = 'user' AND a.target_id = $1
        ORDER BY a.created_at DESC
        LIMIT $2
        """,
        str(user_id),
        limit,
    )
    return [dict(r) for r in rows]


class AlreadyBlocked(Exception):
    pass


class NotBlocked(Exception):
    pass


async def block(
    conn: asyncpg.Connection, user_id: UUID, admin_id: UUID, reason: str, expires_at: datetime | None
) -> dict[str, Any] | None:
    """Blocks the account and ends all of its sessions, atomically. None if the account does not exist or
    was deleted; AlreadyBlocked if a block is already in force."""
    async with conn.transaction():
        user = await conn.fetchrow(
            "SELECT id, (is_banned AND (banned_until IS NULL OR banned_until > now())) AS blocked_now "
            "FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
            user_id,
        )
        if user is None:
            return None
        if user["blocked_now"]:
            raise AlreadyBlocked()
        # A leftover open record of a block that ran out (the background loop has not tidied it yet) is closed first.
        await conn.execute(
            "UPDATE user_bans SET lifted_at = now(), lift_kind = 'expired' WHERE user_id = $1 AND lifted_at IS NULL", user_id
        )
        await conn.execute(
            "INSERT INTO user_bans (user_id, admin_user_id, reason, expires_at) VALUES ($1, $2, $3, $4)",
            user_id,
            admin_id,
            reason,
            expires_at,
        )
        await conn.execute(
            "UPDATE users SET is_banned = TRUE, banned_at = now(), banned_until = $2, ban_reason = $3 WHERE id = $1",
            user_id,
            expires_at,
            reason,
        )
        await conn.execute("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", user_id)
    return await get_card(conn, user_id)


async def unblock(conn: asyncpg.Connection, user_id: UUID, admin_id: UUID, reason: str) -> dict[str, Any] | None:
    async with conn.transaction():
        user = await conn.fetchrow(
            "SELECT id, (is_banned AND (banned_until IS NULL OR banned_until > now())) AS blocked_now "
            "FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
            user_id,
        )
        if user is None:
            return None
        if not user["blocked_now"]:
            raise NotBlocked()
        await conn.execute(
            "UPDATE user_bans SET lifted_at = now(), lift_kind = 'manual', lifted_by = $2, lift_reason = $3 "
            "WHERE user_id = $1 AND lifted_at IS NULL",
            user_id,
            admin_id,
            reason,
        )
        await conn.execute(
            "UPDATE users SET is_banned = FALSE, banned_at = NULL, banned_until = NULL, ban_reason = NULL WHERE id = $1", user_id
        )
    return await get_card(conn, user_id)


async def lift_expired(conn: asyncpg.Connection) -> int:
    """Closes temporary blocks whose time has run out (the application already ignores them; this tidies the
    flag and the history). Returns how many accounts were released."""
    async with conn.transaction():
        rows = await conn.fetch(
            "UPDATE user_bans SET lifted_at = now(), lift_kind = 'expired' "
            "WHERE lifted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= now() RETURNING user_id"
        )
        ids = [r["user_id"] for r in rows]
        if ids:
            await conn.execute(
                "UPDATE users SET is_banned = FALSE, banned_at = NULL, banned_until = NULL, ban_reason = NULL "
                "WHERE id = ANY($1::uuid[]) AND banned_until IS NOT NULL AND banned_until <= now()",
                ids,
            )
    return len(ids)
