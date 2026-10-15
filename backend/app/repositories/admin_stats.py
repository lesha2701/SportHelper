"""Platform statistics for the admin dashboard. Every number comes straight from PostgreSQL.

Time: "today" and every chart day are UTC calendar days (the same convention user_activity_days uses), so
the registration chart, the activity chart and DAU/WAU/MAU all agree. Training dates are plain calendar
dates without a time zone, so "upcoming" compares them with the database's CURRENT_DATE.
"""
from __future__ import annotations

from typing import Any

import asyncpg

CHART_DAYS = 30
_TODAY = "(now() AT TIME ZONE 'UTC')::date"


async def get_dashboard(conn: asyncpg.Connection) -> dict[str, Any]:
    counts = await conn.fetchrow(
        f"""
        WITH live AS (SELECT id, created_at, is_banned, banned_until FROM users WHERE deleted_at IS NULL)
        SELECT
            (SELECT count(*) FROM live) AS users_total,
            (SELECT count(*) FROM live WHERE (created_at AT TIME ZONE 'UTC')::date = {_TODAY}) AS users_new_today,
            (SELECT count(*) FROM live WHERE (created_at AT TIME ZONE 'UTC')::date > {_TODAY} - 7) AS users_new_7d,
            (SELECT count(*) FROM live WHERE (created_at AT TIME ZONE 'UTC')::date > {_TODAY} - 30) AS users_new_30d,
            (SELECT count(*) FROM player_profiles p JOIN live ON live.id = p.user_id) AS players,
            (SELECT count(*) FROM coach_profiles c JOIN live ON live.id = c.user_id) AS coaches,
            (SELECT count(*) FROM live WHERE is_banned AND (banned_until IS NULL OR banned_until > now())) AS users_banned,
            (SELECT count(DISTINCT a.user_id) FROM user_activity_days a JOIN live ON live.id = a.user_id
                WHERE a.day = {_TODAY}) AS dau,
            (SELECT count(DISTINCT a.user_id) FROM user_activity_days a JOIN live ON live.id = a.user_id
                WHERE a.day > {_TODAY} - 7) AS wau,
            (SELECT count(DISTINCT a.user_id) FROM user_activity_days a JOIN live ON live.id = a.user_id
                WHERE a.day > {_TODAY} - 30) AS mau,
            (SELECT min(day) FROM user_activity_days) AS activity_since,
            (SELECT count(*) FROM trainings WHERE deleted_at IS NULL) AS trainings_total,
            (SELECT count(*) FROM trainings WHERE deleted_at IS NULL AND status = 'scheduled') AS trainings_active,
            (SELECT count(*) FROM trainings WHERE deleted_at IS NULL AND status = 'scheduled'
                AND training_date >= CURRENT_DATE) AS trainings_upcoming,
            (SELECT count(*) FROM trainings WHERE deleted_at IS NULL AND status = 'completed') AS trainings_completed,
            (SELECT count(*) FROM bookings) AS bookings_total,
            (SELECT count(*) FROM bookings WHERE status = 'confirmed') AS bookings_confirmed,
            (SELECT count(*) FROM bookings WHERE status = 'confirmed' AND starts_at >= now()) AS bookings_upcoming
        """
    )
    return {
        **dict(counts),
        "registrations": await _series(conn, "users", "created_at", "deleted_at IS NULL"),
        "active_users": await _active_series(conn),
        "trainings_created": await _series(conn, "trainings", "created_at", "deleted_at IS NULL"),
        "bookings_created": await _series(conn, "bookings", "created_at", "TRUE"),
    }


async def _series(conn: asyncpg.Connection, table: str, column: str, where: str) -> list[dict[str, Any]]:
    """Rows per UTC day for the last CHART_DAYS days, zero-filled. Identifiers are fixed literals from this module."""
    rows = await conn.fetch(
        f"""
        SELECT d.day, COALESCE(c.n, 0) AS count
        FROM (SELECT ({_TODAY} - {CHART_DAYS - 1} + g.i) AS day FROM generate_series(0, {CHART_DAYS - 1}) AS g(i)) d
        LEFT JOIN (
            SELECT ({column} AT TIME ZONE 'UTC')::date AS day, count(*) AS n
            FROM {table}
            WHERE {where} AND ({column} AT TIME ZONE 'UTC')::date > {_TODAY} - {CHART_DAYS}
            GROUP BY 1
        ) c ON c.day = d.day
        ORDER BY d.day
        """
    )
    return [{"day": r["day"], "count": r["count"]} for r in rows]


async def _active_series(conn: asyncpg.Connection) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT d.day, COALESCE(c.n, 0) AS count
        FROM (SELECT ({_TODAY} - {CHART_DAYS - 1} + g.i) AS day FROM generate_series(0, {CHART_DAYS - 1}) AS g(i)) d
        LEFT JOIN (
            SELECT a.day, count(*) AS n
            FROM user_activity_days a JOIN users u ON u.id = a.user_id AND u.deleted_at IS NULL
            WHERE a.day > {_TODAY} - {CHART_DAYS}
            GROUP BY a.day
        ) c ON c.day = d.day
        ORDER BY d.day
        """
    )
    return [{"day": r["day"], "count": r["count"]} for r in rows]
