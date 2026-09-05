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
    """Returns None if the slot was already taken (unique-constraint race)."""
    async with conn.transaction():
        training = await trainings_repo.create_training(
            conn,
            athlete_user_id,
            type="personal",
            training_date=starts_at.date(),
            start_time=starts_at.time(),
            duration_minutes=duration_minutes,
            location=location if format == "offline" else "Онлайн",
            description="Бронирование тренера через маркетплейс",
        )
        try:
            row = await conn.fetchrow(
                f"""
                INSERT INTO bookings (
                    coach_user_id, athlete_user_id, starts_at, duration_minutes, format,
                    price_per_session, currency, training_id
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING {_BOOKING_INSERT_FIELDS}
                """,
                coach_user_id,
                athlete_user_id,
                starts_at,
                duration_minutes,
                format,
                price_per_session,
                currency,
                training["id"],
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
