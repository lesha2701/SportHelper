"""Data access for trainer_earnings (one row per paid booking). The ledger holds the money; this table holds the story of each
accrual (which payment/booking, the frozen split, and where it is in the release process)."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

_FIELDS = (
    "e.id, e.payment_id, e.booking_id, e.coach_user_id, e.gross_kopecks, e.platform_fee_kopecks, e.trainer_kopecks, e.commission_percent, "
    "e.status, e.reversed_kopecks, e.held_reason, e.session_confirmed_at, e.released_by, e.released_at, e.release_note, e.created_at, e.updated_at"
)
_LISTING_JOIN = (
    "JOIN bookings b ON b.id = e.booking_id LEFT JOIN coach_listings cl ON cl.id = b.listing_id "
    "LEFT JOIN trainings t ON t.id = b.training_id JOIN users au ON au.id = b.athlete_user_id"
)
_LISTING_COLUMNS = (
    "cl.title AS listing_title, b.starts_at, t.status AS training_status, "
    "au.first_name || COALESCE(' ' || au.last_name, '') AS athlete_full_name"
)


async def create(conn: asyncpg.Connection, payment: dict[str, Any], *, session_confirmed: bool) -> tuple[dict[str, Any], bool]:
    row = await conn.fetchrow(
        f"""
        INSERT INTO trainer_earnings (payment_id, booking_id, coach_user_id, gross_kopecks, platform_fee_kopecks, trainer_kopecks,
                                      commission_percent, session_confirmed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8 THEN now() END)
        ON CONFLICT (payment_id) DO NOTHING
        RETURNING {_FIELDS.replace('e.', '')}
        """,
        payment["id"], payment["booking_id"], payment["coach_user_id"], payment["gross_kopecks"], payment["platform_fee_kopecks"],
        payment["trainer_kopecks"], payment["commission_percent"], session_confirmed,
    )
    if row is not None:
        return dict(row), True
    return dict(await conn.fetchrow(f"SELECT {_FIELDS} FROM trainer_earnings e WHERE e.payment_id = $1", payment["id"])), False


async def get(conn: asyncpg.Connection, earning_id: UUID, *, lock: bool = False) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_FIELDS} FROM trainer_earnings e WHERE e.id = $1 {'FOR UPDATE OF e' if lock else ''}", earning_id)
    return dict(row) if row else None


async def get_for_booking(conn: asyncpg.Connection, booking_id: UUID, *, lock: bool = False) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_FIELDS} FROM trainer_earnings e WHERE e.booking_id = $1 {'FOR UPDATE OF e' if lock else ''}", booking_id)
    return dict(row) if row else None


async def get_for_payment(conn: asyncpg.Connection, payment_id: UUID, *, lock: bool = False) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_FIELDS} FROM trainer_earnings e WHERE e.payment_id = $1 {'FOR UPDATE OF e' if lock else ''}", payment_id)
    return dict(row) if row else None


async def confirm_session(conn: asyncpg.Connection, booking_id: UUID) -> dict[str, Any] | None:
    """The trainer marked the session conducted: the earning (if the booking was paid) becomes eligible for release review."""
    row = await conn.fetchrow(
        f"UPDATE trainer_earnings e SET session_confirmed_at = COALESCE(session_confirmed_at, now()), updated_at = now() "
        f"WHERE e.booking_id = $1 RETURNING {_FIELDS.replace('e.', '')}",
        booking_id,
    )
    return dict(row) if row else None


async def release(conn: asyncpg.Connection, earning_id: UUID, *, by: UUID | None, note: str | None) -> bool:
    """pending -> available (only a session the trainer has marked conducted, and not a frozen one). True if THIS call released it."""
    updated = await conn.fetchval(
        "UPDATE trainer_earnings SET status = 'available', released_by = $2, released_at = now(), release_note = $3, updated_at = now() "
        "WHERE id = $1 AND status = 'pending' AND session_confirmed_at IS NOT NULL RETURNING id",
        earning_id, by, note,
    )
    return updated is not None


async def hold(conn: asyncpg.Connection, earning_id: UUID, reason: str) -> bool:
    updated = await conn.fetchval(
        "UPDATE trainer_earnings SET status = 'held', held_reason = $2, updated_at = now() WHERE id = $1 AND status = 'pending' RETURNING id", earning_id, reason
    )
    return updated is not None


async def unhold(conn: asyncpg.Connection, earning_id: UUID) -> bool:
    updated = await conn.fetchval(
        "UPDATE trainer_earnings SET status = 'pending', held_reason = NULL, updated_at = now() WHERE id = $1 AND status = 'held' RETURNING id", earning_id
    )
    return updated is not None


async def add_reversal(conn: asyncpg.Connection, earning_id: UUID, kopecks: int) -> dict[str, Any]:
    row = await conn.fetchrow(
        f"UPDATE trainer_earnings e SET reversed_kopecks = reversed_kopecks + $2, "
        f"status = CASE WHEN reversed_kopecks + $2 >= trainer_kopecks THEN 'reversed' ELSE status END, updated_at = now() "
        f"WHERE id = $1 RETURNING {_FIELDS.replace('e.', '')}",
        earning_id, kopecks,
    )
    return dict(row)


async def list_for_coach(conn: asyncpg.Connection, coach_user_id: UUID, *, limit: int, offset: int) -> tuple[int, list[dict[str, Any]]]:
    total = await conn.fetchval("SELECT count(*) FROM trainer_earnings WHERE coach_user_id = $1", coach_user_id)
    rows = await conn.fetch(
        f"SELECT {_FIELDS}, {_LISTING_COLUMNS} FROM trainer_earnings e {_LISTING_JOIN} WHERE e.coach_user_id = $1 ORDER BY e.created_at DESC, e.id LIMIT $2 OFFSET $3",
        coach_user_id, limit, offset,
    )
    return int(total), [dict(r) for r in rows]


async def list_for_admin(conn: asyncpg.Connection, *, status: str | None, coach_user_id: UUID | None, limit: int, offset: int) -> tuple[int, list[dict[str, Any]]]:
    where = "WHERE ($1::text IS NULL OR e.status = $1) AND ($2::uuid IS NULL OR e.coach_user_id = $2)"
    total = await conn.fetchval(f"SELECT count(*) FROM trainer_earnings e {where}", status, coach_user_id)
    rows = await conn.fetch(
        f"""
        SELECT {_FIELDS}, {_LISTING_COLUMNS}, cu.first_name || COALESCE(' ' || cu.last_name, '') AS coach_full_name, cu.email AS coach_email
          FROM trainer_earnings e {_LISTING_JOIN} JOIN users cu ON cu.id = e.coach_user_id
          {where} ORDER BY (e.status = 'pending' AND e.session_confirmed_at IS NOT NULL) DESC, e.created_at DESC, e.id LIMIT $3 OFFSET $4
        """,
        status, coach_user_id, limit, offset,
    )
    return int(total), [dict(r) for r in rows]


async def due_for_auto_release(conn: asyncpg.Connection, *, hold_hours: int, limit: int) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT {_FIELDS} FROM trainer_earnings e
         WHERE e.status = 'pending' AND e.session_confirmed_at IS NOT NULL
           AND e.session_confirmed_at <= now() - make_interval(hours => $1)
         ORDER BY e.session_confirmed_at LIMIT $2
        """,
        hold_hours, limit,
    )
    return [dict(r) for r in rows]
