"""The «Подобрать тренера» requests of athletes and the administrators' queue of them."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

from app.repositories import match_offers as offers_repo
from app.repositories.admin_users import like_pattern

MAX_OPEN_PER_USER = 3

_COLUMNS = (
    "id, sport, goal, level, format, city, budget_min, budget_max, currency, weekdays, day_parts, schedule_note, comment, status, created_at"
)


class BadTransition(Exception):
    def __init__(self, current: str):
        self.current = current


async def count_open(conn: asyncpg.Connection, user_id: UUID) -> int:
    return await conn.fetchval("SELECT count(*) FROM coach_match_requests WHERE user_id = $1 AND status IN ('new', 'in_progress')", user_id)


async def create(conn: asyncpg.Connection, user_id: UUID, data: dict[str, Any]) -> dict[str, Any]:
    row = await conn.fetchrow(
        f"""
        INSERT INTO coach_match_requests (user_id, sport, goal, level, format, city, budget_min, budget_max, currency, weekdays, day_parts,
                                          schedule_note, comment)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::smallint[], $11::text[], $12, $13)
        RETURNING {_COLUMNS}
        """,
        user_id, data["sport"], data["goal"], data["level"], data["format"], data["city"], data["budget_min"], data["budget_max"],
        data["currency"], data["weekdays"], data["day_parts"], data["schedule_note"], data["comment"],
    )
    return dict(row)


async def list_for_user(conn: asyncpg.Connection, user_id: UUID, *, limit: int = 50) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"SELECT {_COLUMNS} FROM coach_match_requests WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT $2", user_id, limit
    )
    return [dict(r) for r in rows]


async def cancel(conn: asyncpg.Connection, request_id: UUID, user_id: UUID) -> dict[str, Any] | None:
    """The author withdraws an open request. None when it is not theirs (or does not exist); BadTransition when it is already over."""
    async with conn.transaction():
        row = await conn.fetchrow("SELECT status, user_id FROM coach_match_requests WHERE id = $1 FOR UPDATE", request_id)
        if row is None or row["user_id"] != user_id:
            return None
        if row["status"] not in ("new", "in_progress"):
            raise BadTransition(row["status"])
        updated = await conn.fetchrow(
            f"UPDATE coach_match_requests SET status = 'canceled', updated_at = now() WHERE id = $1 RETURNING {_COLUMNS}", request_id
        )
        await offers_repo.withdraw_all_for_request(conn, request_id)
    return dict(updated)


# --- the administrators' side ----------------------------------------------------------------------------------------

_ADMIN_SELECT = """
    m.id, m.sport, m.goal, m.level, m.format, m.city, m.budget_min, m.budget_max, m.currency, m.weekdays, m.day_parts, m.schedule_note,
    m.comment, m.status, m.created_at, m.admin_note, m.handled_at,
    u.id AS author_id, u.email AS author_email, u.first_name AS author_first_name, u.last_name AS author_last_name,
    h.email AS handled_by_email
"""
_ADMIN_FROM = "FROM coach_match_requests m JOIN users u ON u.id = m.user_id LEFT JOIN users h ON h.id = m.handled_by"


async def list_requests(
    conn: asyncpg.Connection, *, status: str | None, query: str | None, limit: int, offset: int
) -> tuple[int, list[dict[str, Any]]]:
    try:
        as_id = UUID(query.strip()) if query else None
    except ValueError:
        as_id = None
    where = """
        WHERE ($1::text IS NULL OR m.status = $1)
          AND ($2::text IS NULL OR m.sport ILIKE $2 OR m.city ILIKE $2 OR m.goal ILIKE $2 OR u.email ILIKE $2 OR u.first_name ILIKE $2
               OR u.last_name ILIKE $2 OR (u.first_name || ' ' || COALESCE(u.last_name, '')) ILIKE $2
               OR ($3::uuid IS NOT NULL AND (m.id = $3::uuid OR m.user_id = $3::uuid)))
    """
    args = (status, like_pattern(query), as_id)
    total = await conn.fetchval(f"SELECT count(*) FROM coach_match_requests m JOIN users u ON u.id = m.user_id {where}", *args)
    # A queue: open ones first, the one that has waited longest on top; closed ones after, the freshest first.
    rows = await conn.fetch(
        f"""
        SELECT {_ADMIN_SELECT} {_ADMIN_FROM} {where}
        ORDER BY (m.status IN ('new', 'in_progress')) DESC,
                 CASE WHEN m.status IN ('new', 'in_progress') THEN m.created_at END ASC,
                 m.updated_at DESC, m.id
        LIMIT $4 OFFSET $5
        """,
        *args, limit, offset,
    )
    return total, [dict(r) for r in rows]


async def count_new(conn: asyncpg.Connection) -> int:
    return await conn.fetchval("SELECT count(*) FROM coach_match_requests WHERE status = 'new'")


async def get_request(conn: asyncpg.Connection, request_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_ADMIN_SELECT} {_ADMIN_FROM} WHERE m.id = $1", request_id)
    return dict(row) if row else None


async def take(conn: asyncpg.Connection, request_id: UUID, admin_id: UUID) -> bool:
    """new -> in_progress. False if there is no such request; BadTransition from any other state."""
    async with conn.transaction():
        row = await conn.fetchrow("SELECT status FROM coach_match_requests WHERE id = $1 FOR UPDATE", request_id)
        if row is None:
            return False
        if row["status"] != "new":
            raise BadTransition(row["status"])
        await conn.execute(
            "UPDATE coach_match_requests SET status = 'in_progress', handled_by = $2, updated_at = now() WHERE id = $1", request_id, admin_id
        )
    return True


async def close(conn: asyncpg.Connection, request_id: UUID, admin_id: UUID, note: str | None) -> bool:
    """new / in_progress / matched -> closed, with an optional note on how it ended. Final. Offers still waiting are withdrawn."""
    async with conn.transaction():
        row = await conn.fetchrow("SELECT status FROM coach_match_requests WHERE id = $1 FOR UPDATE", request_id)
        if row is None:
            return False
        if row["status"] not in ("new", "in_progress", "matched"):
            raise BadTransition(row["status"])
        await offers_repo.withdraw_all_for_request(conn, request_id)
        await conn.execute(
            "UPDATE coach_match_requests SET status = 'closed', admin_note = $3, handled_by = $2, handled_at = now(), updated_at = now() WHERE id = $1",
            request_id, admin_id, note,
        )
    return True
