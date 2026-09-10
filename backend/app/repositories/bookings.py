"""Data access for coach-marketplace bookings. All queries are parameterized."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

import asyncpg

from app.repositories import trainings as trainings_repo

_BOOKING_FIELDS = (
    "b.id, b.coach_user_id, cp.full_name AS coach_full_name, b.athlete_user_id, b.starts_at, "
    "b.duration_minutes, b.format, b.price_per_session, b.currency, b.status, b.training_id"
)

_BOOKING_INSERT_FIELDS = (
    "id, coach_user_id, athlete_user_id, starts_at, duration_minutes, format, "
    "price_per_session, currency, status, training_id"
)


async def create_booking(
    conn: asyncpg.Connection,
    *,
    coach_user_id: UUID,
    athlete_user_id: UUID,
    starts_at: datetime,
    duration_minutes: int,
    format: str,
    price_per_session: float | None,
    currency: str,
    location: str | None,
) -> dict[str, Any] | None:
    """Creates a pending booking request — no Training is created here
    anymore; that only happens once the coach confirms (see
    confirm_booking). Returns None if the slot was already taken (unique-
    constraint race, now scoped to pending+confirmed bookings only)."""
    try:
        row = await conn.fetchrow(
            f"""
            INSERT INTO bookings (
                coach_user_id, athlete_user_id, starts_at, duration_minutes, format,
                price_per_session, currency, status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
            RETURNING {_BOOKING_INSERT_FIELDS}, created_at
            """,
            coach_user_id,
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
    result["coach_full_name"] = (
        await conn.fetchrow("SELECT full_name FROM coach_profiles WHERE user_id = $1", coach_user_id)
    )["full_name"]
    return result


async def get_booking(conn: asyncpg.Connection, booking_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"""
        SELECT {_BOOKING_FIELDS} FROM bookings b
        JOIN coach_profiles cp ON cp.user_id = b.coach_user_id
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
    with the expiry sweep) — the route layer turns that into a 409."""
    async with conn.transaction():
        booking = await conn.fetchrow(
            "SELECT * FROM bookings WHERE id = $1 AND coach_user_id = $2 AND status = 'pending' FOR UPDATE",
            booking_id,
            coach_user_id,
        )
        if booking is None:
            return None
        coach_profile = await conn.fetchrow("SELECT location FROM coach_profiles WHERE user_id = $1", coach_user_id)
        training = await trainings_repo.create_training(
            conn,
            booking["athlete_user_id"],
            type="personal",
            training_date=booking["starts_at"].date(),
            start_time=booking["starts_at"].time(),
            duration_minutes=booking["duration_minutes"],
            location=coach_profile["location"] if booking["format"] == "offline" else "Онлайн",
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
    """Auto-declines every 'pending' booking created before `older_than`.
    Called by the background tick with a rolling 24h cutoff — see
    app.services.background.sweep_expired_bookings."""
    rows = await conn.fetch(
        "UPDATE bookings SET status = 'expired', responded_at = now() "
        "WHERE status = 'pending' AND created_at < $1 "
        "RETURNING id, athlete_user_id",
        older_than,
    )
    return [dict(row) for row in rows]


async def list_pending_for_coach(conn: asyncpg.Connection, coach_user_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT b.id, b.athlete_user_id, b.starts_at, b.duration_minutes, b.format,
               b.price_per_session, b.currency, b.created_at,
               u.first_name || COALESCE(' ' || u.last_name, '') AS athlete_full_name
        FROM bookings b
        JOIN users u ON u.id = b.athlete_user_id
        WHERE b.coach_user_id = $1 AND b.status = 'pending'
        ORDER BY b.created_at ASC
        """,
        coach_user_id,
    )
    return [dict(row) for row in rows]
