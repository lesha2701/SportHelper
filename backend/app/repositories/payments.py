"""Data access for payments. Money-relevant transitions are single guarded UPDATEs, so a webhook and a manual refresh racing
each other can only ever apply a result once."""
from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

import asyncpg

_FIELDS = (
    "id, booking_id, payer_user_id, provider, provider_payment_id, status, amount, currency, confirmation_url, "
    "idempotence_key, cancellation_reason, created_at, updated_at, paid_at"
)


async def get_live_for_booking(conn: asyncpg.Connection, booking_id: UUID, *, lock: bool = False) -> dict[str, Any] | None:
    """The booking's pending or succeeded payment, if any (there is at most one)."""
    row = await conn.fetchrow(
        f"SELECT {_FIELDS} FROM payments WHERE booking_id = $1 AND status IN ('pending', 'succeeded') "
        f"{'FOR UPDATE' if lock else ''}",
        booking_id,
    )
    return dict(row) if row else None


async def get_by_provider_id(conn: asyncpg.Connection, provider_payment_id: str) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_FIELDS} FROM payments WHERE provider_payment_id = $1", provider_payment_id)
    return dict(row) if row else None


async def summary_for_booking(conn: asyncpg.Connection, booking_id: UUID) -> dict[str, Any] | None:
    """What the booking screens need: the live payment's status and paid time."""
    row = await conn.fetchrow(
        "SELECT status, paid_at, (provider_payment_id IS NOT NULL) AS has_provider FROM payments "
        "WHERE booking_id = $1 AND status IN ('pending', 'succeeded')",
        booking_id,
    )
    return dict(row) if row else None


async def insert_pending(
    conn: asyncpg.Connection, *, booking_id: UUID, payer_user_id: UUID, amount: Decimal, currency: str
) -> dict[str, Any]:
    row = await conn.fetchrow(
        f"INSERT INTO payments (booking_id, payer_user_id, amount, currency) VALUES ($1, $2, $3, $4) RETURNING {_FIELDS}",
        booking_id,
        payer_user_id,
        amount,
        currency,
    )
    return dict(row)


async def attach_provider_payment(
    conn: asyncpg.Connection, payment_id: UUID, *, provider_payment_id: str, confirmation_url: str | None
) -> None:
    await conn.execute(
        "UPDATE payments SET provider_payment_id = $2, confirmation_url = $3, updated_at = now() "
        "WHERE id = $1 AND status = 'pending'",
        payment_id,
        provider_payment_id,
        confirmation_url,
    )


async def mark_succeeded(conn: asyncpg.Connection, payment_id: UUID) -> bool:
    """True only for the call that actually flipped it (so "paid" side effects run once)."""
    updated = await conn.fetchval(
        "UPDATE payments SET status = 'succeeded', paid_at = now(), updated_at = now() "
        "WHERE id = $1 AND status = 'pending' RETURNING id",
        payment_id,
    )
    return updated is not None


async def mark_canceled(conn: asyncpg.Connection, payment_id: UUID, reason: str | None) -> bool:
    updated = await conn.fetchval(
        "UPDATE payments SET status = 'canceled', cancellation_reason = $2, updated_at = now() "
        "WHERE id = $1 AND status = 'pending' RETURNING id",
        payment_id,
        reason,
    )
    return updated is not None
