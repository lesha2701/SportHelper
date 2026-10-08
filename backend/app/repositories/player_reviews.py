"""Data access for player_reviews: a coach's review of an athlete after a
booked session. All queries are parameterized."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg


async def get_by_booking(conn: asyncpg.Connection, booking_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow("SELECT id, booking_id, rating, text FROM player_reviews WHERE booking_id = $1", booking_id)
    return dict(row) if row else None


async def create_review(
    conn: asyncpg.Connection, *, booking_id: UUID, coach_user_id: UUID, athlete_user_id: UUID, rating: int, text: str | None
) -> dict[str, Any] | None:
    """Returns None if the booking already has a review (unique-constraint race)."""
    try:
        row = await conn.fetchrow(
            """
            INSERT INTO player_reviews (booking_id, coach_user_id, athlete_user_id, rating, text)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, booking_id, rating, text
            """,
            booking_id,
            coach_user_id,
            athlete_user_id,
            rating,
            text,
        )
    except asyncpg.UniqueViolationError:
        return None
    return dict(row)


async def get_rating_summary(conn: asyncpg.Connection, athlete_user_id: UUID) -> dict[str, Any]:
    row = await conn.fetchrow(
        "SELECT AVG(rating)::float AS average, COUNT(*) AS count FROM player_reviews WHERE athlete_user_id = $1",
        athlete_user_id,
    )
    return {"average": row["average"], "count": row["count"]}


async def list_recent_for_player(conn: asyncpg.Connection, athlete_user_id: UUID, limit: int = 20) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT r.id, COALESCE(cp.full_name, u.first_name) AS coach_name, r.rating, r.text, r.created_at
        FROM player_reviews r
        JOIN users u ON u.id = r.coach_user_id
        LEFT JOIN coach_profiles cp ON cp.user_id = r.coach_user_id
        WHERE r.athlete_user_id = $1
        ORDER BY r.created_at DESC
        LIMIT $2
        """,
        athlete_user_id,
        limit,
    )
    return [dict(row) for row in rows]
