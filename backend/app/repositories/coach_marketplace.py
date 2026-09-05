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


_AVAILABILITY_FIELDS = "id, weekday, start_time, end_time"


def _windows_overlap(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return a["weekday"] == b["weekday"] and a["start_time"] < b["end_time"] and b["start_time"] < a["end_time"]


def has_overlap(windows: list[dict[str, Any]]) -> bool:
    return any(_windows_overlap(a, b) for i, a in enumerate(windows) for b in windows[i + 1 :])


async def list_availability(conn: asyncpg.Connection, coach_user_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"SELECT {_AVAILABILITY_FIELDS} FROM coach_availability_templates "
        "WHERE coach_user_id = $1 ORDER BY weekday, start_time",
        coach_user_id,
    )
    return [dict(row) for row in rows]


async def replace_availability(
    conn: asyncpg.Connection, coach_user_id: UUID, windows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    async with conn.transaction():
        await conn.execute("DELETE FROM coach_availability_templates WHERE coach_user_id = $1", coach_user_id)
        inserted = []
        for window in windows:
            row = await conn.fetchrow(
                f"""
                INSERT INTO coach_availability_templates (coach_user_id, weekday, start_time, end_time)
                VALUES ($1, $2, $3, $4)
                RETURNING {_AVAILABILITY_FIELDS}
                """,
                coach_user_id,
                window["weekday"],
                window["start_time"],
                window["end_time"],
            )
            inserted.append(dict(row))
        return inserted
