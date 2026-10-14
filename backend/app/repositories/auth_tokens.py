"""Data access for auth_tokens: one-time links (email verification, password
reset, email change) and the Telegram handshakes. Only SHA-256 hashes of the
tokens are stored; a token is spent by an atomic UPDATE ... RETURNING, so two
concurrent requests can't both use it."""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg


async def create(
    conn: asyncpg.Connection,
    *,
    user_id: UUID,
    purpose: str,
    token_hash: str,
    expires_at: datetime,
    new_email: str | None = None,
    supersede: bool = True,
) -> None:
    """Issues a token. By default earlier unused tokens of the same purpose for
    this user stop working - asking for a new link invalidates the old one."""
    if supersede:
        await conn.execute(
            "UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL",
            user_id,
            purpose,
        )
    await conn.execute(
        "INSERT INTO auth_tokens (user_id, purpose, token_hash, new_email, expires_at) VALUES ($1, $2, $3, $4, $5)",
        user_id,
        purpose,
        token_hash,
        new_email,
        expires_at,
    )


async def peek(conn: asyncpg.Connection, token_hash: str, purpose: str) -> dict[str, Any] | None:
    """Reads a still-valid token without spending it."""
    row = await conn.fetchrow(
        "SELECT id, user_id, new_email, expires_at FROM auth_tokens "
        "WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()",
        token_hash,
        purpose,
    )
    return dict(row) if row else None


async def consume(conn: asyncpg.Connection, token_hash: str, purpose: str) -> dict[str, Any] | None:
    """Spends a valid token exactly once. None if unknown, expired or used."""
    row = await conn.fetchrow(
        "UPDATE auth_tokens SET used_at = now() "
        "WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now() "
        "RETURNING id, user_id, new_email",
        token_hash,
        purpose,
    )
    return dict(row) if row else None


async def purge_expired(conn: asyncpg.Connection) -> int:
    result = await conn.execute(
        "DELETE FROM auth_tokens WHERE expires_at < now() - interval '1 day' "
        "OR (used_at IS NOT NULL AND used_at < now() - interval '7 days')"
    )
    return int(result.rsplit(" ", 1)[-1])
