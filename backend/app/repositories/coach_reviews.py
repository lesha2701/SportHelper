"""Data access for coach reviews. All queries are parameterized."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg


async def get_rating_summary(conn: asyncpg.Connection, coach_user_id: UUID) -> dict[str, Any]:
    row = await conn.fetchrow(
        "SELECT AVG(rating)::float AS average, COUNT(*) AS count FROM coach_reviews WHERE coach_user_id = $1",
        coach_user_id,
    )
    return {"average": row["average"], "count": row["count"]}


async def list_recent_for_coach(conn: asyncpg.Connection, coach_user_id: UUID, limit: int = 10) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT r.id, u.first_name AS athlete_first_name, r.rating, r.text, r.created_at
        FROM coach_reviews r
        JOIN users u ON u.id = r.athlete_user_id
        WHERE r.coach_user_id = $1
        ORDER BY r.created_at DESC
        LIMIT $2
        """,
        coach_user_id,
        limit,
    )
    return [dict(row) for row in rows]
