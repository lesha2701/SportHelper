"""Data access for coach-assigned player tasks and their per-player
assignment/report cycle. All queries are parameterized."""
from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID

import asyncpg

_TASK_FIELDS = (
    "id, team_id, created_by, title, description, plan_id, deadline, "
    "metric_name, metric_unit, metric_target, "
    "require_comment, require_photo, require_video, require_sets_reps, "
    "require_duration, require_metric_value, require_difficulty, require_wellbeing, "
    "target_type, target_position, target_training_id, created_at, updated_at"
)
_TASK_EXERCISE_FIELDS = "te.id, te.task_id, te.exercise_id, e.name AS exercise_name, te.order_index"
_ASSIGNMENT_FIELDS = (
    "a.id, a.task_id, a.user_id, u.telegram_id, u.first_name, u.last_name, u.photo_url, "
    "tm.position, a.status, a.comment, a.photo_file_id, a.video_file_id, a.sets, a.reps, "
    "a.duration_minutes, a.metric_value, a.difficulty, a.wellbeing, a.coach_comment, "
    "a.reviewed_by, a.reviewed_at, a.viewed_at, a.submitted_at, a.created_at, a.updated_at"
)
_TASK_COLS_FOR_MINE = (
    "team_id", "created_by", "title", "description", "plan_id", "deadline",
    "metric_name", "metric_unit", "metric_target",
    "require_comment", "require_photo", "require_video", "require_sets_reps",
    "require_duration", "require_metric_value", "require_difficulty", "require_wellbeing",
    "target_type", "target_position", "target_training_id",
)


async def create_task(conn: asyncpg.Connection, team_id: UUID, created_by: UUID, **fields: Any) -> dict[str, Any]:
    columns = ["team_id", "created_by", *fields.keys()]
    placeholders = [f"${i + 1}" for i in range(len(columns))]
    values = [team_id, created_by, *fields.values()]
    row = await conn.fetchrow(
        f"INSERT INTO tasks ({', '.join(columns)}) VALUES ({', '.join(placeholders)}) RETURNING {_TASK_FIELDS}",
        *values,
    )
    return dict(row)


async def get_task(conn: asyncpg.Connection, task_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_TASK_FIELDS} FROM tasks WHERE id = $1 AND deleted_at IS NULL", task_id)
    return dict(row) if row else None


async def update_task(conn: asyncpg.Connection, task_id: UUID, **fields: Any) -> dict[str, Any] | None:
    set_clauses = [f"{key} = ${i + 2}" for i, key in enumerate(fields.keys())]
    row = await conn.fetchrow(
        f"""
        UPDATE tasks SET {", ".join(set_clauses)}
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING {_TASK_FIELDS}
        """,
        task_id,
        *fields.values(),
    )
    return dict(row) if row else None


async def soft_delete(conn: asyncpg.Connection, task_id: UUID) -> bool:
    result = await conn.execute("UPDATE tasks SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL", task_id)
    return result.endswith("1")


async def list_team_tasks(conn: asyncpg.Connection, team_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"SELECT {_TASK_FIELDS} FROM tasks WHERE team_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC",
        team_id,
    )
    return [dict(row) for row in rows]


async def set_task_exercises(conn: asyncpg.Connection, task_id: UUID, exercise_ids: list[UUID]) -> None:
    """Replaces the task's attached exercise list wholesale, in the given order."""
    async with conn.transaction():
        await conn.execute("DELETE FROM task_exercises WHERE task_id = $1", task_id)
        for index, exercise_id in enumerate(exercise_ids):
            await conn.execute(
                "INSERT INTO task_exercises (task_id, exercise_id, order_index) VALUES ($1, $2, $3)",
                task_id,
                exercise_id,
                index,
            )


async def list_task_exercises(conn: asyncpg.Connection, task_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT {_TASK_EXERCISE_FIELDS}
        FROM task_exercises te
        LEFT JOIN exercises e ON e.id = te.exercise_id
        WHERE te.task_id = $1
        ORDER BY te.order_index
        """,
        task_id,
    )
    return [dict(row) for row in rows]


async def bulk_create_assignments(conn: asyncpg.Connection, task_id: UUID, user_ids: list[UUID]) -> None:
    async with conn.transaction():
        for user_id in user_ids:
            await conn.execute(
                "INSERT INTO task_assignments (task_id, user_id) VALUES ($1, $2) "
                "ON CONFLICT (task_id, user_id) DO NOTHING",
                task_id,
                user_id,
            )


async def get_assignment(conn: asyncpg.Connection, task_id: UUID, user_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"""
        SELECT {_ASSIGNMENT_FIELDS}
        FROM task_assignments a
        JOIN users u ON u.id = a.user_id
        JOIN tasks t ON t.id = a.task_id
        LEFT JOIN team_members tm ON tm.team_id = t.team_id AND tm.user_id = a.user_id
        WHERE a.task_id = $1 AND a.user_id = $2
        """,
        task_id,
        user_id,
    )
    return dict(row) if row else None


async def list_assignments(conn: asyncpg.Connection, task_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT {_ASSIGNMENT_FIELDS}
        FROM task_assignments a
        JOIN users u ON u.id = a.user_id
        JOIN tasks t ON t.id = a.task_id
        LEFT JOIN team_members tm ON tm.team_id = t.team_id AND tm.user_id = a.user_id
        WHERE a.task_id = $1
        ORDER BY u.first_name
        """,
        task_id,
    )
    return [dict(row) for row in rows]


async def list_assignments_for_tasks(
    conn: asyncpg.Connection, task_ids: list[UUID], *, user_id: UUID | None = None
) -> dict[UUID, list[dict[str, Any]]]:
    """Batched form of list_assignments — one query for a whole list of
    tasks instead of one query per task (used when rendering a team's task
    list, to avoid an N+1). If user_id is given, only that user's own
    assignment is included per task (the player's-eye view)."""
    if not task_ids:
        return {}
    params: list[Any] = [task_ids]
    user_filter = ""
    if user_id is not None:
        user_filter = "AND a.user_id = $2"
        params.append(user_id)
    rows = await conn.fetch(
        f"""
        SELECT {_ASSIGNMENT_FIELDS}
        FROM task_assignments a
        JOIN users u ON u.id = a.user_id
        JOIN tasks t ON t.id = a.task_id
        LEFT JOIN team_members tm ON tm.team_id = t.team_id AND tm.user_id = a.user_id
        WHERE a.task_id = ANY($1::uuid[]) {user_filter}
        ORDER BY u.first_name
        """,
        *params,
    )
    result: dict[UUID, list[dict[str, Any]]] = {task_id: [] for task_id in task_ids}
    for row in rows:
        result[row["task_id"]].append(dict(row))
    return result


async def list_my_assignments(conn: asyncpg.Connection, user_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT
            {_ASSIGNMENT_FIELDS},
            {", ".join(f"t.{c} AS task_{c}" for c in _TASK_COLS_FOR_MINE)},
            t.created_at AS task_created_at, t.updated_at AS task_updated_at
        FROM task_assignments a
        JOIN users u ON u.id = a.user_id
        JOIN tasks t ON t.id = a.task_id
        LEFT JOIN team_members tm ON tm.team_id = t.team_id AND tm.user_id = a.user_id
        WHERE a.user_id = $1 AND t.deleted_at IS NULL
        ORDER BY t.deadline NULLS LAST, a.created_at DESC
        """,
        user_id,
    )
    result = []
    for row in rows:
        d = dict(row)
        task = {"id": d["task_id"]}
        for col in _TASK_COLS_FOR_MINE:
            task[col] = d.pop(f"task_{col}")
        task["created_at"] = d.pop("task_created_at")
        task["updated_at"] = d.pop("task_updated_at")
        result.append({"assignment": d, "task": task})
    return result


async def mark_viewed(conn: asyncpg.Connection, task_id: UUID, user_id: UUID) -> dict[str, Any] | None:
    await conn.execute(
        "UPDATE task_assignments SET status = 'viewed', viewed_at = now() "
        "WHERE task_id = $1 AND user_id = $2 AND status = 'assigned'",
        task_id,
        user_id,
    )
    return await get_assignment(conn, task_id, user_id)


async def start_assignment(conn: asyncpg.Connection, task_id: UUID, user_id: UUID) -> dict[str, Any] | None:
    result = await conn.execute(
        "UPDATE task_assignments SET status = 'in_progress' "
        "WHERE task_id = $1 AND user_id = $2 AND status IN ('assigned', 'viewed')",
        task_id,
        user_id,
    )
    if result.endswith("0"):
        return None
    return await get_assignment(conn, task_id, user_id)


async def submit_assignment(
    conn: asyncpg.Connection, task_id: UUID, user_id: UUID, **fields: Any
) -> dict[str, Any] | None:
    """Records the player's submission and clears any previous coach review,
    moving status back to 'submitted' — including on resubmission after
    'needs_revision'."""
    set_clauses = [f"{key} = ${i + 3}" for i, key in enumerate(fields.keys())]
    result = await conn.execute(
        f"""
        UPDATE task_assignments SET
            {", ".join(set_clauses)},
            status = 'submitted', submitted_at = now(),
            coach_comment = NULL, reviewed_by = NULL, reviewed_at = NULL
        WHERE task_id = $1 AND user_id = $2 AND status != 'cancelled'
        """,
        task_id,
        user_id,
        *fields.values(),
    )
    if result.endswith("0"):
        return None
    return await get_assignment(conn, task_id, user_id)


async def set_assignment_photo(conn: asyncpg.Connection, task_id: UUID, user_id: UUID, file_id: UUID) -> dict[str, Any] | None:
    await conn.execute(
        "UPDATE task_assignments SET photo_file_id = $3 WHERE task_id = $1 AND user_id = $2",
        task_id,
        user_id,
        file_id,
    )
    return await get_assignment(conn, task_id, user_id)


async def set_assignment_video(conn: asyncpg.Connection, task_id: UUID, user_id: UUID, file_id: UUID) -> dict[str, Any] | None:
    await conn.execute(
        "UPDATE task_assignments SET video_file_id = $3 WHERE task_id = $1 AND user_id = $2",
        task_id,
        user_id,
        file_id,
    )
    return await get_assignment(conn, task_id, user_id)


async def review_assignment(
    conn: asyncpg.Connection, task_id: UUID, user_id: UUID, reviewed_by: UUID, status: str, coach_comment: str | None
) -> dict[str, Any] | None:
    result = await conn.execute(
        """
        UPDATE task_assignments
        SET status = $3, coach_comment = $4, reviewed_by = $5, reviewed_at = now()
        WHERE task_id = $1 AND user_id = $2
        """,
        task_id,
        user_id,
        status,
        coach_comment,
        reviewed_by,
    )
    if result.endswith("0"):
        return None
    return await get_assignment(conn, task_id, user_id)


async def cancel_open_assignments(conn: asyncpg.Connection, task_id: UUID) -> None:
    await conn.execute(
        "UPDATE task_assignments SET status = 'cancelled' "
        "WHERE task_id = $1 AND status NOT IN ('accepted', 'cancelled')",
        task_id,
    )


async def list_calendar_task_deadlines(
    conn: asyncpg.Connection, user_id: UUID, date_from: date, date_to: date
) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT t.id, t.title, t.deadline, t.team_id, tm.name AS team_name, a.status
        FROM task_assignments a
        JOIN tasks t ON t.id = a.task_id
        JOIN teams tm ON tm.id = t.team_id
        WHERE t.deleted_at IS NULL
          AND a.user_id = $1
          AND t.deadline IS NOT NULL
          AND t.deadline::date BETWEEN $2 AND $3
        ORDER BY t.deadline
        """,
        user_id,
        date_from,
        date_to,
    )
    return [dict(row) for row in rows]


async def team_task_summary(conn: asyncpg.Connection, team_id: UUID) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (WHERE a.status = 'accepted') AS completed,
            COUNT(*) FILTER (WHERE a.status = 'overdue') AS overdue,
            COUNT(*) AS total,
            AVG(a.difficulty) AS avg_difficulty,
            AVG(a.wellbeing) AS avg_wellbeing
        FROM task_assignments a
        JOIN tasks t ON t.id = a.task_id
        WHERE t.team_id = $1 AND t.deleted_at IS NULL
        """,
        team_id,
    )
    return dict(row)


async def player_task_summary(conn: asyncpg.Connection, user_id: UUID) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (WHERE status = 'accepted') AS completed,
            COUNT(*) FILTER (WHERE status = 'overdue') AS overdue,
            COUNT(*) AS total
        FROM task_assignments
        WHERE user_id = $1
        """,
        user_id,
    )
    return dict(row)


async def player_coach_comments(conn: asyncpg.Connection, user_id: UUID, limit: int = 20) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT t.title AS context, a.coach_comment AS comment, a.reviewed_at AS commented_at
        FROM task_assignments a
        JOIN tasks t ON t.id = a.task_id
        WHERE a.user_id = $1 AND a.coach_comment IS NOT NULL
        ORDER BY a.reviewed_at DESC
        LIMIT $2
        """,
        user_id,
        limit,
    )
    return [dict(row) for row in rows]


async def sweep_overdue(conn: asyncpg.Connection) -> int:
    """Flips assignments whose task deadline has passed and are still in an
    open, non-submitted state to 'overdue'. Run periodically by the
    background job."""
    result = await conn.execute(
        """
        UPDATE task_assignments a
        SET status = 'overdue'
        FROM tasks t
        WHERE a.task_id = t.id
          AND t.deleted_at IS NULL
          AND t.deadline IS NOT NULL
          AND t.deadline < now()
          AND a.status IN ('assigned', 'viewed', 'in_progress')
        """
    )
    return int(result.split()[-1])
