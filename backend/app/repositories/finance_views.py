"""Read-only queries for the finance screens (the trainer's history and the administrators' lists/overview)."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

_OPERATION_AMOUNT = """
(CASE t.kind
    WHEN 'payment_received'    THEN COALESCE(SUM(e.amount_kopecks) FILTER (WHERE a.owner_user_id = $1 AND a.code = 'trainer_pending' AND e.direction = 'credit'), 0)
    WHEN 'earning_released'    THEN COALESCE(SUM(e.amount_kopecks) FILTER (WHERE a.owner_user_id = $1 AND a.code = 'trainer_available' AND e.direction = 'credit'), 0)
    WHEN 'withdrawal_reserved' THEN COALESCE(SUM(e.amount_kopecks) FILTER (WHERE a.owner_user_id = $1 AND a.code = 'trainer_reserved' AND e.direction = 'credit'), 0)
    WHEN 'withdrawal_released' THEN COALESCE(SUM(e.amount_kopecks) FILTER (WHERE a.owner_user_id = $1 AND a.code = 'trainer_available' AND e.direction = 'credit'), 0)
    WHEN 'withdrawal_paid'     THEN COALESCE(SUM(e.amount_kopecks) FILTER (WHERE a.owner_user_id = $1 AND a.code = 'trainer_reserved' AND e.direction = 'debit'), 0)
    WHEN 'refund'              THEN COALESCE(SUM(e.amount_kopecks) FILTER (WHERE a.owner_user_id = $1 AND e.direction = 'debit'), 0)
    ELSE COALESCE(SUM(e.amount_kopecks) FILTER (WHERE a.owner_user_id = $1 AND e.direction = 'credit'), 0)
END)::bigint
"""


async def trainer_operations(conn: asyncpg.Connection, coach_user_id: UUID, *, limit: int, offset: int) -> tuple[int, list[dict[str, Any]]]:
    """The trainer's money history: one row per posting that touched his accounts, newest first, with the lesson's price,
    the platform's commission and the status of the earning / withdrawal it belongs to."""
    total = await conn.fetchval(
        "SELECT count(DISTINCT e.transaction_id) FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE a.owner_user_id = $1", coach_user_id
    )
    rows = await conn.fetch(
        f"""
        WITH ops AS (
            SELECT t.id, t.kind, t.created_at, t.payment_id, t.booking_id, t.withdrawal_id, t.refund_id, t.reason,
                   {_OPERATION_AMOUNT} AS amount_kopecks
              FROM ledger_transactions t
              JOIN ledger_entries e ON e.transaction_id = t.id
              JOIN ledger_accounts a ON a.id = e.account_id
             GROUP BY t.id
            HAVING bool_or(a.owner_user_id = $1)
             ORDER BY t.created_at DESC, t.id LIMIT $2 OFFSET $3
        )
        SELECT ops.*, p.gross_kopecks, p.platform_fee_kopecks, p.trainer_kopecks, p.commission_percent,
               cl.title AS listing_title, b.starts_at,
               te.status AS earning_status, w.status AS withdrawal_status, w.details_hint AS withdrawal_hint, r.status AS refund_status
          FROM ops
          LEFT JOIN payments p ON p.id = ops.payment_id
          LEFT JOIN bookings b ON b.id = COALESCE(ops.booking_id, p.booking_id)
          LEFT JOIN coach_listings cl ON cl.id = b.listing_id
          LEFT JOIN trainer_earnings te ON te.payment_id = ops.payment_id
          LEFT JOIN withdrawal_requests w ON w.id = ops.withdrawal_id
          LEFT JOIN refunds r ON r.id = ops.refund_id
         ORDER BY ops.created_at DESC, ops.id
        """,
        coach_user_id, limit, offset,
    )
    return int(total), [dict(r) for r in rows]


async def admin_payments(conn: asyncpg.Connection, *, status: str | None, query: str | None, limit: int, offset: int) -> tuple[int, list[dict[str, Any]]]:
    where = """
        WHERE ($1::text IS NULL OR p.status = $1)
          AND ($2::text IS NULL OR cu.email ILIKE $2 ESCAPE '\\' OR pu.email ILIKE $2 ESCAPE '\\' OR p.id::text = $3 OR p.booking_id::text = $3)
    """
    pattern = None
    exact = None
    if query:
        exact = query.strip()
        pattern = "%" + exact.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    base = "FROM payments p JOIN users pu ON pu.id = p.payer_user_id JOIN users cu ON cu.id = p.coach_user_id"
    total = await conn.fetchval(f"SELECT count(*) {base} {where}", status, pattern, exact)
    rows = await conn.fetch(
        f"""
        SELECT p.id, p.booking_id, p.status, p.gross_kopecks, p.platform_fee_kopecks, p.trainer_kopecks, p.commission_percent,
               p.refund_reserved_kopecks, p.refunded_kopecks, p.created_at, p.paid_at,
               pu.email AS payer_email, cu.email AS coach_email,
               (SELECT count(*) FROM payment_attempts a WHERE a.payment_id = p.id) AS attempts,
               (SELECT count(*) FROM payment_incidents i WHERE i.payment_id = p.id AND i.status = 'open') AS open_incidents
          {base} {where} ORDER BY p.created_at DESC, p.id LIMIT $4 OFFSET $5
        """,
        status, pattern, exact, limit, offset,
    )
    return int(total), [dict(r) for r in rows]


async def payment_detail(conn: asyncpg.Connection, payment_id: UUID) -> dict[str, Any] | None:
    payment = await conn.fetchrow(
        """
        SELECT p.*, pu.email AS payer_email, cu.email AS coach_email, cl.title AS listing_title, b.starts_at, b.status AS booking_status,
               t.status AS training_status
          FROM payments p JOIN users pu ON pu.id = p.payer_user_id JOIN users cu ON cu.id = p.coach_user_id
          JOIN bookings b ON b.id = p.booking_id LEFT JOIN coach_listings cl ON cl.id = b.listing_id LEFT JOIN trainings t ON t.id = b.training_id
         WHERE p.id = $1
        """,
        payment_id,
    )
    if payment is None:
        return None
    attempts = await conn.fetch(
        "SELECT id, provider_payment_id, status, cancellation_reason, created_at, paid_at, last_checked_at, check_count FROM payment_attempts WHERE payment_id = $1 ORDER BY created_at", payment_id
    )
    refunds = await conn.fetch(
        "SELECT id, attempt_id, kind, amount_kopecks, commission_refund_kopecks, trainer_refund_kopecks, reason, status, provider_refund_id, failure_reason, created_at, completed_at "
        "FROM refunds WHERE payment_id = $1 ORDER BY created_at", payment_id
    )
    incidents = await conn.fetch("SELECT id, kind, detail, status, created_at, resolved_at, resolution FROM payment_incidents WHERE payment_id = $1 ORDER BY id", payment_id)
    earning = await conn.fetchrow("SELECT id, status, trainer_kopecks, reversed_kopecks, session_confirmed_at, released_at FROM trainer_earnings WHERE payment_id = $1", payment_id)
    postings = await conn.fetch("SELECT id, kind, business_key, created_at, reason FROM ledger_transactions WHERE payment_id = $1 ORDER BY created_at", payment_id)
    return {"payment": dict(payment), "attempts": [dict(r) for r in attempts], "refunds": [dict(r) for r in refunds],
            "incidents": [dict(r) for r in incidents], "earning": dict(earning) if earning else None, "postings": [dict(r) for r in postings]}


async def incidents(conn: asyncpg.Connection, *, status: str | None, limit: int, offset: int) -> tuple[int, list[dict[str, Any]]]:
    total = await conn.fetchval("SELECT count(*) FROM payment_incidents WHERE ($1::text IS NULL OR status = $1)", status)
    rows = await conn.fetch(
        "SELECT id, kind, payment_id, attempt_id, detail, status, created_at, resolved_at, resolution FROM payment_incidents "
        "WHERE ($1::text IS NULL OR status = $1) ORDER BY (status = 'open') DESC, id DESC LIMIT $2 OFFSET $3", status, limit, offset
    )
    return int(total), [dict(r) for r in rows]


async def overview(conn: asyncpg.Connection) -> dict[str, Any]:
    paid = await conn.fetchrow(
        """
        SELECT count(*) FILTER (WHERE paid_at IS NOT NULL) AS payments_count,
               COALESCE(SUM(gross_kopecks) FILTER (WHERE paid_at IS NOT NULL), 0)::bigint AS gross,
               COALESCE(SUM(platform_fee_kopecks) FILTER (WHERE paid_at IS NOT NULL), 0)::bigint AS commission_taken,
               COALESCE(SUM(trainer_kopecks) FILTER (WHERE paid_at IS NOT NULL), 0)::bigint AS trainer_total,
               COALESCE(SUM(refunded_kopecks), 0)::bigint AS refunded,
               count(*) FILTER (WHERE status = 'awaiting') AS awaiting
          FROM payments
        """
    )
    withdrawals = await conn.fetch("SELECT status, count(*) AS n, COALESCE(SUM(amount_kopecks), 0)::bigint AS amount FROM withdrawal_requests GROUP BY status")
    earnings = await conn.fetch(
        "SELECT status, count(*) AS n, COALESCE(SUM(trainer_kopecks - reversed_kopecks), 0)::bigint AS amount, "
        "count(*) FILTER (WHERE session_confirmed_at IS NOT NULL) AS confirmed FROM trainer_earnings GROUP BY status"
    )
    open_incidents = await conn.fetchval("SELECT count(*) FROM payment_incidents WHERE status = 'open'")
    return {"payments": dict(paid), "withdrawals": {r["status"]: {"count": r["n"], "amount_kopecks": int(r["amount"])} for r in withdrawals},
            "earnings": {r["status"]: {"count": r["n"], "amount_kopecks": int(r["amount"]), "session_confirmed": r["confirmed"]} for r in earnings},
            "open_incidents": int(open_incidents)}


async def trainer_summary(conn: asyncpg.Connection, coach_user_id: UUID) -> dict[str, Any] | None:
    user = await conn.fetchrow("SELECT id, email, first_name || COALESCE(' ' || last_name, '') AS full_name FROM users WHERE id = $1", coach_user_id)
    return dict(user) if user else None
