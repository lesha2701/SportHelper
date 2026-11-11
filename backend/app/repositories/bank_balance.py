"""The settlement account's balance as a finance administrator copied it from the bank (database/patches/0047). Append-only."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

_COLUMNS = (
    "s.id, s.balance_kopecks, s.trainers_kopecks, s.note, s.entered_by, s.created_at, u.email AS entered_by_email"
)


async def record(conn: asyncpg.Connection, *, balance_kopecks: int, trainers_kopecks: int, note: str | None, entered_by: UUID) -> dict[str, Any]:
    row = await conn.fetchrow(
        "INSERT INTO bank_balance_snapshots (balance_kopecks, trainers_kopecks, note, entered_by) VALUES ($1, $2, $3, $4) RETURNING id",
        balance_kopecks, trainers_kopecks, note, entered_by,
    )
    return await get(conn, row["id"])  # type: ignore[return-value]


async def get(conn: asyncpg.Connection, snapshot_id: int) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"SELECT {_COLUMNS} FROM bank_balance_snapshots s LEFT JOIN users u ON u.id = s.entered_by WHERE s.id = $1", snapshot_id
    )
    return dict(row) if row else None


async def history(conn: asyncpg.Connection, limit: int = 10) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"SELECT {_COLUMNS} FROM bank_balance_snapshots s LEFT JOIN users u ON u.id = s.entered_by ORDER BY s.id DESC LIMIT $1", limit
    )
    return [dict(r) for r in rows]
