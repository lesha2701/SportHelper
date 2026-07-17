"""Data access for reusable training plans and their exercise lists. All
queries are parameterized."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

_PLAN_FIELDS = (
    "id, owner_id, sport, name, description, duration_minutes, equipment, "
    "comment, created_at, updated_at"
)
_PLAN_EXERCISE_FIELDS = (
    "pe.id, pe.plan_id, pe.exercise_id, e.name AS exercise_name, pe.section, "
    "pe.order_index, pe.sets, pe.reps, pe.duration_seconds, pe.rest_seconds, pe.notes"
)


async def create_plan(conn: asyncpg.Connection, owner_id: UUID, **fields: Any) -> dict[str, Any]:
    columns = ["owner_id", *fields.keys()]
    placeholders = [f"${i + 1}" for i in range(len(columns))]
    values = [owner_id, *fields.values()]
    row = await conn.fetchrow(
        f"INSERT INTO training_plans ({', '.join(columns)}) VALUES ({', '.join(placeholders)}) RETURNING {_PLAN_FIELDS}",
        *values,
    )
    return dict(row)


async def update_plan(conn: asyncpg.Connection, plan_id: UUID, owner_id: UUID, **fields: Any) -> dict[str, Any] | None:
    set_clauses = [f"{key} = ${i + 3}" for i, key in enumerate(fields.keys())]
    row = await conn.fetchrow(
        f"""
        UPDATE training_plans SET {", ".join(set_clauses)}
        WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
        RETURNING {_PLAN_FIELDS}
        """,
        plan_id,
        owner_id,
        *fields.values(),
    )
    return dict(row) if row else None


async def get_plan(conn: asyncpg.Connection, plan_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"SELECT {_PLAN_FIELDS} FROM training_plans WHERE id = $1 AND deleted_at IS NULL", plan_id
    )
    return dict(row) if row else None


async def list_owned(conn: asyncpg.Connection, owner_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"SELECT {_PLAN_FIELDS} FROM training_plans WHERE owner_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC",
        owner_id,
    )
    return [dict(row) for row in rows]


async def soft_delete(conn: asyncpg.Connection, plan_id: UUID, owner_id: UUID) -> bool:
    result = await conn.execute(
        "UPDATE training_plans SET deleted_at = now() WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL",
        plan_id,
        owner_id,
    )
    return result.endswith("1")


async def duplicate_plan(conn: asyncpg.Connection, plan_id: UUID, owner_id: UUID) -> dict[str, Any] | None:
    async with conn.transaction():
        original = await conn.fetchrow(
            "SELECT sport, name, description, duration_minutes, equipment, comment "
            "FROM training_plans WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL",
            plan_id,
            owner_id,
        )
        if original is None:
            return None
        new_plan = await conn.fetchrow(
            f"""
            INSERT INTO training_plans (owner_id, sport, name, description, duration_minutes, equipment, comment)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING {_PLAN_FIELDS}
            """,
            owner_id,
            original["sport"],
            f"{original['name']} (копия)",
            original["description"],
            original["duration_minutes"],
            original["equipment"],
            original["comment"],
        )
        await conn.execute(
            """
            INSERT INTO training_plan_exercises (plan_id, exercise_id, section, order_index, sets, reps, duration_seconds, rest_seconds, notes)
            SELECT $2, exercise_id, section, order_index, sets, reps, duration_seconds, rest_seconds, notes
            FROM training_plan_exercises WHERE plan_id = $1
            """,
            plan_id,
            new_plan["id"],
        )
    return dict(new_plan)


async def list_plan_exercises(conn: asyncpg.Connection, plan_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT {_PLAN_EXERCISE_FIELDS}
        FROM training_plan_exercises pe
        LEFT JOIN exercises e ON e.id = pe.exercise_id
        WHERE pe.plan_id = $1
        ORDER BY pe.section, pe.order_index
        """,
        plan_id,
    )
    return [dict(row) for row in rows]


async def add_plan_exercise(conn: asyncpg.Connection, plan_id: UUID, **fields: Any) -> dict[str, Any]:
    columns = ["plan_id", *fields.keys()]
    placeholders = [f"${i + 1}" for i in range(len(columns))]
    values = [plan_id, *fields.values()]
    row = await conn.fetchrow(
        f"INSERT INTO training_plan_exercises ({', '.join(columns)}) VALUES ({', '.join(placeholders)}) RETURNING id",
        *values,
    )
    plan_exercise = await conn.fetchrow(
        f"""
        SELECT {_PLAN_EXERCISE_FIELDS}
        FROM training_plan_exercises pe
        LEFT JOIN exercises e ON e.id = pe.exercise_id
        WHERE pe.id = $1
        """,
        row["id"],
    )
    return dict(plan_exercise)


async def update_plan_exercise(
    conn: asyncpg.Connection, plan_exercise_id: UUID, plan_id: UUID, **fields: Any
) -> dict[str, Any] | None:
    set_clauses = [f"{key} = ${i + 3}" for i, key in enumerate(fields.keys())]
    updated = await conn.fetchrow(
        f"""
        UPDATE training_plan_exercises SET {", ".join(set_clauses)}
        WHERE id = $1 AND plan_id = $2
        RETURNING id
        """,
        plan_exercise_id,
        plan_id,
        *fields.values(),
    )
    if updated is None:
        return None
    row = await conn.fetchrow(
        f"""
        SELECT {_PLAN_EXERCISE_FIELDS}
        FROM training_plan_exercises pe
        LEFT JOIN exercises e ON e.id = pe.exercise_id
        WHERE pe.id = $1
        """,
        updated["id"],
    )
    return dict(row)


async def remove_plan_exercise(conn: asyncpg.Connection, plan_exercise_id: UUID, plan_id: UUID) -> bool:
    result = await conn.execute(
        "DELETE FROM training_plan_exercises WHERE id = $1 AND plan_id = $2", plan_exercise_id, plan_id
    )
    return result.endswith("1")


async def share_with_team(conn: asyncpg.Connection, plan_id: UUID, team_id: UUID, shared_by: UUID) -> None:
    await conn.execute(
        """
        INSERT INTO training_plan_team_shares (plan_id, team_id, shared_by)
        VALUES ($1, $2, $3)
        ON CONFLICT (plan_id, team_id) DO NOTHING
        """,
        plan_id,
        team_id,
        shared_by,
    )


async def unshare_from_team(conn: asyncpg.Connection, plan_id: UUID, team_id: UUID) -> None:
    await conn.execute(
        "DELETE FROM training_plan_team_shares WHERE plan_id = $1 AND team_id = $2", plan_id, team_id
    )


async def list_shared_team_ids(conn: asyncpg.Connection, plan_id: UUID) -> list[UUID]:
    rows = await conn.fetch(
        "SELECT team_id FROM training_plan_team_shares WHERE plan_id = $1", plan_id
    )
    return [row["team_id"] for row in rows]


async def list_shared_team_ids_batch(conn: asyncpg.Connection, plan_ids: list[UUID]) -> dict[UUID, list[UUID]]:
    """Batched form of list_shared_team_ids — one query for a whole list of
    plans instead of one query per plan (used when rendering a list of
    plans, to avoid an N+1)."""
    if not plan_ids:
        return {}
    rows = await conn.fetch(
        "SELECT plan_id, team_id FROM training_plan_team_shares WHERE plan_id = ANY($1::uuid[])",
        plan_ids,
    )
    result: dict[UUID, list[UUID]] = {plan_id: [] for plan_id in plan_ids}
    for row in rows:
        result[row["plan_id"]].append(row["team_id"])
    return result


async def list_shared_with_team(conn: asyncpg.Connection, team_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT {", ".join(f"p.{f.strip()}" for f in _PLAN_FIELDS.split(","))}
        FROM training_plans p
        JOIN training_plan_team_shares s ON s.plan_id = p.id
        WHERE s.team_id = $1 AND p.deleted_at IS NULL
        ORDER BY s.shared_at DESC
        """,
        team_id,
    )
    return [dict(row) for row in rows]
