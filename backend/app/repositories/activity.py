"""Per-day user activity (DAU/WAU/MAU source). One row per user per UTC day."""
from __future__ import annotations

from uuid import UUID

import asyncpg

# Every activity day is a UTC calendar day, so the numbers do not shift with a server's or viewer's time zone.
ACTIVITY_TIME_ZONE = "UTC"


async def record(conn: asyncpg.Connection, user_id: UUID) -> None:
    """Marks the user as active today (UTC) and remembers when they were last seen. Idempotent."""
    await conn.execute(
        """
        WITH day_row AS (
            INSERT INTO user_activity_days (user_id, day)
            VALUES ($1, (now() AT TIME ZONE 'UTC')::date)
            ON CONFLICT (user_id, day) DO UPDATE SET last_seen_at = now()
            RETURNING 1
        )
        UPDATE users SET last_active_at = now() WHERE id = $1
        """,
        user_id,
    )
