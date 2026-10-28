"""Data access for refunds."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

_FIELDS = (
    "id, payment_id, attempt_id, kind, amount_kopecks, commission_refund_kopecks, trainer_refund_kopecks, reason, status, provider_refund_id, "
    "idempotence_key, requested_by, failure_reason, created_at, updated_at, completed_at"
)


async def get(conn: asyncpg.Connection, refund_id: UUID, *, lock: bool = False) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_FIELDS} FROM refunds WHERE id = $1 {'FOR UPDATE' if lock else ''}", refund_id)
    return dict(row) if row else None


async def get_by_provider_id(conn: asyncpg.Connection, provider_refund_id: str) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_FIELDS} FROM refunds WHERE provider_refund_id = $1", provider_refund_id)
    return dict(row) if row else None


async def list_for_payment(conn: asyncpg.Connection, payment_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(f"SELECT {_FIELDS} FROM refunds WHERE payment_id = $1 ORDER BY created_at", payment_id)
    return [dict(r) for r in rows]


async def sums_for_payment(conn: asyncpg.Connection, payment_id: UUID) -> dict[str, int]:
    """What earlier (not failed) payment-refunds already took of the price and of the commission."""
    row = await conn.fetchrow(
        "SELECT COALESCE(SUM(amount_kopecks), 0) AS amount, COALESCE(SUM(commission_refund_kopecks), 0) AS commission "
        "FROM refunds WHERE payment_id = $1 AND kind = 'payment' AND status IN ('requested', 'pending', 'succeeded')",
        payment_id,
    )
    return {"amount": int(row["amount"]), "commission": int(row["commission"])}


async def insert(
    conn: asyncpg.Connection, *, payment_id: UUID, attempt_id: UUID, kind: str, amount: int, commission: int, trainer: int, reason: str, requested_by: UUID
) -> dict[str, Any]:
    row = await conn.fetchrow(
        f"INSERT INTO refunds (payment_id, attempt_id, kind, amount_kopecks, commission_refund_kopecks, trainer_refund_kopecks, reason, requested_by) "
        f"VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING {_FIELDS}",
        payment_id, attempt_id, kind, amount, commission, trainer, reason, requested_by,
    )
    return dict(row)


async def attach_provider(conn: asyncpg.Connection, refund_id: UUID, provider_refund_id: str) -> None:
    await conn.execute(
        "UPDATE refunds SET provider_refund_id = $2, status = 'pending', updated_at = now() WHERE id = $1 AND status IN ('requested', 'pending')",
        refund_id, provider_refund_id,
    )


async def mark_succeeded(conn: asyncpg.Connection, refund_id: UUID) -> bool:
    updated = await conn.fetchval(
        "UPDATE refunds SET status = 'succeeded', completed_at = now(), updated_at = now() WHERE id = $1 AND status IN ('requested', 'pending') RETURNING id", refund_id
    )
    return updated is not None


async def mark_failed(conn: asyncpg.Connection, refund_id: UUID, reason: str | None) -> bool:
    updated = await conn.fetchval(
        "UPDATE refunds SET status = 'failed', failure_reason = $2, updated_at = now() WHERE id = $1 AND status IN ('requested', 'pending') RETURNING id",
        refund_id, reason,
    )
    return updated is not None


async def list_unfinished(conn: asyncpg.Connection, *, limit: int) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"SELECT {_FIELDS} FROM refunds WHERE status IN ('requested', 'pending') AND created_at > now() - interval '7 days' "
        f"AND updated_at < now() - interval '2 minutes' ORDER BY updated_at LIMIT $1",
        limit,
    )
    return [dict(r) for r in rows]


async def list_for_admin(conn: asyncpg.Connection, *, limit: int, offset: int) -> tuple[int, list[dict[str, Any]]]:
    total = await conn.fetchval("SELECT count(*) FROM refunds")
    rows = await conn.fetch(f"SELECT {_FIELDS} FROM refunds ORDER BY created_at DESC LIMIT $1 OFFSET $2", limit, offset)
    return int(total), [dict(r) for r in rows]
