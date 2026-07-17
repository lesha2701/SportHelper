"""Data access for the coach's reusable task templates. All queries are
parameterized."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

_TEMPLATE_FIELDS = (
    "id, owner_id, title, description, plan_id, "
    "metric_name, metric_unit, metric_target, "
    "require_comment, require_photo, require_video, require_sets_reps, "
    "require_duration, require_metric_value, require_difficulty, require_wellbeing, "
    "created_at, updated_at"
)
_TEMPLATE_EXERCISE_FIELDS = "te.id, te.template_id, te.exercise_id, e.name AS exercise_name, te.order_index"


async def create_template(conn: asyncpg.Connection, owner_id: UUID, **fields: Any) -> dict[str, Any]:
    columns = ["owner_id", *fields.keys()]
    placeholders = [f"${i + 1}" for i in range(len(columns))]
    values = [owner_id, *fields.values()]
    row = await conn.fetchrow(
        f"INSERT INTO task_templates ({', '.join(columns)}) VALUES ({', '.join(placeholders)}) RETURNING {_TEMPLATE_FIELDS}",
        *values,
    )
    return dict(row)


async def get_template(conn: asyncpg.Connection, template_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"SELECT {_TEMPLATE_FIELDS} FROM task_templates WHERE id = $1 AND deleted_at IS NULL", template_id
    )
    return dict(row) if row else None


async def update_template(
    conn: asyncpg.Connection, template_id: UUID, owner_id: UUID, **fields: Any
) -> dict[str, Any] | None:
    set_clauses = [f"{key} = ${i + 3}" for i, key in enumerate(fields.keys())]
    row = await conn.fetchrow(
        f"""
        UPDATE task_templates SET {", ".join(set_clauses)}
        WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
        RETURNING {_TEMPLATE_FIELDS}
        """,
        template_id,
        owner_id,
        *fields.values(),
    )
    return dict(row) if row else None


async def list_owned(conn: asyncpg.Connection, owner_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"SELECT {_TEMPLATE_FIELDS} FROM task_templates WHERE owner_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC",
        owner_id,
    )
    return [dict(row) for row in rows]


async def soft_delete(conn: asyncpg.Connection, template_id: UUID, owner_id: UUID) -> bool:
    result = await conn.execute(
        "UPDATE task_templates SET deleted_at = now() WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL",
        template_id,
        owner_id,
    )
    return result.endswith("1")


async def set_template_exercises(conn: asyncpg.Connection, template_id: UUID, exercise_ids: list[UUID]) -> None:
    async with conn.transaction():
        await conn.execute("DELETE FROM task_template_exercises WHERE template_id = $1", template_id)
        for index, exercise_id in enumerate(exercise_ids):
            await conn.execute(
                "INSERT INTO task_template_exercises (template_id, exercise_id, order_index) VALUES ($1, $2, $3)",
                template_id,
                exercise_id,
                index,
            )


async def list_template_exercises(conn: asyncpg.Connection, template_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT {_TEMPLATE_EXERCISE_FIELDS}
        FROM task_template_exercises te
        LEFT JOIN exercises e ON e.id = te.exercise_id
        WHERE te.template_id = $1
        ORDER BY te.order_index
        """,
        template_id,
    )
    return [dict(row) for row in rows]
