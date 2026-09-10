"""Data access for coach-marketplace bookings. All queries are parameterized."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import asyncpg

from app.repositories import trainings as trainings_repo

_BOOKING_FIELDS = (
    "b.id, b.coach_user_id, cp.full_name AS coach_full_name, b.listing_id, cl.title AS listing_title, "
    "b.athlete_user_id, b.starts_at, b.duration_minutes, b.format, b.price_per_session, b.currency, "
    "b.status, b.training_id"
)

_BOOKING_INSERT_FIELDS = (
    "id, coach_user_id, listing_id, athlete_user_id, starts_at, duration_minutes, format, "
    "price_per_session, currency, status, training_id"
)


async def create_booking(
    conn: asyncpg.Connection,
    *,
    listing_id: UUID,
    coach_user_id: UUID,
    athlete_user_id: UUID,
    starts_at: datetime,
    duration_minutes: int,
    format: str,
    price_per_session: float | None,
    currency: str,
) -> dict[str, Any] | None:
    """Creates a pending booking request against a specific listing — no
    Training is created here; that only happens once the coach confirms
    (see confirm_booking). Returns None if the slot was already taken."""
    try:
        row = await conn.fetchrow(
            f"""
            INSERT INTO bookings (
                coach_user_id, listing_id, athlete_user_id, starts_at, duration_minutes, format,
                price_per_session, currency, status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
            RETURNING {_BOOKING_INSERT_FIELDS}, created_at
            """,
            coach_user_id,
            listing_id,
            athlete_user_id,
            starts_at,
            duration_minutes,
            format,
            price_per_session,
            currency,
        )
    except asyncpg.UniqueViolationError:
        return None
    result = dict(row)
    coach_and_listing = await conn.fetchrow(
        "SELECT cp.full_name, cl.title FROM coach_profiles cp JOIN coach_listings cl ON cl.id = $2 "
        "WHERE cp.user_id = $1",
        coach_user_id,
        listing_id,
    )
    result["coach_full_name"] = coach_and_listing["full_name"]
    result["listing_title"] = coach_and_listing["title"]
    return result


async def get_booking(conn: asyncpg.Connection, booking_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"""
        SELECT {_BOOKING_FIELDS} FROM bookings b
        JOIN coach_profiles cp ON cp.user_id = b.coach_user_id
        LEFT JOIN coach_listings cl ON cl.id = b.listing_id
        WHERE b.id = $1
        """,
        booking_id,
    )
    return dict(row) if row else None


async def list_for_athlete(conn: asyncpg.Connection, athlete_user_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT {_BOOKING_FIELDS} FROM bookings b
        JOIN coach_profiles cp ON cp.user_id = b.coach_user_id
        LEFT JOIN coach_listings cl ON cl.id = b.listing_id
        WHERE b.athlete_user_id = $1
        ORDER BY b.starts_at DESC
        """,
        athlete_user_id,
    )
    return [dict(row) for row in rows]


def is_completed(booking: dict[str, Any]) -> bool:
    ends_at = booking["starts_at"] + timedelta(minutes=booking["duration_minutes"])
    return booking["status"] == "confirmed" and datetime.now(ends_at.tzinfo) > ends_at


async def confirm_booking(conn: asyncpg.Connection, *, booking_id: UUID, coach_user_id: UUID) -> dict[str, Any] | None:
    """Confirms a pending booking: creates the linked Training and flips the
    booking to 'confirmed', in one transaction. Returns None if the booking
    isn't this coach's currently-pending one (already handled, or a race
    with the expiry sweep), or if its session start time has already
    passed — the route layer turns either case into the same 409. A booking
    whose starts_at has passed is deliberately left 'pending' here rather
    than flipped to anything else; the next sweep_expired tick (which also
    checks starts_at) will transition it out of 'pending'."""
    async with conn.transaction():
        booking = await conn.fetchrow(
            "SELECT * FROM bookings WHERE id = $1 AND coach_user_id = $2 AND status = 'pending' FOR UPDATE",
            booking_id,
            coach_user_id,
        )
        if booking is None:
            return None
        if booking["starts_at"] <= datetime.now(timezone.utc):
            return None
        listing = await conn.fetchrow("SELECT location FROM coach_listings WHERE id = $1", booking["listing_id"])
        training = await trainings_repo.create_training(
            conn,
            booking["athlete_user_id"],
            type="personal",
            training_date=booking["starts_at"].date(),
            start_time=booking["starts_at"].time(),
            duration_minutes=booking["duration_minutes"],
            location=(listing["location"] if listing else None) if booking["format"] == "offline" else "Онлайн",
            description="Бронирование тренера через маркетплейс",
        )
        await conn.execute(
            "UPDATE bookings SET status = 'confirmed', training_id = $1, responded_at = now() WHERE id = $2",
            training["id"],
            booking_id,
        )
    return await get_booking(conn, booking_id)


async def decline_booking(conn: asyncpg.Connection, *, booking_id: UUID, coach_user_id: UUID) -> dict[str, Any] | None:
    """Returns None if the booking isn't this coach's currently-pending one."""
    result = await conn.execute(
        "UPDATE bookings SET status = 'declined', responded_at = now() "
        "WHERE id = $1 AND coach_user_id = $2 AND status = 'pending'",
        booking_id,
        coach_user_id,
    )
    if not result.endswith("1"):
        return None
    return await get_booking(conn, booking_id)


async def sweep_expired(conn: asyncpg.Connection, *, older_than: datetime) -> list[dict[str, Any]]:
    """Auto-declines every 'pending' booking created before `older_than`, and
    also any 'pending' booking whose session start time has already passed
    (regardless of when it was created) — a slot can be requested as little
    as 1 minute before it starts, so relying on the 24h creation-time cutoff
    alone would leave same-day requests confirmable long after their session
    time. Called by the background tick with a rolling 24h cutoff — see
    app.services.background.sweep_expired_bookings."""
    rows = await conn.fetch(
        "UPDATE bookings SET status = 'expired', responded_at = now() "
        "WHERE status = 'pending' AND (created_at < $1 OR starts_at < now()) "
        "RETURNING id, athlete_user_id",
        older_than,
    )
    return [dict(row) for row in rows]


async def list_pending_for_coach(conn: asyncpg.Connection, coach_user_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT b.id, cl.title AS listing_title, b.athlete_user_id, b.starts_at, b.duration_minutes, b.format,
               b.price_per_session, b.currency, b.created_at,
               u.first_name || COALESCE(' ' || u.last_name, '') AS athlete_full_name
        FROM bookings b
        JOIN users u ON u.id = b.athlete_user_id
        LEFT JOIN coach_listings cl ON cl.id = b.listing_id
        WHERE b.coach_user_id = $1 AND b.status = 'pending'
        ORDER BY b.created_at ASC
        """,
        coach_user_id,
    )
    return [dict(row) for row in rows]
