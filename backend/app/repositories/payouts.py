"""Data access for automatic payouts: attempts, the automation switch, and the facts the rules need (database/patches/0048)."""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg

_ATTEMPT = "id, withdrawal_id, provider, idempotency_key, amount_kopecks, status, provider_payout_id, fee_kopecks, error, created_at, updated_at, finished_at"


def idempotency_key(withdrawal_id: UUID) -> str:
    return f"withdrawal:{withdrawal_id}"


async def create_attempt(conn: asyncpg.Connection, *, withdrawal_id: UUID, provider: str, amount_kopecks: int) -> dict[str, Any]:
    row = await conn.fetchrow(
        f"INSERT INTO payout_attempts (withdrawal_id, provider, idempotency_key, amount_kopecks) VALUES ($1, $2, $3, $4) RETURNING {_ATTEMPT}",
        withdrawal_id, provider, idempotency_key(withdrawal_id), amount_kopecks,
    )
    return dict(row)


async def get_attempt(conn: asyncpg.Connection, attempt_id: UUID, *, lock: bool = False) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_ATTEMPT} FROM payout_attempts WHERE id = $1 {'FOR UPDATE' if lock else ''}", attempt_id)
    return dict(row) if row else None


async def live_attempt(conn: asyncpg.Connection, withdrawal_id: UUID) -> dict[str, Any] | None:
    """The one attempt that is not a proven failure (there can be at most one: a unique index)."""
    row = await conn.fetchrow(f"SELECT {_ATTEMPT} FROM payout_attempts WHERE withdrawal_id = $1 AND status <> 'failed'", withdrawal_id)
    return dict(row) if row else None


async def set_attempt(
    conn: asyncpg.Connection, attempt_id: UUID, *, status: str, provider_payout_id: str | None = None, fee_kopecks: int = 0, error: str | None = None
) -> None:
    await conn.execute(
        """UPDATE payout_attempts SET status = $2, provider_payout_id = COALESCE($3, provider_payout_id), fee_kopecks = $4, error = $5, updated_at = now(),
                  finished_at = CASE WHEN $2 IN ('succeeded', 'failed') THEN now() ELSE finished_at END WHERE id = $1""",
        attempt_id, status, provider_payout_id, fee_kopecks, (error or "")[:500] or None,
    )


async def open_attempts(conn: asyncpg.Connection, *, limit: int) -> list[dict[str, Any]]:
    """Attempts whose outcome is not final yet, oldest first."""
    rows = await conn.fetch(f"SELECT {_ATTEMPT} FROM payout_attempts WHERE status IN ('created', 'sent', 'unknown') ORDER BY created_at LIMIT $1", limit)
    return [dict(r) for r in rows]


async def attempts_since(conn: asyncpg.Connection, since: datetime, until: datetime) -> list[dict[str, Any]]:
    rows = await conn.fetch(f"SELECT {_ATTEMPT} FROM payout_attempts WHERE created_at >= $1 AND created_at < $2", since, until)
    return [dict(r) for r in rows]


async def sent_total(conn: asyncpg.Connection, since: datetime, *, coach_user_id: UUID | None = None) -> int:
    """What the system has sent (or is sending) since the moment: counts everything that is not a proven failure."""
    return int(await conn.fetchval(
        """SELECT COALESCE(SUM(a.amount_kopecks), 0) FROM payout_attempts a JOIN withdrawal_requests w ON w.id = a.withdrawal_id
            WHERE a.status <> 'failed' AND a.created_at >= $1 AND ($2::uuid IS NULL OR w.coach_user_id = $2)""", since, coach_user_id))


# --- the automation switch ------------------------------------------------------------------------------------------------------


async def state(conn: asyncpg.Connection, *, lock: bool = False) -> dict[str, Any]:
    row = await conn.fetchrow(f"SELECT halted, halted_reason, halted_at, resumed_by, resumed_at, reconciled_at FROM payout_automation_state WHERE id = 1 {'FOR UPDATE' if lock else ''}")
    return dict(row)


async def halt(conn: asyncpg.Connection, reason: str) -> bool:
    """True when THIS call stopped it (a second reason while already stopped does not overwrite the first)."""
    updated = await conn.fetchval(
        "UPDATE payout_automation_state SET halted = true, halted_reason = $1, halted_at = now() WHERE id = 1 AND NOT halted RETURNING id", reason[:500])
    return updated is not None


async def resume(conn: asyncpg.Connection, admin_id: UUID) -> bool:
    updated = await conn.fetchval(
        "UPDATE payout_automation_state SET halted = false, resumed_by = $1, resumed_at = now() WHERE id = 1 AND halted RETURNING id", admin_id)
    return updated is not None


async def touch_reconciled(conn: asyncpg.Connection) -> None:
    await conn.execute("UPDATE payout_automation_state SET reconciled_at = now() WHERE id = 1")


# --- facts for the rules --------------------------------------------------------------------------------------------------------


async def due_requests(conn: asyncpg.Connection, *, older_than_minutes: int, limit: int) -> list[UUID]:
    rows = await conn.fetch(
        """SELECT id FROM withdrawal_requests WHERE status = 'requested' AND created_at <= now() - make_interval(mins => $1)
            ORDER BY created_at LIMIT $2""", older_than_minutes, limit)
    return [r["id"] for r in rows]


async def coach_paid_count(conn: asyncpg.Connection, coach_user_id: UUID) -> int:
    return int(await conn.fetchval("SELECT count(*) FROM withdrawal_requests WHERE coach_user_id = $1 AND status = 'paid'", coach_user_id))


async def details_paid_before(conn: asyncpg.Connection, coach_user_id: UUID, fingerprint: str) -> bool:
    return bool(await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM withdrawal_requests WHERE coach_user_id = $1 AND details_fingerprint = $2 AND status = 'paid')", coach_user_id, fingerprint))


async def details_first_seen(conn: asyncpg.Connection, coach_user_id: UUID, fingerprint: str) -> datetime | None:
    return await conn.fetchval("SELECT min(created_at) FROM withdrawal_requests WHERE coach_user_id = $1 AND details_fingerprint = $2", coach_user_id, fingerprint)


async def details_used_by_others(conn: asyncpg.Connection, coach_user_id: UUID, fingerprint: str) -> bool:
    return bool(await conn.fetchval(
        """SELECT EXISTS (SELECT 1 FROM withdrawal_requests WHERE coach_user_id <> $1 AND details_fingerprint = $2 AND status NOT IN ('rejected', 'canceled'))""",
        coach_user_id, fingerprint))


async def has_held_earnings(conn: asyncpg.Connection, coach_user_id: UUID) -> bool:
    return bool(await conn.fetchval("SELECT EXISTS (SELECT 1 FROM trainer_earnings WHERE coach_user_id = $1 AND status = 'held')", coach_user_id))


async def set_attention(conn: asyncpg.Connection, withdrawal_id: UUID, text: str | None) -> bool:
    """True when the text changed (so the same reasons are not recorded again and again on every tick)."""
    updated = await conn.fetchval(
        "UPDATE withdrawal_requests SET attention = $2 WHERE id = $1 AND attention IS DISTINCT FROM $2 RETURNING id", withdrawal_id, text)
    return updated is not None


async def mark_automated(conn: asyncpg.Connection, withdrawal_id: UUID) -> None:
    await conn.execute("UPDATE withdrawal_requests SET automated = true WHERE id = $1", withdrawal_id)
