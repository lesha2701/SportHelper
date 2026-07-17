"""Data access for trainings and attendance. All queries are parameterized."""
from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID, uuid4

import asyncpg

_TRAINING_FIELDS = (
    "id, team_id, created_by, type, plan_id, training_date, start_time, "
    "duration_minutes, location, description, status, reminder_minutes_before, "
    "recurrence_group_id, responsible_user_id, created_at, updated_at"
)
_ATTENDANCE_FIELDS = (
    "a.training_id, a.user_id, u.telegram_id, u.first_name, u.last_name, "
    "u.photo_url, a.status, a.marked_by, a.marked_at"
)
# Upcoming trainings first (soonest at the very top), then past ones below
# them (most recent past first) — this reads much more naturally as "what's
# next" than a flat chronological or reverse-chronological order.
_UPCOMING_FIRST_ORDER = """
    ORDER BY
        CASE WHEN training_date >= CURRENT_DATE THEN 0 ELSE 1 END,
        CASE WHEN training_date >= CURRENT_DATE THEN training_date END ASC,
        CASE WHEN training_date >= CURRENT_DATE THEN start_time END ASC,
        CASE WHEN training_date < CURRENT_DATE THEN training_date END DESC,
        CASE WHEN training_date < CURRENT_DATE THEN start_time END DESC
"""


async def create_training(conn: asyncpg.Connection, created_by: UUID, **fields: Any) -> dict[str, Any]:
    columns = ["created_by", *fields.keys()]
    placeholders = [f"${i + 1}" for i in range(len(columns))]
    values = [created_by, *fields.values()]
    row = await conn.fetchrow(
        f"INSERT INTO trainings ({', '.join(columns)}) VALUES ({', '.join(placeholders)}) RETURNING {_TRAINING_FIELDS}",
        *values,
    )
    return dict(row)


async def create_recurring_series(
    conn: asyncpg.Connection, created_by: UUID, dates: list[date], **fields: Any
) -> list[dict[str, Any]]:
    """Creates one training row per date, all sharing a fresh recurrence_group_id."""
    group_id = uuid4()
    created: list[dict[str, Any]] = []
    async with conn.transaction():
        for training_date in dates:
            row = await create_training(
                conn, created_by, training_date=training_date, recurrence_group_id=group_id, **fields
            )
            created.append(row)
    return created


async def get_training(conn: asyncpg.Connection, training_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"SELECT {_TRAINING_FIELDS} FROM trainings WHERE id = $1 AND deleted_at IS NULL", training_id
    )
    return dict(row) if row else None


async def update_training(conn: asyncpg.Connection, training_id: UUID, **fields: Any) -> dict[str, Any] | None:
    set_clauses = [f"{key} = ${i + 2}" for i, key in enumerate(fields.keys())]
    row = await conn.fetchrow(
        f"""
        UPDATE trainings SET {", ".join(set_clauses)}
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING {_TRAINING_FIELDS}
        """,
        training_id,
        *fields.values(),
    )
    return dict(row) if row else None


async def soft_delete(conn: asyncpg.Connection, training_id: UUID) -> bool:
    result = await conn.execute(
        "UPDATE trainings SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL", training_id
    )
    return result.endswith("1")


async def cancel_series(conn: asyncpg.Connection, recurrence_group_id: UUID) -> int:
    result = await conn.execute(
        """
        UPDATE trainings SET status = 'cancelled'
        WHERE recurrence_group_id = $1 AND deleted_at IS NULL AND status != 'cancelled'
        """,
        recurrence_group_id,
    )
    return int(result.split()[-1])


async def list_team_trainings(conn: asyncpg.Connection, team_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT {_TRAINING_FIELDS} FROM trainings
        WHERE team_id = $1 AND deleted_at IS NULL
        {_UPCOMING_FIRST_ORDER}
        """,
        team_id,
    )
    return [dict(row) for row in rows]


async def list_recurrence_group(conn: asyncpg.Connection, recurrence_group_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"SELECT {_TRAINING_FIELDS} FROM trainings WHERE recurrence_group_id = $1 AND deleted_at IS NULL",
        recurrence_group_id,
    )
    return [dict(row) for row in rows]


async def list_personal_trainings(conn: asyncpg.Connection, owner_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT {_TRAINING_FIELDS} FROM trainings
        WHERE type = 'personal' AND created_by = $1 AND deleted_at IS NULL
        {_UPCOMING_FIRST_ORDER}
        """,
        owner_id,
    )
    return [dict(row) for row in rows]


async def list_calendar_trainings(
    conn: asyncpg.Connection, user_id: UUID, date_from: date, date_to: date
) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT t.id, t.type, t.training_date, t.start_time, t.status, t.team_id, tm.name AS team_name
        FROM trainings t
        LEFT JOIN teams tm ON tm.id = t.team_id
        WHERE t.deleted_at IS NULL
          AND t.training_date BETWEEN $2 AND $3
          AND (
            (t.type = 'personal' AND t.created_by = $1)
            OR (t.team_id IS NOT NULL AND t.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))
          )
        ORDER BY t.training_date, t.start_time
        """,
        user_id,
        date_from,
        date_to,
    )
    return [dict(row) for row in rows]


async def count_team_trainings_summary(conn: asyncpg.Connection, team_id: UUID) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (WHERE training_date <= CURRENT_DATE) AS completed,
            COUNT(*) FILTER (WHERE training_date > CURRENT_DATE) AS upcoming,
            COUNT(*) FILTER (WHERE type = 'independent') AS independent
        FROM trainings
        WHERE team_id = $1 AND deleted_at IS NULL AND type IN ('team', 'independent')
        """,
        team_id,
    )
    return dict(row)


async def team_player_attendance(conn: asyncpg.Connection, team_id: UUID) -> list[dict[str, Any]]:
    """Per-member present/absent counts across the team's own past
    team/independent trainings (a training only counts once it's on or
    before today — status isn't reliably kept up to date by coaches)."""
    rows = await conn.fetch(
        """
        SELECT m.user_id, u.first_name, u.last_name,
               COUNT(a.status) FILTER (WHERE a.status = 'present') AS present_count,
               COUNT(a.status) FILTER (WHERE a.status = 'absent') AS absent_count
        FROM team_members m
        JOIN users u ON u.id = m.user_id
        LEFT JOIN trainings t ON t.team_id = m.team_id AND t.deleted_at IS NULL
            AND t.type IN ('team', 'independent') AND t.training_date <= CURRENT_DATE
        LEFT JOIN training_attendance a ON a.training_id = t.id AND a.user_id = m.user_id
        WHERE m.team_id = $1
        GROUP BY m.user_id, u.first_name, u.last_name
        ORDER BY u.first_name
        """,
        team_id,
    )
    return [dict(row) for row in rows]


async def player_attendance_summary(conn: asyncpg.Connection, user_id: UUID) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        SELECT
            COUNT(a.status) FILTER (WHERE a.status = 'present') AS present_count,
            COUNT(a.status) AS total_count,
            COALESCE(SUM(t.duration_minutes) FILTER (WHERE a.status = 'present'), 0) AS minutes_present
        FROM training_attendance a
        JOIN trainings t ON t.id = a.training_id AND t.deleted_at IS NULL
        WHERE a.user_id = $1 AND t.type IN ('team', 'independent') AND t.training_date <= CURRENT_DATE
        """,
        user_id,
    )
    return dict(row)


async def player_training_counts(conn: asyncpg.Connection, user_id: UUID) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (WHERE type = 'personal' AND training_date <= CURRENT_DATE) AS personal_count,
            COALESCE(SUM(duration_minutes) FILTER (WHERE type = 'personal' AND training_date <= CURRENT_DATE), 0) AS personal_minutes
        FROM trainings
        WHERE created_by = $1 AND deleted_at IS NULL
        """,
        user_id,
    )
    return dict(row)


async def player_attendance_history(conn: asyncpg.Connection, user_id: UUID) -> list[dict[str, Any]]:
    """Most-recent-first attendance rows for the player's team/independent
    trainings — the route walks this to compute a consecutive-presence
    streak."""
    rows = await conn.fetch(
        """
        SELECT a.status, t.training_date
        FROM training_attendance a
        JOIN trainings t ON t.id = a.training_id AND t.deleted_at IS NULL
        WHERE a.user_id = $1 AND t.type IN ('team', 'independent') AND t.training_date <= CURRENT_DATE
        ORDER BY t.training_date DESC, t.start_time DESC
        """,
        user_id,
    )
    return [dict(row) for row in rows]


async def ensure_attendance_initialized(conn: asyncpg.Connection, training_id: UUID, team_id: UUID) -> None:
    """Creates a 'present' attendance row for every current team member who
    doesn't have one yet, so the coach only has to flip absentees."""
    await conn.execute(
        """
        INSERT INTO training_attendance (training_id, user_id, status)
        SELECT $1, m.user_id, 'present'
        FROM team_members m
        WHERE m.team_id = $2
        ON CONFLICT (training_id, user_id) DO NOTHING
        """,
        training_id,
        team_id,
    )


async def list_attendance(conn: asyncpg.Connection, training_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT {_ATTENDANCE_FIELDS}
        FROM training_attendance a
        JOIN users u ON u.id = a.user_id
        WHERE a.training_id = $1
        ORDER BY u.first_name
        """,
        training_id,
    )
    return [dict(row) for row in rows]


async def get_attendance_for_user(conn: asyncpg.Connection, training_id: UUID, user_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"SELECT {_ATTENDANCE_FIELDS} FROM training_attendance a JOIN users u ON u.id = a.user_id "
        "WHERE a.training_id = $1 AND a.user_id = $2",
        training_id,
        user_id,
    )
    return dict(row) if row else None


async def set_attendance_status(
    conn: asyncpg.Connection, training_id: UUID, user_id: UUID, status: str, marked_by: UUID
) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        """
        UPDATE training_attendance SET status = $3, marked_by = $4, marked_at = now()
        WHERE training_id = $1 AND user_id = $2
        RETURNING training_id
        """,
        training_id,
        user_id,
        status,
        marked_by,
    )
    if row is None:
        return None
    full = await conn.fetchrow(
        f"""
        SELECT {_ATTENDANCE_FIELDS}
        FROM training_attendance a
        JOIN users u ON u.id = a.user_id
        WHERE a.training_id = $1 AND a.user_id = $2
        """,
        training_id,
        user_id,
    )
    return dict(full)
