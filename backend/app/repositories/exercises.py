"""Data access for the coach's personal exercise library. All queries are
parameterized."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

_FIELDS = (
    "id, owner_id, sport, name, description, goal, photo_file_id, video_file_id, "
    "sets, reps, duration_seconds, rest_seconds, equipment, difficulty, technique, "
    "common_mistakes, warnings, coach_comment, created_at, updated_at"
)


async def create_exercise(conn: asyncpg.Connection, owner_id: UUID, **fields: Any) -> dict[str, Any]:
    columns = ["owner_id", *fields.keys()]
    placeholders = [f"${i + 1}" for i in range(len(columns))]
    values = [owner_id, *fields.values()]
    row = await conn.fetchrow(
        f"""
        INSERT INTO exercises ({", ".join(columns)})
        VALUES ({", ".join(placeholders)})
        RETURNING {_FIELDS}
        """,
        *values,
    )
    return dict(row)


async def update_exercise(
    conn: asyncpg.Connection, exercise_id: UUID, owner_id: UUID, **fields: Any
) -> dict[str, Any] | None:
    set_clauses = [f"{key} = ${i + 3}" for i, key in enumerate(fields.keys())]
    row = await conn.fetchrow(
        f"""
        UPDATE exercises SET {", ".join(set_clauses)}
        WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
        RETURNING {_FIELDS}
        """,
        exercise_id,
        owner_id,
        *fields.values(),
    )
    return dict(row) if row else None


async def get_exercise(conn: asyncpg.Connection, exercise_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"SELECT {_FIELDS} FROM exercises WHERE id = $1 AND deleted_at IS NULL", exercise_id
    )
    return dict(row) if row else None


async def list_owned(conn: asyncpg.Connection, owner_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"SELECT {_FIELDS} FROM exercises WHERE owner_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC",
        owner_id,
    )
    return [dict(row) for row in rows]


async def list_shared_with_team(conn: asyncpg.Connection, team_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT {", ".join(f"e.{f.strip()}" for f in _FIELDS.split(","))}
        FROM exercises e
        JOIN exercise_team_shares s ON s.exercise_id = e.id
        WHERE s.team_id = $1 AND e.deleted_at IS NULL
        ORDER BY s.shared_at DESC
        """,
        team_id,
    )
    return [dict(row) for row in rows]


async def soft_delete(conn: asyncpg.Connection, exercise_id: UUID, owner_id: UUID) -> bool:
    result = await conn.execute(
        "UPDATE exercises SET deleted_at = now() WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL",
        exercise_id,
        owner_id,
    )
    return result.endswith("1")


async def share_with_team(
    conn: asyncpg.Connection, exercise_id: UUID, team_id: UUID, shared_by: UUID
) -> None:
    await conn.execute(
        """
        INSERT INTO exercise_team_shares (exercise_id, team_id, shared_by)
        VALUES ($1, $2, $3)
        ON CONFLICT (exercise_id, team_id) DO NOTHING
        """,
        exercise_id,
        team_id,
        shared_by,
    )


async def unshare_from_team(conn: asyncpg.Connection, exercise_id: UUID, team_id: UUID) -> None:
    await conn.execute(
        "DELETE FROM exercise_team_shares WHERE exercise_id = $1 AND team_id = $2", exercise_id, team_id
    )


async def list_shared_team_ids(conn: asyncpg.Connection, exercise_id: UUID) -> list[UUID]:
    rows = await conn.fetch(
        "SELECT team_id FROM exercise_team_shares WHERE exercise_id = $1", exercise_id
    )
    return [row["team_id"] for row in rows]


async def list_shared_team_ids_batch(conn: asyncpg.Connection, exercise_ids: list[UUID]) -> dict[UUID, list[UUID]]:
    """Batched form of list_shared_team_ids — one query for a whole list of
    exercises instead of one query per exercise (used when rendering a list
    of exercises, to avoid an N+1)."""
    if not exercise_ids:
        return {}
    rows = await conn.fetch(
        "SELECT exercise_id, team_id FROM exercise_team_shares WHERE exercise_id = ANY($1::uuid[])",
        exercise_ids,
    )
    result: dict[UUID, list[UUID]] = {exercise_id: [] for exercise_id in exercise_ids}
    for row in rows:
        result[row["exercise_id"]].append(row["team_id"])
    return result


async def is_shared_with_team(conn: asyncpg.Connection, exercise_id: UUID, team_id: UUID) -> bool:
    value = await conn.fetchval(
        "SELECT 1 FROM exercise_team_shares WHERE exercise_id = $1 AND team_id = $2", exercise_id, team_id
    )
    return value is not None
