"""Data access for user_mfa (TOTP second factor)."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg


async def get(conn: asyncpg.Connection, user_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        "SELECT user_id, secret_encrypted, enabled_at, recovery_hashes, last_used_step FROM user_mfa WHERE user_id = $1",
        user_id,
    )
    return dict(row) if row else None


async def begin_setup(conn: asyncpg.Connection, user_id: UUID, secret_encrypted: str) -> None:
    """Stores a not-yet-confirmed secret. Refuses to overwrite an enabled one."""
    await conn.execute(
        """
        INSERT INTO user_mfa (user_id, secret_encrypted) VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET secret_encrypted = EXCLUDED.secret_encrypted,
            recovery_hashes = '{}', last_used_step = NULL
        WHERE user_mfa.enabled_at IS NULL
        """,
        user_id,
        secret_encrypted,
    )


async def enable(conn: asyncpg.Connection, user_id: UUID, recovery_hashes: list[str], step: int) -> None:
    await conn.execute(
        "UPDATE user_mfa SET enabled_at = now(), recovery_hashes = $2, last_used_step = $3 WHERE user_id = $1",
        user_id,
        recovery_hashes,
        step,
    )


async def record_step(conn: asyncpg.Connection, user_id: UUID, step: int) -> None:
    await conn.execute("UPDATE user_mfa SET last_used_step = $2 WHERE user_id = $1", user_id, step)


async def use_recovery_code(conn: asyncpg.Connection, user_id: UUID, code_hash: str) -> bool:
    result = await conn.execute(
        "UPDATE user_mfa SET recovery_hashes = array_remove(recovery_hashes, $2) "
        "WHERE user_id = $1 AND $2 = ANY(recovery_hashes)",
        user_id,
        code_hash,
    )
    return result.endswith(" 1")


async def disable(conn: asyncpg.Connection, user_id: UUID) -> None:
    await conn.execute("DELETE FROM user_mfa WHERE user_id = $1", user_id)
