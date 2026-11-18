"""Support requests (user -> administrators) and the administrators' queue."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

from app.repositories.admin_users import like_pattern

MAX_OPEN_PER_USER = 10


async def count_open(conn: asyncpg.Connection, user_id: UUID) -> int:
    return await conn.fetchval("SELECT count(*) FROM support_requests WHERE user_id = $1 AND status IN ('new', 'in_progress')", user_id)


async def create(conn: asyncpg.Connection, *, user_id: UUID, kind: str, subject: str, body: str) -> dict[str, Any]:
    row = await conn.fetchrow(
        "INSERT INTO support_requests (user_id, kind, subject, body) VALUES ($1, $2, $3, $4) RETURNING id, status, created_at",
        user_id, kind, subject, body,
    )
    return dict(row)


async def list_for_user(conn: asyncpg.Connection, user_id: UUID, *, limit: int = 50) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT id, kind, subject, body, status, created_at, answer, CASE WHEN status = 'answered' THEN handled_at END AS answered_at
          FROM support_requests WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT $2
        """,
        user_id, limit,
    )
    return [dict(r) for r in rows]


# --- the administrators' side ---------------------------------------------------------------------------------------

_SELECT = """
    s.id, s.kind, s.subject, s.body, s.status, s.created_at, s.answer, s.handled_at,
    u.id AS author_id, u.email AS author_email, u.first_name AS author_first_name, u.last_name AS author_last_name,
    h.email AS handled_by_email
"""
_FROM = "FROM support_requests s JOIN users u ON u.id = s.user_id LEFT JOIN users h ON h.id = s.handled_by"


async def list_requests(
    conn: asyncpg.Connection, *, status: str | None, kind: str | None, query: str | None, limit: int, offset: int
) -> tuple[int, list[dict[str, Any]]]:
    try:
        as_id = UUID(query.strip()) if query else None
    except ValueError:
        as_id = None
    where = """
        WHERE ($1::text IS NULL OR s.status = $1) AND ($2::text IS NULL OR s.kind = $2)
          AND ($3::text IS NULL OR s.subject ILIKE $3 OR s.body ILIKE $3 OR u.email ILIKE $3 OR u.first_name ILIKE $3
               OR u.last_name ILIKE $3 OR (u.first_name || ' ' || COALESCE(u.last_name, '')) ILIKE $3
               OR ($4::uuid IS NOT NULL AND (s.id = $4::uuid OR s.user_id = $4::uuid)))
    """
    args = (status, kind, like_pattern(query), as_id)
    total = await conn.fetchval(f"SELECT count(*) FROM support_requests s JOIN users u ON u.id = s.user_id {where}", *args)
    # Open ones first, the oldest waiting longest on top (a queue); closed ones after, the freshest first.
    rows = await conn.fetch(
        f"""
        SELECT {_SELECT} {_FROM} {where}
        ORDER BY (s.status IN ('new', 'in_progress')) DESC,
                 CASE WHEN s.status IN ('new', 'in_progress') THEN s.created_at END ASC,
                 COALESCE(s.handled_at, s.created_at) DESC, s.id
        LIMIT $5 OFFSET $6
        """,
        *args, limit, offset,
    )
    return total, [dict(r) for r in rows]


async def get_request(conn: asyncpg.Connection, request_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_SELECT} {_FROM} WHERE s.id = $1", request_id)
    return dict(row) if row else None


class BadTransition(Exception):
    def __init__(self, current: str):
        self.current = current


async def take(conn: asyncpg.Connection, request_id: UUID, admin_id: UUID) -> bool:
    """new -> in_progress. False if there is no such request; BadTransition from any other state."""
    async with conn.transaction():
        row = await conn.fetchrow("SELECT status FROM support_requests WHERE id = $1 FOR UPDATE", request_id)
        if row is None:
            return False
        if row["status"] != "new":
            raise BadTransition(row["status"])
        await conn.execute("UPDATE support_requests SET status = 'in_progress', handled_by = $2, updated_at = now() WHERE id = $1", request_id, admin_id)
    return True


async def answer(conn: asyncpg.Connection, request_id: UUID, admin_id: UUID, text: str) -> bool:
    """new / in_progress -> answered. Final: a further question is a new request."""
    async with conn.transaction():
        row = await conn.fetchrow("SELECT status FROM support_requests WHERE id = $1 FOR UPDATE", request_id)
        if row is None:
            return False
        if row["status"] not in ("new", "in_progress"):
            raise BadTransition(row["status"])
        await conn.execute(
            "UPDATE support_requests SET status = 'answered', answer = $2, handled_by = $3, handled_at = now(), updated_at = now() WHERE id = $1",
            request_id, text, admin_id,
        )
    return True


async def close(conn: asyncpg.Connection, request_id: UUID, admin_id: UUID) -> bool:
    """new / in_progress -> closed without an answer."""
    async with conn.transaction():
        row = await conn.fetchrow("SELECT status FROM support_requests WHERE id = $1 FOR UPDATE", request_id)
        if row is None:
            return False
        if row["status"] not in ("new", "in_progress"):
            raise BadTransition(row["status"])
        await conn.execute(
            "UPDATE support_requests SET status = 'closed', handled_by = $2, handled_at = now(), updated_at = now() WHERE id = $1", request_id, admin_id
        )
    return True
