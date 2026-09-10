"""Data access for coach listings — one or more independently bookable
services per coach, each with its own price/duration/schedule/photo/
video. All queries are parameterized."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

_LISTING_FIELDS = (
    "id, coach_user_id, title, description, is_listed, price_per_session, currency, "
    "offers_online, offers_offline, location, session_duration_minutes, photo_file_id, video_file_id"
)


async def create_listing(conn: asyncpg.Connection, coach_user_id: UUID, *, title: str) -> dict[str, Any]:
    row = await conn.fetchrow(
        f"INSERT INTO coach_listings (coach_user_id, title) VALUES ($1, $2) RETURNING {_LISTING_FIELDS}",
        coach_user_id,
        title,
    )
    return dict(row)


async def get_listing(conn: asyncpg.Connection, listing_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"SELECT {_LISTING_FIELDS} FROM coach_listings WHERE id = $1 AND deleted_at IS NULL", listing_id
    )
    return dict(row) if row else None


async def list_for_coach(conn: asyncpg.Connection, coach_user_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"SELECT {_LISTING_FIELDS} FROM coach_listings WHERE coach_user_id = $1 AND deleted_at IS NULL ORDER BY created_at",
        coach_user_id,
    )
    return [dict(row) for row in rows]


async def update_listing(
    conn: asyncpg.Connection,
    listing_id: UUID,
    coach_user_id: UUID,
    *,
    title: str,
    description: str | None,
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
        UPDATE coach_listings SET
            title = $3, description = $4, is_listed = $5, price_per_session = $6, currency = $7,
            offers_online = $8, offers_offline = $9, location = $10, session_duration_minutes = $11,
            updated_at = now()
        WHERE id = $1 AND coach_user_id = $2 AND deleted_at IS NULL
        RETURNING {_LISTING_FIELDS}
        """,
        listing_id,
        coach_user_id,
        title,
        description,
        is_listed,
        price_per_session,
        currency,
        offers_online,
        offers_offline,
        location,
        session_duration_minutes,
    )
    return dict(row) if row else None


async def has_active_booking(conn: asyncpg.Connection, listing_id: UUID) -> bool:
    """True if this listing has a request awaiting the coach's response, or
    a confirmed booking whose session hasn't happened yet — either should
    block deleting the listing out from under it. A confirmed-and-already-
    completed booking does NOT block deletion."""
    return await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM bookings WHERE listing_id = $1 AND ("
        "status = 'pending' OR "
        "(status = 'confirmed' AND starts_at + (duration_minutes || ' minutes')::interval > now())"
        "))",
        listing_id,
    )


async def soft_delete_listing(conn: asyncpg.Connection, listing_id: UUID, coach_user_id: UUID) -> bool:
    result = await conn.execute(
        "UPDATE coach_listings SET deleted_at = now() WHERE id = $1 AND coach_user_id = $2 AND deleted_at IS NULL",
        listing_id,
        coach_user_id,
    )
    return result.endswith("1")


_AVAILABILITY_FIELDS = "id, weekday, start_time, end_time"


def _windows_overlap(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return a["weekday"] == b["weekday"] and a["start_time"] < b["end_time"] and b["start_time"] < a["end_time"]


def has_overlap(windows: list[dict[str, Any]]) -> bool:
    return any(_windows_overlap(a, b) for i, a in enumerate(windows) for b in windows[i + 1 :])


async def list_availability(conn: asyncpg.Connection, listing_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"SELECT {_AVAILABILITY_FIELDS} FROM coach_listing_availability "
        "WHERE listing_id = $1 ORDER BY weekday, start_time",
        listing_id,
    )
    return [dict(row) for row in rows]


async def replace_availability(
    conn: asyncpg.Connection, listing_id: UUID, windows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    async with conn.transaction():
        await conn.execute("DELETE FROM coach_listing_availability WHERE listing_id = $1", listing_id)
        inserted = []
        for window in windows:
            row = await conn.fetchrow(
                f"""
                INSERT INTO coach_listing_availability (listing_id, weekday, start_time, end_time)
                VALUES ($1, $2, $3, $4)
                RETURNING {_AVAILABILITY_FIELDS}
                """,
                listing_id,
                window["weekday"],
                window["start_time"],
                window["end_time"],
            )
            inserted.append(dict(row))
        return inserted
