"""The ledger: immutable double-entry postings. Only this module writes to ledger_* tables.

* One business event has one `business_key`; posting it again is a no-op (returns None), so a replayed webhook, a double click or a
  retried job can never move money twice. The unique index in PostgreSQL has the final word.
* Every posting balances (checked by a deferred trigger at commit) and cannot be edited or deleted afterwards (triggers).
* Account balances are kept by a trigger on insert; `CHECK (balance >= 0)` plus the row lock it takes make an overdraft impossible
  even when requests race.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

import asyncpg

# code -> (type, normal side, may go negative)
ACCOUNT_SPECS: dict[str, tuple[str, str, bool]] = {
    "provider_receivable": ("asset", "debit", False),
    "platform_revenue": ("revenue", "credit", False),
    "payouts_external": ("external", "credit", False),
    "trainer_pending": ("liability", "credit", False),
    "trainer_available": ("liability", "credit", False),
    "trainer_reserved": ("liability", "credit", False),
    "trainer_debt": ("asset", "debit", False),
}
TRAINER_CODES = ("trainer_pending", "trainer_available", "trainer_reserved", "trainer_debt")

Direction = Literal["debit", "credit"]


@dataclass(frozen=True)
class Leg:
    account: str
    direction: Direction
    amount: int
    owner: UUID | None = None


class LedgerError(Exception):
    pass


async def _account_id(conn: asyncpg.Connection, code: str, owner: UUID | None) -> UUID:
    spec = ACCOUNT_SPECS.get(code)
    if spec is None:
        raise LedgerError(f"unknown ledger account {code!r}")
    kind, side, allow_negative = spec
    if owner is None:
        row = await conn.fetchval("SELECT id FROM ledger_accounts WHERE code = $1 AND owner_user_id IS NULL", code)
    else:
        await conn.execute(
            "INSERT INTO ledger_accounts (code, owner_user_id, type, normal_side, allow_negative) VALUES ($1, $2, $3, $4, $5) "
            "ON CONFLICT (code, owner_user_id) WHERE owner_user_id IS NOT NULL DO NOTHING",
            code, owner, kind, side, allow_negative,
        )
        row = await conn.fetchval("SELECT id FROM ledger_accounts WHERE code = $1 AND owner_user_id = $2", code, owner)
    if row is None:
        raise LedgerError(f"ledger account {code!r} does not exist")
    return row


async def post(
    conn: asyncpg.Connection,
    *,
    kind: str,
    business_key: str,
    legs: list[Leg],
    description: str | None = None,
    payment_id: UUID | None = None,
    booking_id: UUID | None = None,
    earning_id: UUID | None = None,
    withdrawal_id: UUID | None = None,
    refund_id: UUID | None = None,
    created_by: UUID | None = None,
    reason: str | None = None,
) -> UUID | None:
    """Posts one balanced transaction. Returns its id, or None when this business event was already posted."""
    if len(legs) < 2 or any(leg.amount <= 0 for leg in legs):
        raise LedgerError("a posting needs at least two legs with positive amounts")
    if sum(l.amount for l in legs if l.direction == "debit") != sum(l.amount for l in legs if l.direction == "credit"):
        raise LedgerError("a posting must balance")
    async with conn.transaction():
        tx_id = await conn.fetchval(
            """
            INSERT INTO ledger_transactions (kind, business_key, description, payment_id, booking_id, earning_id, withdrawal_id, refund_id, created_by, reason)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (business_key) DO NOTHING RETURNING id
            """,
            kind, business_key, description, payment_id, booking_id, earning_id, withdrawal_id, refund_id, created_by, reason,
        )
        if tx_id is None:
            return None
        resolved = [(await _account_id(conn, leg.account, leg.owner), leg) for leg in legs]
        # A fixed order of locking (by account id) keeps two postings from deadlocking each other.
        for account_id, leg in sorted(resolved, key=lambda item: str(item[0])):
            await conn.execute(
                "INSERT INTO ledger_entries (transaction_id, account_id, direction, amount_kopecks) VALUES ($1, $2, $3, $4)",
                tx_id, account_id, leg.direction, leg.amount,
            )
        return tx_id


async def balance(conn: asyncpg.Connection, code: str, owner: UUID | None = None) -> int:
    value = await conn.fetchval(
        "SELECT balance_kopecks FROM ledger_accounts WHERE code = $1 AND owner_user_id IS NOT DISTINCT FROM $2", code, owner
    )
    return int(value or 0)


async def trainer_balances(conn: asyncpg.Connection, coach_user_id: UUID, *, lock: bool = False) -> dict[str, int]:
    rows = await conn.fetch(
        f"SELECT code, balance_kopecks FROM ledger_accounts WHERE owner_user_id = $1 {'FOR UPDATE' if lock else ''}", coach_user_id
    )
    result = {code: 0 for code in TRAINER_CODES}
    result.update({r["code"]: int(r["balance_kopecks"]) for r in rows})
    return result


async def lock_trainer_available(conn: asyncpg.Connection, coach_user_id: UUID) -> int:
    """Creates the account if needed and takes its row lock; returns the available balance. Serialises everything that spends it."""
    account_id = await _account_id(conn, "trainer_available", coach_user_id)
    return int(await conn.fetchval("SELECT balance_kopecks FROM ledger_accounts WHERE id = $1 FOR UPDATE", account_id))


async def recompute_mismatches(conn: asyncpg.Connection) -> list[dict[str, Any]]:
    """Accounts whose stored balance differs from the sum of their entries (must always be empty)."""
    rows = await conn.fetch(
        """
        SELECT a.id, a.code, a.owner_user_id, a.balance_kopecks AS stored,
               COALESCE(SUM(CASE WHEN e.direction = a.normal_side THEN e.amount_kopecks ELSE -e.amount_kopecks END), 0) AS computed
          FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
         GROUP BY a.id
        HAVING a.balance_kopecks <> COALESCE(SUM(CASE WHEN e.direction = a.normal_side THEN e.amount_kopecks ELSE -e.amount_kopecks END), 0)
        """
    )
    return [dict(r) for r in rows]


async def platform_totals(conn: asyncpg.Connection) -> dict[str, int]:
    """Platform-wide sums for the admin overview (what is owed to trainers by stage, the commission, what was paid out)."""
    rows = await conn.fetch(
        "SELECT code, COALESCE(SUM(balance_kopecks), 0) AS total FROM ledger_accounts GROUP BY code"
    )
    totals = {code: 0 for code in ACCOUNT_SPECS}
    totals.update({r["code"]: int(r["total"]) for r in rows})
    return totals
