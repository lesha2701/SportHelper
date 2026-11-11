"""Data access for the athlete's one-time code of an in-person session (migration 0045). Only the code's hash is stored.

All queries are parameterized. A code is replaced by issuing a new one; a verified booking never gets a new code."""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg

_FIELDS = "booking_id, code_hash, expires_at, attempts, issued_count, issued_at, verified_at, verified_by"


async def get(conn: asyncpg.Connection, booking_id: UUID, *, lock: bool = False) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_FIELDS} FROM session_codes WHERE booking_id = $1{' FOR UPDATE' if lock else ''}", booking_id)
    return dict(row) if row else None


async def issue(conn: asyncpg.Connection, booking_id: UUID, *, code_hash: str, expires_at: datetime) -> dict[str, Any] | None:
    """Stores a new code for the booking, replacing the previous one (its wrong attempts start again from zero, the issue count grows).
    None when the booking's code was already verified."""
    row = await conn.fetchrow(
        f"""
        INSERT INTO session_codes (booking_id, code_hash, expires_at) VALUES ($1, $2, $3)
        ON CONFLICT (booking_id) DO UPDATE
           SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0,
               issued_count = session_codes.issued_count + 1, issued_at = now()
         WHERE session_codes.verified_at IS NULL
        RETURNING {_FIELDS}
        """,
        booking_id, code_hash, expires_at,
    )
    return dict(row) if row else None


async def count_wrong(conn: asyncpg.Connection, booking_id: UUID) -> int:
    """One more wrong entry of the current code; returns how many there have been."""
    return await conn.fetchval(
        "UPDATE session_codes SET attempts = attempts + 1 WHERE booking_id = $1 AND verified_at IS NULL RETURNING attempts", booking_id
    ) or 0


async def mark_verified(conn: asyncpg.Connection, booking_id: UUID, *, by: UUID) -> bool:
    """True only for the first verification."""
    result = await conn.execute(
        "UPDATE session_codes SET verified_at = now(), verified_by = $2 WHERE booking_id = $1 AND verified_at IS NULL", booking_id, by
    )
    return result.endswith("1")
