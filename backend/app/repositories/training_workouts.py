"""Data access for the results of a guided personal workout (sets, repetitions, weights).
All queries are parameterized."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg


async def get_workout(conn: asyncpg.Connection, training_id: UUID, user_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        "SELECT training_id, data, started_at, finished_at, updated_at FROM training_workouts WHERE training_id = $1 AND user_id = $2",
        training_id,
        user_id,
    )
    if row is None:
        return None
    data = row["data"] if isinstance(row["data"], dict) else json.loads(row["data"])
    return {
        "training_id": row["training_id"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
        "updated_at": row["updated_at"],
        **data,
    }


async def upsert_workout(
    conn: asyncpg.Connection,
    training_id: UUID,
    user_id: UUID,
    *,
    data: dict[str, Any],
    started_at: datetime | None,
    finished_at: datetime | None,
) -> dict[str, Any]:
    await conn.execute(
        """
        INSERT INTO training_workouts (training_id, user_id, data, started_at, finished_at)
        VALUES ($1, $2, $3::jsonb, $4, $5)
        ON CONFLICT (training_id, user_id) DO UPDATE SET
            data = EXCLUDED.data,
            started_at = EXCLUDED.started_at,
            finished_at = EXCLUDED.finished_at,
            updated_at = now()
        """,
        training_id,
        user_id,
        json.dumps(data),
        started_at,
        finished_at,
    )
    saved = await get_workout(conn, training_id, user_id)
    assert saved is not None
    return saved
