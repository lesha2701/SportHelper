"""Complaints from users, and what the administrators see of them."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

from app.repositories import coach_listings as listings_repo
from app.repositories.admin_users import like_pattern

MAX_OPEN_PER_REPORTER = 30


async def resolve_target(conn: asyncpg.Connection, target_type: str, target_id: UUID) -> UUID | None:
    """Who the reported thing belongs to - but only if the reporter could see it at all (a hidden listing or file, a
    deleted account, a private file all look exactly like a thing that does not exist). None = not reportable."""
    if target_type == "user":
        return await conn.fetchval("SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL", target_id)
    if target_type == "listing":
        if not await listings_repo.is_public(conn, target_id):
            return None
        return await conn.fetchval("SELECT coach_user_id FROM coach_listings WHERE id = $1", target_id)
    if target_type == "media":
        return await conn.fetchval(
            "SELECT owner_id FROM files WHERE id = $1 AND deleted_at IS NULL AND hidden_at IS NULL AND access_level = 'PUBLIC'", target_id
        )
    return None


async def count_open(conn: asyncpg.Connection, reporter_id: UUID) -> int:
    return await conn.fetchval("SELECT count(*) FROM complaints WHERE reporter_id = $1 AND status IN ('new', 'in_progress')", reporter_id)


class Duplicate(Exception):
    pass


async def create(
    conn: asyncpg.Connection,
    *,
    reporter_id: UUID,
    target_type: str,
    target_id: UUID,
    target_user_id: UUID | None,
    reason: str,
    comment: str | None,
) -> dict[str, Any]:
    try:
        row = await conn.fetchrow(
            """
            INSERT INTO complaints (reporter_id, target_type, target_id, target_user_id, reason, comment)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, status, created_at
            """,
            reporter_id, target_type, target_id, target_user_id, reason, comment,
        )
    except asyncpg.UniqueViolationError:
        raise Duplicate() from None
    return dict(row)


# --- the administrators' side ---------------------------------------------------------------------------------------

_SELECT = """
    c.id, c.status, c.reason, c.comment, c.target_type, c.target_id, c.resolution, c.created_at, c.handled_at,
    r.id AS reporter_id, r.email AS reporter_email, r.first_name AS reporter_first_name, r.last_name AS reporter_last_name,
    tu.id AS target_user_id, tu.email AS target_user_email, tu.first_name AS target_user_first_name, tu.last_name AS target_user_last_name,
    h.email AS handled_by_email,
    (SELECT count(*) FROM complaints o WHERE o.target_type = c.target_type AND o.target_id = c.target_id AND o.id <> c.id
        AND o.status IN ('new', 'in_progress')) AS other_open,
    CASE c.target_type
        WHEN 'user' THEN (SELECT first_name || COALESCE(' ' || last_name, '') FROM users WHERE id = c.target_id)
        WHEN 'listing' THEN (SELECT title FROM coach_listings WHERE id = c.target_id)
        WHEN 'media' THEN (SELECT filename FROM files WHERE id = c.target_id)
    END AS target_label,
    CASE c.target_type
        WHEN 'user' THEN (SELECT CASE WHEN deleted_at IS NOT NULL THEN 'deleted'
                                      WHEN is_banned AND (banned_until IS NULL OR banned_until > now()) THEN 'blocked' ELSE 'active' END
                          FROM users WHERE id = c.target_id)
        WHEN 'listing' THEN (SELECT CASE WHEN deleted_at IS NOT NULL THEN 'deleted' WHEN moderation_hidden_at IS NOT NULL THEN 'hidden' ELSE 'visible' END
                             FROM coach_listings WHERE id = c.target_id)
        WHEN 'media' THEN (SELECT CASE WHEN deleted_at IS NOT NULL THEN 'deleted' WHEN hidden_at IS NOT NULL THEN 'hidden' ELSE 'visible' END
                           FROM files WHERE id = c.target_id)
    END AS target_state
"""
_FROM = """
    FROM complaints c JOIN users r ON r.id = c.reporter_id
    LEFT JOIN users tu ON tu.id = c.target_user_id LEFT JOIN users h ON h.id = c.handled_by
"""


async def list_complaints(
    conn: asyncpg.Connection, *, status: str | None, target_type: str | None, reason: str | None, query: str | None, limit: int, offset: int
) -> tuple[int, list[dict[str, Any]]]:
    try:
        as_id = UUID(query.strip()) if query else None
    except ValueError:
        as_id = None
    where = """
        WHERE ($1::text IS NULL OR c.status = $1) AND ($2::text IS NULL OR c.target_type = $2) AND ($3::text IS NULL OR c.reason = $3)
          AND ($4::text IS NULL OR r.email ILIKE $4 OR tu.email ILIKE $4 OR tu.first_name ILIKE $4 OR tu.last_name ILIKE $4
               OR (tu.first_name || ' ' || COALESCE(tu.last_name, '')) ILIKE $4 OR c.comment ILIKE $4
               OR ($5::uuid IS NOT NULL AND (c.id = $5::uuid OR c.target_id = $5::uuid OR c.target_user_id = $5::uuid OR c.reporter_id = $5::uuid)))
    """
    args = (status, target_type, reason, like_pattern(query), as_id)
    total = await conn.fetchval(
        f"SELECT count(*) FROM complaints c JOIN users r ON r.id = c.reporter_id LEFT JOIN users tu ON tu.id = c.target_user_id {where}", *args
    )
    # Open ones first (the queue), newest first inside each group; closed ones after, most recently handled first.
    rows = await conn.fetch(
        f"""
        SELECT {_SELECT} {_FROM} {where}
        ORDER BY (c.status IN ('new', 'in_progress')) DESC, COALESCE(c.handled_at, c.created_at) DESC, c.id
        LIMIT $6 OFFSET $7
        """,
        *args, limit, offset,
    )
    return total, [dict(r) for r in rows]


async def get_complaint(conn: asyncpg.Connection, complaint_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_SELECT} {_FROM} WHERE c.id = $1", complaint_id)
    return dict(row) if row else None


class BadTransition(Exception):
    def __init__(self, current: str):
        self.current = current


async def take(conn: asyncpg.Connection, complaint_id: UUID, admin_id: UUID) -> bool:
    """new -> in_progress. False if there is no such complaint; BadTransition from any other state."""
    async with conn.transaction():
        row = await conn.fetchrow("SELECT status FROM complaints WHERE id = $1 FOR UPDATE", complaint_id)
        if row is None:
            return False
        if row["status"] != "new":
            raise BadTransition(row["status"])
        await conn.execute("UPDATE complaints SET status = 'in_progress', handled_by = $2, updated_at = now() WHERE id = $1", complaint_id, admin_id)
    return True


async def close(conn: asyncpg.Connection, complaint_id: UUID, admin_id: UUID, status: str, resolution: str) -> bool:
    """new / in_progress -> resolved | rejected. Closed complaints are final."""
    async with conn.transaction():
        row = await conn.fetchrow("SELECT status FROM complaints WHERE id = $1 FOR UPDATE", complaint_id)
        if row is None:
            return False
        if row["status"] not in ("new", "in_progress"):
            raise BadTransition(row["status"])
        await conn.execute(
            "UPDATE complaints SET status = $2, resolution = $3, handled_by = $4, handled_at = now(), updated_at = now() WHERE id = $1",
            complaint_id, status, resolution, admin_id,
        )
    return True


async def counts(conn: asyncpg.Connection) -> dict[str, int]:
    row = await conn.fetchrow(
        """
        SELECT count(*) FILTER (WHERE status = 'new') AS new_complaints,
               count(*) FILTER (WHERE status IN ('new', 'in_progress') AND target_type IN ('media', 'listing')) AS content_pending
        FROM complaints
        """
    )
    return dict(row)
