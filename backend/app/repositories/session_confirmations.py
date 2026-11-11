"""Data access for confirming that a booked session took place (one row per booking, migration 0044). All queries are parameterized.

No row means nothing has been recorded yet: before the session's end it is scheduled, after it the window is open. Every change moves the
state forward only from where it must be (the WHERE of each UPDATE), so racing requests and repeated background passes change nothing twice."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

_FIELDS = (
    "booking_id, state, coach_marked_at, confirmed_at, confirmed_by, confirmed_method, disputed_at, disputed_by, disputed_by_role, "
    "dispute_kind, dispute_text, resolved_at, resolved_by, resolution_note, created_at, updated_at"
)
CLOSED = ("confirmed", "auto_confirmed", "resolved_released", "resolved_refunded")


async def get(conn: asyncpg.Connection, booking_id: UUID, *, lock: bool = False) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_FIELDS} FROM session_confirmations WHERE booking_id = $1{' FOR UPDATE' if lock else ''}", booking_id)
    return dict(row) if row else None


async def ensure(conn: asyncpg.Connection, booking_id: UUID) -> None:
    """Makes the row exist (state 'awaiting'), so that it can be locked and moved."""
    await conn.execute("INSERT INTO session_confirmations (booking_id) VALUES ($1) ON CONFLICT (booking_id) DO NOTHING", booking_id)


async def mark_by_coach(conn: asyncpg.Connection, booking_id: UUID) -> None:
    """The coach's «Тренировка проведена»: only a mark (the first one is kept)."""
    await ensure(conn, booking_id)
    await conn.execute(
        "UPDATE session_confirmations SET coach_marked_at = COALESCE(coach_marked_at, now()), updated_at = now() WHERE booking_id = $1", booking_id
    )


async def confirm(conn: asyncpg.Connection, booking_id: UUID, *, by: UUID | None, method: str) -> dict[str, Any] | None:
    """awaiting → confirmed (athlete, code) or auto_confirmed (auto, by=None). None when the window was not open (already closed or disputed)."""
    await ensure(conn, booking_id)
    row = await conn.fetchrow(
        f"""
        UPDATE session_confirmations
           SET state = CASE WHEN $3 = 'auto' THEN 'auto_confirmed' ELSE 'confirmed' END,
               confirmed_at = now(), confirmed_by = $2, confirmed_method = $3, updated_at = now()
         WHERE booking_id = $1 AND state = 'awaiting'
        RETURNING {_FIELDS}
        """,
        booking_id, by, method,
    )
    return dict(row) if row else None


async def dispute(conn: asyncpg.Connection, booking_id: UUID, *, by: UUID, role: str, kind: str, text: str | None) -> dict[str, Any] | None:
    """awaiting → disputed. None when the window was not open."""
    await ensure(conn, booking_id)
    row = await conn.fetchrow(
        f"""
        UPDATE session_confirmations
           SET state = 'disputed', disputed_at = now(), disputed_by = $2, disputed_by_role = $3, dispute_kind = $4, dispute_text = $5, updated_at = now()
         WHERE booking_id = $1 AND state = 'awaiting'
        RETURNING {_FIELDS}
        """,
        booking_id, by, role, kind, text,
    )
    return dict(row) if row else None


async def resolve(conn: asyncpg.Connection, booking_id: UUID, *, by: UUID, outcome: str, note: str | None) -> dict[str, Any] | None:
    """disputed → resolved_released | resolved_refunded (the administrator's decision). None when it was not disputed."""
    row = await conn.fetchrow(
        f"""
        UPDATE session_confirmations
           SET state = $3, resolved_at = now(), resolved_by = $2, resolution_note = $4, updated_at = now()
         WHERE booking_id = $1 AND state = 'disputed'
        RETURNING {_FIELDS}
        """,
        booking_id, by, outcome, note,
    )
    return dict(row) if row else None


async def due_for_auto_confirmation(conn: asyncpg.Connection, *, window_hours: int, limit: int) -> list[UUID]:
    """Confirmed bookings whose session ended at least window_hours ago, was not cancelled, and whose window is still open."""
    rows = await conn.fetch(
        """
        SELECT b.id FROM bookings b
          JOIN trainings t ON t.id = b.training_id
          LEFT JOIN session_confirmations c ON c.booking_id = b.id
         WHERE b.status = 'confirmed' AND t.status <> 'cancelled' AND t.deleted_at IS NULL
           AND b.starts_at + make_interval(mins => b.duration_minutes) + make_interval(hours => $1) <= now()
           AND (c.booking_id IS NULL OR c.state = 'awaiting')
         ORDER BY b.starts_at
         LIMIT $2
        """,
        window_hours, limit,
    )
    return [r["id"] for r in rows]


async def due_for_reminder(conn: asyncpg.Connection, *, hours_after_end: int, until_hours: int, limit: int) -> list[UUID]:
    """Open windows of sessions that ended between hours_after_end and until_hours ago (a later step takes over after that, so a late
    pass never sends two reminders at once), whose athlete has not been reminded at this step yet (the reminder's dedup key is session_confirm_<step>:<booking>:<athlete>)."""
    rows = await conn.fetch(
        """
        SELECT b.id FROM bookings b
          JOIN trainings t ON t.id = b.training_id
          LEFT JOIN session_confirmations c ON c.booking_id = b.id
         WHERE b.status = 'confirmed' AND t.status <> 'cancelled' AND t.deleted_at IS NULL
           AND (c.booking_id IS NULL OR c.state = 'awaiting')
           AND b.starts_at + make_interval(mins => b.duration_minutes) + make_interval(hours => $1) <= now()
           AND b.starts_at + make_interval(mins => b.duration_minutes) + make_interval(hours => $2) > now()
           AND NOT EXISTS (SELECT 1 FROM notifications n
                            WHERE n.dedup_key = 'session_confirm_' || $1 || ':' || b.id || ':' || b.athlete_user_id)
         ORDER BY b.starts_at
         LIMIT $3
        """,
        hours_after_end, until_hours, limit,
    )
    return [r["id"] for r in rows]


async def list_disputes(conn: asyncpg.Connection, *, open_only: bool, limit: int, offset: int) -> tuple[int, list[dict[str, Any]]]:
    """Disputes for the finance administrator: open ones first, with what is needed to decide (who, what, the money)."""
    where = "WHERE c.disputed_at IS NOT NULL" + (" AND c.state = 'disputed'" if open_only else "")
    total = await conn.fetchval(f"SELECT count(*) FROM session_confirmations c {where}")
    rows = await conn.fetch(
        f"""
        SELECT c.booking_id, c.state, c.coach_marked_at, c.disputed_at, c.disputed_by_role, c.dispute_kind, c.dispute_text,
               c.resolved_at, c.resolution_note,
               b.starts_at, b.duration_minutes, b.format, cl.title AS listing_title,
               cp.full_name AS coach_full_name, au.first_name || COALESCE(' ' || au.last_name, '') AS athlete_full_name,
               p.id AS payment_id, p.gross_kopecks, p.status AS payment_status, e.status AS earning_status, e.trainer_kopecks
          FROM session_confirmations c
          JOIN bookings b ON b.id = c.booking_id
          LEFT JOIN coach_listings cl ON cl.id = b.listing_id
          LEFT JOIN coach_profiles cp ON cp.user_id = b.coach_user_id
          JOIN users au ON au.id = b.athlete_user_id
          LEFT JOIN payments p ON p.booking_id = b.id
          LEFT JOIN trainer_earnings e ON e.booking_id = b.id
          {where}
         ORDER BY (c.state = 'disputed') DESC, c.disputed_at DESC
         LIMIT $1 OFFSET $2
        """,
        limit, offset,
    )
    return int(total), [dict(r) for r in rows]
