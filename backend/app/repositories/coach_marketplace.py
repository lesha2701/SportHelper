"""Data access for coach marketplace settings, public discovery and
availability. All queries are parameterized."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

_SETTINGS_FIELDS = (
    "user_id, is_listed, price_per_session, currency, offers_online, "
    "offers_offline, location, session_duration_minutes"
)


async def get_settings(conn: asyncpg.Connection, user_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"SELECT {_SETTINGS_FIELDS} FROM coach_profiles WHERE user_id = $1", user_id
    )
    return dict(row) if row else None


async def upsert_settings(
    conn: asyncpg.Connection,
    user_id: UUID,
    *,
    is_listed: bool,
    price_per_session,
    currency: str,
    offers_online: bool,
    offers_offline: bool,
    location: str | None,
    session_duration_minutes: int | None,
) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"""
        UPDATE coach_profiles SET
            is_listed = $2,
            price_per_session = $3,
            currency = $4,
            offers_online = $5,
            offers_offline = $6,
            location = $7,
            session_duration_minutes = $8
        WHERE user_id = $1
        RETURNING {_SETTINGS_FIELDS}
        """,
        user_id,
        is_listed,
        price_per_session,
        currency,
        offers_online,
        offers_offline,
        location,
        session_duration_minutes,
    )
    return dict(row) if row else None
