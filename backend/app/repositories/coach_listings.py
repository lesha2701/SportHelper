"""Data access for coach listings — one or more independently bookable
services per coach, each with its own price/duration/schedule/photo/
video. All queries are parameterized."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from uuid import UUID

import asyncpg

from app.repositories import coach_reviews as coach_reviews_repo

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


def _card_row_to_dict(row: dict[str, Any], coach_rating: dict[str, Any], next_slot: datetime | None) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"],
        "coach_user_id": row["coach_user_id"],
        "coach_full_name": row["coach_full_name"],
        "coach_photo_url": row["coach_photo_url"],
        "sport": row["sport"],
        "specialization": row["specialization"],
        "experience_years": row["experience_years"],
        "average_rating": coach_rating["average"],
        "review_count": coach_rating["count"],
        "price_per_session": row["price_per_session"],
        "currency": row["currency"],
        "location": row["location"],
        "offers_online": row["offers_online"],
        "offers_offline": row["offers_offline"],
        "photo_file_id": row["photo_file_id"],
        "next_available_slot": next_slot,
    }


async def list_listed(
    conn: asyncpg.Connection,
    *,
    sport: str | None = None,
    location: str | None = None,
    max_price: float | None = None,
    min_rating: float | None = None,
    training_format: str | None = None,
    min_experience_years: int | None = None,
) -> list[dict[str, Any]]:
    conditions = ["cl.is_listed = TRUE", "cl.deleted_at IS NULL"]
    params: list[Any] = []

    def add(condition: str, value: Any) -> None:
        params.append(value)
        conditions.append(condition.format(len(params)))

    if sport:
        add("cp.sport ILIKE '%' || ${} || '%'", sport)
    if location:
        add("cl.location ILIKE '%' || ${} || '%'", location)
    if max_price is not None:
        add("cl.price_per_session <= ${}", max_price)
    if min_experience_years is not None:
        add("cp.experience_years >= ${}", min_experience_years)
    if training_format == "online":
        conditions.append("cl.offers_online = TRUE")
    elif training_format == "offline":
        conditions.append("cl.offers_offline = TRUE")

    rows = await conn.fetch(
        f"""
        SELECT cl.id, cl.title, cl.description, cl.coach_user_id, cp.full_name AS coach_full_name,
               u.photo_url AS coach_photo_url, cp.sport, cp.specialization, cp.experience_years,
               cl.price_per_session, cl.currency, cl.location, cl.offers_online, cl.offers_offline,
               cl.photo_file_id
        FROM coach_listings cl
        JOIN coach_profiles cp ON cp.user_id = cl.coach_user_id
        JOIN users u ON u.id = cl.coach_user_id
        WHERE {" AND ".join(conditions)}
        ORDER BY cl.created_at
        """,
        *params,
    )

    cards = []
    for row in rows:
        row = dict(row)
        rating = await coach_reviews_repo.get_rating_summary(conn, row["coach_user_id"])
        if min_rating is not None and (rating["average"] or 0) < min_rating:
            continue
        next_slot = await _next_available_slot(conn, row["id"])
        cards.append(_card_row_to_dict(row, rating, next_slot))
    return cards


async def get_public_listing(conn: asyncpg.Connection, listing_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        """
        SELECT cl.id, cl.title, cl.description, cl.coach_user_id, cp.full_name AS coach_full_name,
               u.photo_url AS coach_photo_url, cp.sport, cp.specialization, cp.description AS coach_description,
               cp.experience_years, cl.price_per_session, cl.currency, cl.location, cl.offers_online,
               cl.offers_offline, cl.session_duration_minutes, cl.photo_file_id, cl.video_file_id
        FROM coach_listings cl
        JOIN coach_profiles cp ON cp.user_id = cl.coach_user_id
        JOIN users u ON u.id = cl.coach_user_id
        WHERE cl.id = $1 AND cl.is_listed = TRUE AND cl.deleted_at IS NULL
        """,
        listing_id,
    )
    if row is None:
        return None
    row = dict(row)
    rating = await coach_reviews_repo.get_rating_summary(conn, row["coach_user_id"])
    next_slot = await _next_available_slot(conn, listing_id)
    card = _card_row_to_dict(row, rating, next_slot)
    card["coach_description"] = row["coach_description"]
    card["session_duration_minutes"] = row["session_duration_minutes"]
    card["video_file_id"] = row["video_file_id"]
    card["availability"] = await list_availability(conn, listing_id)
    card["recent_reviews"] = await coach_reviews_repo.list_recent_for_coach(conn, row["coach_user_id"])
    return card


async def compute_open_slots(
    conn: asyncpg.Connection, listing_id: UUID, from_date: date, to_date: date
) -> list[dict[str, Any]]:
    listing = await get_listing(conn, listing_id)
    if listing is None or not listing.get("session_duration_minutes"):
        return []
    duration = listing["session_duration_minutes"]
    windows = await list_availability(conn, listing_id)
    # Booked-set is keyed on coach_user_id, not listing_id — a slot taken
    # via ANY of this coach's listings must disappear here too, since the
    # coach-wide double-booking guard spans every listing they own.
    booked_rows = await conn.fetch(
        "SELECT starts_at FROM bookings WHERE coach_user_id = $1 AND status IN ('pending', 'confirmed') "
        "AND starts_at >= $2 AND starts_at < $3",
        listing["coach_user_id"],
        datetime.combine(from_date, time.min, tzinfo=timezone.utc),
        datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=timezone.utc),
    )
    booked = {row["starts_at"] for row in booked_rows}

    slots: list[dict[str, Any]] = []
    day = from_date
    while day <= to_date:
        for window in windows:
            if window["weekday"] != day.weekday():
                continue
            cursor = datetime.combine(day, window["start_time"], tzinfo=timezone.utc)
            window_end = datetime.combine(day, window["end_time"], tzinfo=timezone.utc)
            while cursor + timedelta(minutes=duration) <= window_end:
                if cursor not in booked and cursor > datetime.now(timezone.utc):
                    slots.append({"starts_at": cursor, "duration_minutes": duration})
                cursor += timedelta(minutes=duration)
        day += timedelta(days=1)
    return sorted(slots, key=lambda s: s["starts_at"])


async def _next_available_slot(conn: asyncpg.Connection, listing_id: UUID) -> datetime | None:
    today = date.today()
    slots = await compute_open_slots(conn, listing_id, today, today + timedelta(days=28))
    return slots[0]["starts_at"] if slots else None
