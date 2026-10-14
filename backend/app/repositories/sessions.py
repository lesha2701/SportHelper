"""Data access for user_sessions (server-side login sessions)."""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg

_FIELDS = "id, user_id, created_at, last_seen_at, expires_at, mfa_verified_at, user_agent, ip_address"

# How often a request is allowed to write last_seen_at (and slide the expiry).
TOUCH_INTERVAL_MINUTES = 10


async def create(
    conn: asyncpg.Connection,
    *,
    user_id: UUID,
    token_hash: str,
    expires_at: datetime,
    user_agent: str | None,
    ip_address: str | None,
) -> dict[str, Any]:
    row = await conn.fetchrow(
        f"""
        INSERT INTO user_sessions (user_id, token_hash, expires_at, user_agent, ip_address)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING {_FIELDS}
        """,
        user_id,
        token_hash,
        expires_at,
        (user_agent or "")[:400] or None,
        ip_address,
    )
    return dict(row)


async def get_active(conn: asyncpg.Connection, token_hash: str) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"SELECT {_FIELDS} FROM user_sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()",
        token_hash,
    )
    return dict(row) if row else None


async def touch(conn: asyncpg.Connection, session_id: UUID, user_id: UUID, new_expires_at: datetime) -> None:
    """Records activity: slides the idle expiry forward and keeps
    users.last_login_at current (the "when did they last open the app"
    signal that the re-engagement nudges rely on)."""
    await conn.execute(
        "UPDATE user_sessions SET last_seen_at = now(), expires_at = $2 WHERE id = $1", session_id, new_expires_at
    )
    await conn.execute("UPDATE users SET last_login_at = now() WHERE id = $1", user_id)


async def list_for_user(conn: asyncpg.Connection, user_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"SELECT {_FIELDS} FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() "
        "ORDER BY last_seen_at DESC",
        user_id,
    )
    return [dict(row) for row in rows]


async def revoke(conn: asyncpg.Connection, user_id: UUID, session_id: UUID) -> bool:
    """Scoped to the owner: a user can only ever end their own sessions."""
    result = await conn.execute(
        "UPDATE user_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
        session_id,
        user_id,
    )
    return result.endswith(" 1")


async def revoke_all(conn: asyncpg.Connection, user_id: UUID, *, except_session_id: UUID | None = None) -> int:
    result = await conn.execute(
        "UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL "
        "AND ($2::uuid IS NULL OR id <> $2)",
        user_id,
        except_session_id,
    )
    return int(result.rsplit(" ", 1)[-1])


async def mark_mfa_verified(conn: asyncpg.Connection, session_id: UUID) -> None:
    await conn.execute("UPDATE user_sessions SET mfa_verified_at = now() WHERE id = $1", session_id)


async def purge_expired(conn: asyncpg.Connection, *, keep_revoked_days: int = 7) -> int:
    result = await conn.execute(
        "DELETE FROM user_sessions WHERE expires_at < now() "
        "OR (revoked_at IS NOT NULL AND revoked_at < now() - make_interval(days => $1))",
        keep_revoked_days,
    )
    return int(result.rsplit(" ", 1)[-1])
