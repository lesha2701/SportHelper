"""Data access for legal_acceptances: the record of what a user ticked at sign-up. Append-only (database triggers)."""
from __future__ import annotations

import json
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator
from uuid import UUID

import asyncpg


@asynccontextmanager
async def atomic(conn: asyncpg.Connection) -> AsyncIterator[None]:
    """Everything done inside commits together or not at all (a seam the in-memory test layer replaces)."""
    async with conn.transaction():
        yield


async def record(
    conn: asyncpg.Connection,
    *,
    user_id: UUID,
    role: str,
    full_name: str,
    phone: str | None,
    email: str,
    consent_key: str,
    documents: list[dict[str, str]],
    ip_address: str | None,
    booking_id: UUID | None = None,
) -> None:
    await conn.execute(
        """
        INSERT INTO legal_acceptances (user_id, role, full_name, phone, email, consent_key, documents, ip_address, booking_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
        """,
        user_id,
        role,
        full_name,
        phone,
        email,
        consent_key,
        json.dumps(documents, ensure_ascii=False),
        ip_address,
        booking_id,
    )


async def list_for_user(conn: asyncpg.Connection, user_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        "SELECT consent_key, documents, accepted_at, ip_address, role, full_name, phone, email "
        "FROM legal_acceptances WHERE user_id = $1 ORDER BY accepted_at, consent_key",
        user_id,
    )
    return [dict(row) for row in rows]
