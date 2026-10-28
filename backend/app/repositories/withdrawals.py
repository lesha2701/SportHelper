"""Data access for withdrawal requests and their immutable event history. Every status change is a guarded UPDATE
(`WHERE id = $1 AND status = <expected>`), so two administrators (or a double click) cannot both apply the same step."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

_FIELDS = (
    "w.id, w.coach_user_id, w.amount_kopecks, w.currency, w.status, w.method, w.details_hint, w.client_key, w.reviewed_by, w.approved_by, "
    "w.processing_by, w.paid_by, w.decided_reason, w.bank_reference, w.paid_amount_kopecks, w.paid_at, w.transfer_note, w.attention, "
    "w.created_at, w.updated_at"
)

# status -> the statuses it may move to (anything else is refused, whatever the caller sends)
TRANSITIONS: dict[str, tuple[str, ...]] = {
    "requested": ("under_review", "rejected", "canceled"),
    "under_review": ("approved", "rejected", "canceled"),
    "approved": ("processing", "rejected"),
    "processing": ("paid", "rejected"),
    "paid": (),
    "rejected": (),
    "canceled": (),
}
ACTIVE = ("requested", "under_review", "approved", "processing")


async def get(conn: asyncpg.Connection, withdrawal_id: UUID, *, lock: bool = False) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_FIELDS} FROM withdrawal_requests w WHERE w.id = $1 {'FOR UPDATE OF w' if lock else ''}", withdrawal_id)
    return dict(row) if row else None


async def get_by_client_key(conn: asyncpg.Connection, coach_user_id: UUID, client_key: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_FIELDS} FROM withdrawal_requests w WHERE w.coach_user_id = $1 AND w.client_key = $2", coach_user_id, client_key)
    return dict(row) if row else None


async def get_encrypted_details(conn: asyncpg.Connection, withdrawal_id: UUID) -> str | None:
    return await conn.fetchval("SELECT details_enc FROM withdrawal_requests WHERE id = $1", withdrawal_id)


async def insert(
    conn: asyncpg.Connection, *, coach_user_id: UUID, amount_kopecks: int, method: str, details_enc: str, details_hint: str, client_key: UUID
) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"""
        INSERT INTO withdrawal_requests (coach_user_id, amount_kopecks, method, details_enc, details_hint, client_key)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (coach_user_id, client_key) DO NOTHING
        RETURNING {_FIELDS.replace('w.', '')}
        """,
        coach_user_id, amount_kopecks, method, details_enc, details_hint, client_key,
    )
    return dict(row) if row else None


async def add_event(conn: asyncpg.Connection, withdrawal_id: UUID, *, from_status: str | None, to_status: str, actor: UUID | None, note: str | None) -> None:
    await conn.execute(
        "INSERT INTO withdrawal_events (withdrawal_id, from_status, to_status, actor_user_id, note) VALUES ($1, $2, $3, $4, $5)",
        withdrawal_id, from_status, to_status, actor, (note or "")[:500] or None,
    )


async def move(
    conn: asyncpg.Connection, withdrawal_id: UUID, *, from_status: str, to_status: str, actor_column: str | None = None, actor: UUID | None = None,
    reason: str | None = None, **extra: Any,
) -> bool:
    """Guarded transition. True when THIS call made it (False: someone else already did, or it was not in `from_status`)."""
    allowed_extra = {"bank_reference", "paid_amount_kopecks", "paid_at", "transfer_note", "attention"}
    if to_status not in TRANSITIONS[from_status] or set(extra) - allowed_extra or actor_column not in (None, "reviewed_by", "approved_by", "processing_by", "paid_by"):
        raise ValueError("transition not allowed")
    sets = ["status = $3", "updated_at = now()"]
    args: list[Any] = [withdrawal_id, from_status, to_status]
    if actor_column:
        args.append(actor)
        sets.append(f"{actor_column} = ${len(args)}")
    if reason is not None:
        args.append(reason)
        sets.append(f"decided_reason = ${len(args)}")
    for column, value in extra.items():
        args.append(value)
        sets.append(f"{column} = ${len(args)}")
    updated = await conn.fetchval(f"UPDATE withdrawal_requests SET {', '.join(sets)} WHERE id = $1 AND status = $2 RETURNING id", *args)
    return updated is not None


async def list_for_coach(conn: asyncpg.Connection, coach_user_id: UUID, *, limit: int, offset: int) -> tuple[int, list[dict[str, Any]]]:
    total = await conn.fetchval("SELECT count(*) FROM withdrawal_requests WHERE coach_user_id = $1", coach_user_id)
    rows = await conn.fetch(
        f"SELECT {_FIELDS} FROM withdrawal_requests w WHERE w.coach_user_id = $1 ORDER BY w.created_at DESC, w.id LIMIT $2 OFFSET $3", coach_user_id, limit, offset
    )
    return int(total), [dict(r) for r in rows]


async def list_for_admin(conn: asyncpg.Connection, *, status: str | None, limit: int, offset: int) -> tuple[int, list[dict[str, Any]]]:
    total = await conn.fetchval("SELECT count(*) FROM withdrawal_requests w WHERE ($1::text IS NULL OR w.status = $1)", status)
    rows = await conn.fetch(
        f"""
        SELECT {_FIELDS}, u.first_name || COALESCE(' ' || u.last_name, '') AS coach_full_name, u.email AS coach_email
          FROM withdrawal_requests w JOIN users u ON u.id = w.coach_user_id
         WHERE ($1::text IS NULL OR w.status = $1)
         ORDER BY (w.status IN ('requested', 'under_review', 'approved', 'processing')) DESC, w.created_at DESC, w.id LIMIT $2 OFFSET $3
        """,
        status, limit, offset,
    )
    return int(total), [dict(r) for r in rows]


async def events(conn: asyncpg.Connection, withdrawal_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        "SELECT e.id, e.from_status, e.to_status, e.actor_user_id, e.note, e.created_at, u.email AS actor_email "
        "FROM withdrawal_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.withdrawal_id = $1 ORDER BY e.id", withdrawal_id
    )
    return [dict(r) for r in rows]


async def paid_total_for_coach(conn: asyncpg.Connection, coach_user_id: UUID) -> int:
    return int(await conn.fetchval("SELECT COALESCE(SUM(amount_kopecks), 0) FROM withdrawal_requests WHERE coach_user_id = $1 AND status = 'paid'", coach_user_id))


async def active_count(conn: asyncpg.Connection) -> int:
    return int(await conn.fetchval("SELECT count(*) FROM withdrawal_requests WHERE status IN ('requested', 'under_review', 'approved', 'processing')"))
