"""Data access for the devices that may be sent a push. All queries are parameterized."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg


async def register(conn: asyncpg.Connection, *, user_id: UUID, platform: str, token: str, app_version: str | None) -> None:
    """One phone, one row: the same token seen again refreshes it, and a token that another person used before moves to this one."""
    await conn.execute(
        """
        INSERT INTO push_devices (user_id, platform, token, app_version)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (token) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            platform = EXCLUDED.platform,
            app_version = EXCLUDED.app_version,
            updated_at = now()
        """,
        user_id,
        platform,
        token,
        app_version,
    )


async def unregister(conn: asyncpg.Connection, *, user_id: UUID, token: str) -> None:
    """Only the owner's own row: nobody can switch off somebody else's phone by guessing a token."""
    await conn.execute("DELETE FROM push_devices WHERE user_id = $1 AND token = $2", user_id, token)


async def list_for_user(conn: asyncpg.Connection, user_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        "SELECT id, platform, token FROM push_devices WHERE user_id = $1 ORDER BY updated_at DESC", user_id
    )
    return [dict(row) for row in rows]


async def delete_by_token(conn: asyncpg.Connection, token: str) -> None:
    """The system says this token is dead (the app was removed): stop trying."""
    await conn.execute("DELETE FROM push_devices WHERE token = $1", token)
