"""Data access for the history of booking cancellations (one row per cancelled booking). All queries are parameterized."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

import asyncpg

_FIELDS = (
    "id, booking_id, cancelled_by, cancelled_by_role, reason, session_starts_at, hours_before_start, policy, "
    "paid_kopecks, refund_percent, refund_kopecks, refund_id, created_at"
)


async def insert(
    conn: asyncpg.Connection,
    *,
    booking_id: UUID,
    cancelled_by: UUID,
    cancelled_by_role: str,
    reason: str | None,
    session_starts_at: datetime,
    hours_before_start: Decimal,
    policy: str,
    paid_kopecks: int,
    refund_percent: int,
    refund_kopecks: int,
) -> dict[str, Any] | None:
    """Records the cancellation. Returns None when the booking was already cancelled (the booking is cancelled at most once)."""
    row = await conn.fetchrow(
        f"""
        INSERT INTO booking_cancellations (
            booking_id, cancelled_by, cancelled_by_role, reason, session_starts_at, hours_before_start,
            policy, paid_kopecks, refund_percent, refund_kopecks
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (booking_id) DO NOTHING
        RETURNING {_FIELDS}
        """,
        booking_id, cancelled_by, cancelled_by_role, reason, session_starts_at, hours_before_start,
        policy, paid_kopecks, refund_percent, refund_kopecks,
    )
    return dict(row) if row else None


async def get_for_booking(conn: asyncpg.Connection, booking_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_FIELDS} FROM booking_cancellations WHERE booking_id = $1", booking_id)
    return dict(row) if row else None


async def attach_refund(conn: asyncpg.Connection, booking_id: UUID, refund_id: UUID) -> bool:
    """Links the refund that carries the money back. True only for the first link (a cancellation has one refund)."""
    result = await conn.execute(
        "UPDATE booking_cancellations SET refund_id = $2 WHERE booking_id = $1 AND refund_id IS NULL AND refund_kopecks > 0",
        booking_id, refund_id,
    )
    return result.endswith("1")
