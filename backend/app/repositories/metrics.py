"""Data access for the universal player metric system. All queries are
parameterized."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

_METRIC_FIELDS = (
    "id, user_id, recorded_by, name, unit, value, recorded_date, "
    "higher_is_better, source, comment, created_at, updated_at"
)


async def create_metric(conn: asyncpg.Connection, user_id: UUID, recorded_by: UUID, **fields: Any) -> dict[str, Any]:
    columns = ["user_id", "recorded_by", *fields.keys()]
    placeholders = [f"${i + 1}" for i in range(len(columns))]
    values = [user_id, recorded_by, *fields.values()]
    row = await conn.fetchrow(
        f"INSERT INTO player_metrics ({', '.join(columns)}) VALUES ({', '.join(placeholders)}) RETURNING {_METRIC_FIELDS}",
        *values,
    )
    return dict(row)


async def get_metric(conn: asyncpg.Connection, metric_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"SELECT {_METRIC_FIELDS} FROM player_metrics WHERE id = $1 AND deleted_at IS NULL", metric_id
    )
    return dict(row) if row else None


async def update_metric(conn: asyncpg.Connection, metric_id: UUID, **fields: Any) -> dict[str, Any] | None:
    set_clauses = [f"{key} = ${i + 2}" for i, key in enumerate(fields.keys())]
    row = await conn.fetchrow(
        f"""
        UPDATE player_metrics SET {", ".join(set_clauses)}
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING {_METRIC_FIELDS}
        """,
        metric_id,
        *fields.values(),
    )
    return dict(row) if row else None


async def soft_delete(conn: asyncpg.Connection, metric_id: UUID) -> bool:
    result = await conn.execute(
        "UPDATE player_metrics SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL", metric_id
    )
    return result.endswith("1")


async def list_for_user(conn: asyncpg.Connection, user_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT {_METRIC_FIELDS} FROM player_metrics
        WHERE user_id = $1 AND deleted_at IS NULL
        ORDER BY recorded_date DESC, created_at DESC
        """,
        user_id,
    )
    return [dict(row) for row in rows]
