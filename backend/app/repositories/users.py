"""Data access for the users table. All queries are parameterized."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

from app.security.telegram_auth import TelegramUser

_SELECT_FIELDS = (
    "id, telegram_id, username, first_name, last_name, photo_url, "
    "language_code, is_banned, banned_at, active_mode, last_login_at, created_at, updated_at"
)


async def upsert_from_telegram(
    conn: asyncpg.Connection, telegram_user: TelegramUser
) -> dict[str, Any]:
    """Insert a new user or refresh profile fields + last_login_at for an
    existing one, keyed by telegram_id."""
    row = await conn.fetchrow(
        f"""
        INSERT INTO users (
            telegram_id, username, first_name, last_name, photo_url,
            language_code, last_login_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, now())
        ON CONFLICT (telegram_id) DO UPDATE SET
            username = EXCLUDED.username,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            photo_url = EXCLUDED.photo_url,
            language_code = EXCLUDED.language_code,
            last_login_at = now()
        RETURNING {_SELECT_FIELDS}
        """,
        telegram_user.id,
        telegram_user.username,
        telegram_user.first_name,
        telegram_user.last_name,
        telegram_user.photo_url,
        telegram_user.language_code,
    )
    return dict(row)


async def get_by_id(conn: asyncpg.Connection, user_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_SELECT_FIELDS} FROM users WHERE id = $1", user_id)
    return dict(row) if row else None


async def get_by_telegram_id(conn: asyncpg.Connection, telegram_id: int) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"SELECT {_SELECT_FIELDS} FROM users WHERE telegram_id = $1", telegram_id
    )
    return dict(row) if row else None


async def set_active_mode(
    conn: asyncpg.Connection, user_id: UUID, mode: str
) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"UPDATE users SET active_mode = $2 WHERE id = $1 RETURNING {_SELECT_FIELDS}",
        user_id,
        mode,
    )
    return dict(row) if row else None
