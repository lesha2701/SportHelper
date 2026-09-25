"""Data access for browser_login_tokens (login from a plain browser via the bot)."""
from __future__ import annotations

from uuid import UUID

import asyncpg


async def create(conn: asyncpg.Connection, token: str, ttl_seconds: int) -> None:
    await conn.execute("DELETE FROM browser_login_tokens WHERE expires_at < now()")
    await conn.execute(
        "INSERT INTO browser_login_tokens (token, expires_at) "
        "VALUES ($1, now() + make_interval(secs => $2))",
        token,
        float(ttl_seconds),
    )


async def confirm(conn: asyncpg.Connection, token: str, user_id: UUID) -> bool:
    """Binds an unconfirmed, unexpired token to a user. False if unknown,
    expired, or already confirmed."""
    result = await conn.execute(
        "UPDATE browser_login_tokens SET user_id = $2 "
        "WHERE token = $1 AND user_id IS NULL AND expires_at > now()",
        token,
        user_id,
    )
    return result.endswith(" 1")


async def consume(conn: asyncpg.Connection, token: str) -> UUID | None:
    """Single-use: returns the confirmed user's id and deletes the token."""
    row = await conn.fetchrow(
        "DELETE FROM browser_login_tokens "
        "WHERE token = $1 AND user_id IS NOT NULL AND expires_at > now() RETURNING user_id",
        token,
    )
    return row["user_id"] if row else None


async def is_pending(conn: asyncpg.Connection, token: str) -> bool:
    row = await conn.fetchrow(
        "SELECT 1 FROM browser_login_tokens WHERE token = $1 AND expires_at > now()", token
    )
    return row is not None
