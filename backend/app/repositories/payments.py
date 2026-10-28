"""Data access for payments, payment attempts, provider events and incidents.

Every money-relevant transition is a single guarded UPDATE (`WHERE status IN (...)`), so a webhook, a reconciliation tick and the
customer's own refresh racing each other can apply a result only once."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

_PAYMENT_FIELDS = (
    "id, booking_id, payer_user_id, coach_user_id, currency, gross_kopecks, commission_percent, platform_fee_kopecks, "
    "trainer_kopecks, status, paid_at, refund_reserved_kopecks, refunded_kopecks, created_at, updated_at"
)
_ATTEMPT_FIELDS = (
    "id, payment_id, provider_payment_id, status, idempotence_key, confirmation_url, cancellation_reason, created_at, "
    "updated_at, paid_at, last_checked_at, check_count"
)
OPEN_ATTEMPT = ("created", "pending")


# --- payments ---------------------------------------------------------------------------------------------------------------


async def get_payment(conn: asyncpg.Connection, payment_id: UUID, *, lock: bool = False) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_PAYMENT_FIELDS} FROM payments WHERE id = $1 {'FOR UPDATE' if lock else ''}", payment_id)
    return dict(row) if row else None


async def get_for_booking(conn: asyncpg.Connection, booking_id: UUID, *, lock: bool = False) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_PAYMENT_FIELDS} FROM payments WHERE booking_id = $1 {'FOR UPDATE' if lock else ''}", booking_id)
    return dict(row) if row else None


async def create_payment(
    conn: asyncpg.Connection, *, booking_id: UUID, payer_user_id: UUID, coach_user_id: UUID, currency: str,
    gross_kopecks: int, commission_percent: Any, platform_fee_kopecks: int, trainer_kopecks: int,
) -> tuple[dict[str, Any], bool]:
    """(payment, created). The amounts are frozen here; a booking has exactly one payment obligation."""
    row = await conn.fetchrow(
        f"""
        INSERT INTO payments (booking_id, payer_user_id, coach_user_id, currency, gross_kopecks, commission_percent, platform_fee_kopecks, trainer_kopecks)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (booking_id) DO NOTHING RETURNING {_PAYMENT_FIELDS}
        """,
        booking_id, payer_user_id, coach_user_id, currency, gross_kopecks, commission_percent, platform_fee_kopecks, trainer_kopecks,
    )
    if row is not None:
        return dict(row), True
    existing = await get_for_booking(conn, booking_id)
    assert existing is not None
    return existing, False


async def mark_payment_paid(conn: asyncpg.Connection, payment_id: UUID) -> bool:
    updated = await conn.fetchval(
        "UPDATE payments SET status = 'paid', paid_at = now(), updated_at = now() WHERE id = $1 AND status = 'awaiting' RETURNING id", payment_id
    )
    return updated is not None


# --- attempts ---------------------------------------------------------------------------------------------------------------


async def get_open_attempt(conn: asyncpg.Connection, payment_id: UUID, *, lock: bool = False) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"SELECT {_ATTEMPT_FIELDS} FROM payment_attempts WHERE payment_id = $1 AND status IN ('created', 'pending') {'FOR UPDATE' if lock else ''}", payment_id
    )
    return dict(row) if row else None


async def insert_attempt(conn: asyncpg.Connection, payment_id: UUID) -> dict[str, Any]:
    row = await conn.fetchrow(f"INSERT INTO payment_attempts (payment_id) VALUES ($1) RETURNING {_ATTEMPT_FIELDS}", payment_id)
    return dict(row)


async def get_attempt(conn: asyncpg.Connection, attempt_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_ATTEMPT_FIELDS} FROM payment_attempts WHERE id = $1", attempt_id)
    return dict(row) if row else None


async def get_attempt_by_provider_id(conn: asyncpg.Connection, provider_payment_id: str) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_ATTEMPT_FIELDS} FROM payment_attempts WHERE provider_payment_id = $1", provider_payment_id)
    return dict(row) if row else None


async def succeeded_attempt(conn: asyncpg.Connection, payment_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_ATTEMPT_FIELDS} FROM payment_attempts WHERE payment_id = $1 AND status = 'succeeded'", payment_id)
    return dict(row) if row else None


async def attach_provider_payment(conn: asyncpg.Connection, attempt_id: UUID, *, provider_payment_id: str, confirmation_url: str | None) -> None:
    await conn.execute(
        "UPDATE payment_attempts SET provider_payment_id = $2, confirmation_url = $3, status = 'pending', updated_at = now() "
        "WHERE id = $1 AND status IN ('created', 'pending')",
        attempt_id, provider_payment_id, confirmation_url,
    )


async def mark_attempt_canceled(conn: asyncpg.Connection, attempt_id: UUID, reason: str | None, *, status: str = "canceled") -> bool:
    updated = await conn.fetchval(
        "UPDATE payment_attempts SET status = $3, cancellation_reason = $2, updated_at = now() WHERE id = $1 AND status IN ('created', 'pending') RETURNING id",
        attempt_id, reason, status,
    )
    return updated is not None


async def mark_attempt_succeeded(conn: asyncpg.Connection, attempt_id: UUID) -> str:
    """'succeeded' when this call made it so, 'already' when it was already counted, 'duplicate' when ANOTHER attempt of the same
    payment had already succeeded (a second real charge: it is recorded as such, never as a second success)."""
    current = await conn.fetchval("SELECT status FROM payment_attempts WHERE id = $1 FOR UPDATE", attempt_id)
    if current == "succeeded":
        return "already"
    if current == "duplicate_paid":
        return "already"
    if current not in ("created", "pending", "expired"):
        return "ignored"
    try:
        async with conn.transaction():
            await conn.execute(
                "UPDATE payment_attempts SET status = 'succeeded', paid_at = now(), updated_at = now() WHERE id = $1", attempt_id
            )
        return "succeeded"
    except asyncpg.UniqueViolationError:
        await conn.execute("UPDATE payment_attempts SET status = 'duplicate_paid', paid_at = now(), updated_at = now() WHERE id = $1", attempt_id)
        return "duplicate"


async def touch_checked(conn: asyncpg.Connection, attempt_id: UUID) -> None:
    await conn.execute("UPDATE payment_attempts SET last_checked_at = now(), check_count = check_count + 1 WHERE id = $1", attempt_id)


async def attempts_to_reconcile(conn: asyncpg.Connection, *, max_age_hours: int, limit: int) -> list[dict[str, Any]]:
    """Unfinished attempts that are old enough for the webhook to be late and recent enough to be worth asking about, least recently
    asked first, with an exponential pause (1, 2, 4 ... up to 60 minutes) between asks of the same attempt. A bounded batch."""
    rows = await conn.fetch(
        f"""
        SELECT {_ATTEMPT_FIELDS} FROM payment_attempts
         WHERE status IN ('created', 'pending')
           AND created_at < now() - interval '2 minutes'
           AND created_at > now() - make_interval(hours => $1)
           AND (last_checked_at IS NULL
                OR last_checked_at < now() - LEAST(make_interval(mins => power(2, LEAST(check_count, 6))::int), interval '60 minutes'))
         ORDER BY last_checked_at NULLS FIRST, created_at LIMIT $2
        """,
        max_age_hours, limit,
    )
    return [dict(r) for r in rows]


async def expire_old_attempts(conn: asyncpg.Connection, *, max_age_hours: int) -> int:
    result = await conn.execute(
        "UPDATE payment_attempts SET status = 'expired', updated_at = now() "
        "WHERE status IN ('created', 'pending') AND created_at <= now() - make_interval(hours => $1)",
        max_age_hours,
    )
    return int(result.split()[-1])


# --- what the screens need -----------------------------------------------------------------------------------------------


async def summary_for_booking(conn: asyncpg.Connection, booking_id: UUID) -> dict[str, Any] | None:
    """The payment's state for a booking: payment status, the open/last attempt, and whether a refund is under way."""
    row = await conn.fetchrow(
        """
        SELECT p.status, p.paid_at, p.refund_reserved_kopecks, p.refunded_kopecks,
               (SELECT a.status FROM payment_attempts a WHERE a.payment_id = p.id ORDER BY a.created_at DESC LIMIT 1) AS last_attempt_status,
               EXISTS (SELECT 1 FROM payment_attempts a WHERE a.payment_id = p.id AND a.status IN ('created', 'pending') AND a.provider_payment_id IS NOT NULL) AS has_open_page
          FROM payments p WHERE p.booking_id = $1
        """,
        booking_id,
    )
    return dict(row) if row else None


# --- diagnostics -----------------------------------------------------------------------------------------------------------


async def record_event(conn: asyncpg.Connection, *, source: str, event: str, provider_object_id: str | None, outcome: str, detail: str | None = None) -> None:
    await conn.execute(
        "INSERT INTO payment_events (source, event, provider_object_id, outcome, detail) VALUES ($1, $2, $3, $4, $5)",
        source, event, provider_object_id, outcome, (detail or "")[:500] or None,
    )


async def record_incident(conn: asyncpg.Connection, *, kind: str, payment_id: UUID | None, attempt_id: UUID | None, detail: str) -> bool:
    """True when a NEW incident was opened (the same open problem is not recorded twice)."""
    created = await conn.fetchval(
        "INSERT INTO payment_incidents (kind, payment_id, attempt_id, detail) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id",
        kind, payment_id, attempt_id, detail[:1000],
    )
    return created is not None
