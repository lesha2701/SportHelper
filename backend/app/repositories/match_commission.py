"""The platform's share of the FIRST session with a client the platform brought («Подобрать тренера»): the history of its changes
(database/patches/0058). The latest row is the current value; with no row the environment's value applies."""
from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

import asyncpg


async def latest(conn: asyncpg.Connection) -> Decimal | None:
    value = await conn.fetchval("SELECT percent FROM match_commission_changes ORDER BY id DESC LIMIT 1")
    return None if value is None else Decimal(value)


async def record_change(conn: asyncpg.Connection, *, percent: Decimal, previous: Decimal, reason: str, changed_by: UUID) -> dict[str, Any]:
    row = await conn.fetchrow(
        "INSERT INTO match_commission_changes (percent, previous, reason, changed_by) VALUES ($1, $2, $3, $4) "
        "RETURNING id, percent, previous, reason, changed_by, created_at",
        percent, previous, reason, changed_by,
    )
    return dict(row)


async def history(conn: asyncpg.Connection, limit: int = 20) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        "SELECT c.id, c.percent, c.previous, c.reason, c.changed_by, c.created_at, u.email AS changed_by_email "
        "FROM match_commission_changes c LEFT JOIN users u ON u.id = c.changed_by ORDER BY c.id DESC LIMIT $1",
        limit,
    )
    return [dict(r) for r in rows]
