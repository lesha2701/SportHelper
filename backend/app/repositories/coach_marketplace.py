"""Data access for coach marketplace settings, public discovery and
availability. All queries are parameterized."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any
from uuid import UUID

import asyncpg

from app.repositories import coach_reviews as coach_reviews_repo

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


def _card_row_to_dict(row: dict[str, Any], rating: dict[str, Any], next_slot: datetime | None) -> dict[str, Any]:
    return {
        "user_id": row["user_id"],
        "full_name": row["full_name"],
        "photo_url": row["photo_url"],
        "sport": row["sport"],
        "specialization": row["specialization"],
        "description": row["description"],
        "experience_years": row["experience_years"],
        "average_rating": rating["average"],
        "review_count": rating["count"],
        "price_per_session": row["price_per_session"],
        "currency": row["currency"],
        "location": row["location"],
        "offers_online": row["offers_online"],
        "offers_offline": row["offers_offline"],
        "next_available_slot": next_slot,
    }


async def list_listed_coaches(
    conn: asyncpg.Connection,
    *,
    sport: str | None = None,
    location: str | None = None,
    max_price=None,
    min_rating: float | None = None,
    training_format: str | None = None,
    min_experience_years: int | None = None,
) -> list[dict[str, Any]]:
    conditions = ["cp.is_listed = TRUE"]
    params: list[Any] = []

    def add(condition: str, value: Any) -> None:
        params.append(value)
        conditions.append(condition.format(len(params)))

    if sport:
        add("cp.sport ILIKE '%' || ${} || '%'", sport)
    if location:
        add("cp.location ILIKE '%' || ${} || '%'", location)
    if max_price is not None:
        add("cp.price_per_session <= ${}", max_price)
    if min_experience_years is not None:
        add("cp.experience_years >= ${}", min_experience_years)
    if training_format == "online":
        conditions.append("cp.offers_online = TRUE")
    elif training_format == "offline":
        conditions.append("cp.offers_offline = TRUE")

    rows = await conn.fetch(
        f"""
        SELECT cp.user_id, cp.full_name, u.photo_url, cp.sport, cp.specialization, cp.description,
               cp.experience_years, cp.price_per_session, cp.currency, cp.location,
               cp.offers_online, cp.offers_offline
        FROM coach_profiles cp
        JOIN users u ON u.id = cp.user_id
        WHERE {" AND ".join(conditions)}
        ORDER BY cp.full_name
        """,
        *params,
    )

    cards = []
    for row in rows:
        row = dict(row)
        rating = await coach_reviews_repo.get_rating_summary(conn, row["user_id"])
        if min_rating is not None and (rating["average"] or 0) < min_rating:
            continue
        next_slot = await _next_available_slot(conn, row["user_id"])
        cards.append(_card_row_to_dict(row, rating, next_slot))
    return cards


async def get_public_profile(conn: asyncpg.Connection, coach_user_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        """
        SELECT cp.user_id, cp.full_name, u.photo_url, cp.sport, cp.specialization, cp.description,
               cp.experience_years, cp.price_per_session, cp.currency, cp.location,
               cp.offers_online, cp.offers_offline, cp.session_duration_minutes
        FROM coach_profiles cp
        JOIN users u ON u.id = cp.user_id
        WHERE cp.user_id = $1 AND cp.is_listed = TRUE
        """,
        coach_user_id,
    )
    if row is None:
        return None
    row = dict(row)
    rating = await coach_reviews_repo.get_rating_summary(conn, coach_user_id)
    next_slot = await _next_available_slot(conn, coach_user_id)
    card = _card_row_to_dict(row, rating, next_slot)
    card["session_duration_minutes"] = row["session_duration_minutes"]
    card["availability"] = await list_availability(conn, coach_user_id)
    card["recent_reviews"] = await coach_reviews_repo.list_recent_for_coach(conn, coach_user_id)
    return card


async def compute_open_slots(
    conn: asyncpg.Connection, coach_user_id: UUID, from_date: date, to_date: date
) -> list[dict[str, Any]]:
    settings = await get_settings(conn, coach_user_id)
    duration = (settings or {}).get("session_duration_minutes")
    if not duration:
        return []
    windows = await list_availability(conn, coach_user_id)
    booked_rows = await conn.fetch(
        "SELECT starts_at FROM bookings WHERE coach_user_id = $1 AND status = 'confirmed' "
        "AND starts_at >= $2 AND starts_at < $3",
        coach_user_id,
        datetime.combine(from_date, time.min),
        datetime.combine(to_date + timedelta(days=1), time.min),
    )
    booked = {row["starts_at"] for row in booked_rows}

    slots: list[dict[str, Any]] = []
    day = from_date
    while day <= to_date:
        for window in windows:
            if window["weekday"] != day.weekday():
                continue
            cursor = datetime.combine(day, window["start_time"])
            window_end = datetime.combine(day, window["end_time"])
            while cursor + timedelta(minutes=duration) <= window_end:
                if cursor not in booked and cursor > datetime.now():
                    slots.append({"starts_at": cursor, "duration_minutes": duration})
                cursor += timedelta(minutes=duration)
        day += timedelta(days=1)
    return sorted(slots, key=lambda s: s["starts_at"])


async def _next_available_slot(conn: asyncpg.Connection, coach_user_id: UUID) -> datetime | None:
    today = date.today()
    slots = await compute_open_slots(conn, coach_user_id, today, today + timedelta(days=28))
    return slots[0]["starts_at"] if slots else None
