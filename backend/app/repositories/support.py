"""Support requests (user -> administrators) and the administrators' queue.

A request is a conversation: the first message is support_requests.body, every later one (an administrator's answer or the
author's reply) is a row of support_messages. Closed is final; until then the two sides can keep writing."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

from app.repositories.admin_users import like_pattern

MAX_OPEN_PER_USER = 10
# Replies of the author in one request (the first message is not counted): a conversation, not a flood.
MAX_REPLIES = 20


async def count_open(conn: asyncpg.Connection, user_id: UUID) -> int:
    return await conn.fetchval("SELECT count(*) FROM support_requests WHERE user_id = $1 AND status IN ('new', 'in_progress')", user_id)


async def create(conn: asyncpg.Connection, *, user_id: UUID, kind: str, subject: str, body: str) -> dict[str, Any]:
    row = await conn.fetchrow(
        "INSERT INTO support_requests (user_id, kind, subject, body) VALUES ($1, $2, $3, $4) RETURNING id, status, created_at",
        user_id, kind, subject, body,
    )
    return dict(row)


async def messages_for(conn: asyncpg.Connection, request_ids: list[UUID]) -> dict[UUID, list[dict[str, Any]]]:
    """The messages after the first, oldest first, per request."""
    grouped: dict[UUID, list[dict[str, Any]]] = {rid: [] for rid in request_ids}
    if not request_ids:
        return grouped
    rows = await conn.fetch(
        "SELECT id, request_id, from_staff, body, created_at FROM support_messages WHERE request_id = ANY($1::uuid[]) ORDER BY created_at, id",
        request_ids,
    )
    for row in rows:
        grouped[row["request_id"]].append({k: row[k] for k in ("id", "from_staff", "body", "created_at")})
    return grouped


async def list_for_user(conn: asyncpg.Connection, user_id: UUID, *, limit: int = 50) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        "SELECT id, kind, subject, body, status, created_at FROM support_requests WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT $2",
        user_id, limit,
    )
    items = [dict(r) for r in rows]
    messages = await messages_for(conn, [r["id"] for r in items])
    for item in items:
        item["messages"] = messages[item["id"]]
        replies = sum(1 for m in item["messages"] if not m["from_staff"])
        item["can_reply"] = item["status"] != "closed" and replies < MAX_REPLIES
    return items


# --- the administrators' side ---------------------------------------------------------------------------------------

_SELECT = """
    s.id, s.kind, s.subject, s.body, s.status, s.created_at, s.handled_at,
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
          AND ($3::text IS NULL OR s.subject ILIKE $3 OR s.body ILIKE $3 OR EXISTS (SELECT 1 FROM support_messages m WHERE m.request_id = s.id AND m.body ILIKE $3)
               OR u.email ILIKE $3 OR u.first_name ILIKE $3
               OR u.last_name ILIKE $3 OR (u.first_name || ' ' || COALESCE(u.last_name, '')) ILIKE $3
               OR ($4::uuid IS NOT NULL AND (s.id = $4::uuid OR s.user_id = $4::uuid)))
    """
    args = (status, kind, like_pattern(query), as_id)
    total = await conn.fetchval(f"SELECT count(*) FROM support_requests s JOIN users u ON u.id = s.user_id {where}", *args)
    # Open ones first, whoever has waited longest on top (a queue; a reply puts the request back with a fresh wait);
    # answered and closed ones after, the freshest first.
    rows = await conn.fetch(
        f"""
        SELECT {_SELECT} {_FROM} {where}
        ORDER BY (s.status IN ('new', 'in_progress')) DESC,
                 CASE WHEN s.status IN ('new', 'in_progress') THEN s.waiting_since END ASC,
                 s.updated_at DESC, s.id
        LIMIT $5 OFFSET $6
        """,
        *args, limit, offset,
    )
    items = [dict(r) for r in rows]
    messages = await messages_for(conn, [r["id"] for r in items])
    for item in items:
        item["messages"] = messages[item["id"]]
    return total, items


async def get_request(conn: asyncpg.Connection, request_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_SELECT} {_FROM} WHERE s.id = $1", request_id)
    if row is None:
        return None
    item = dict(row)
    item["messages"] = (await messages_for(conn, [request_id]))[request_id]
    return item


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
    """An administrator's message: new / in_progress / answered -> answered (the ball is with the author). Not after closing."""
    async with conn.transaction():
        row = await conn.fetchrow("SELECT status FROM support_requests WHERE id = $1 FOR UPDATE", request_id)
        if row is None:
            return False
        if row["status"] == "closed":
            raise BadTransition(row["status"])
        await conn.execute("INSERT INTO support_messages (request_id, author_id, from_staff, body) VALUES ($1, $2, TRUE, $3)", request_id, admin_id, text)
        await conn.execute(
            "UPDATE support_requests SET status = 'answered', handled_by = $2, handled_at = now(), updated_at = now() WHERE id = $1", request_id, admin_id
        )
    return True


class TooManyReplies(Exception):
    pass


async def reply(conn: asyncpg.Connection, request_id: UUID, user_id: UUID, text: str) -> bool:
    """The author's next message. False if the request is not theirs (or does not exist); BadTransition once it is closed;
    TooManyReplies past MAX_REPLIES. A request that had an answer goes back to «new»: it is the administrators' turn again."""
    async with conn.transaction():
        row = await conn.fetchrow("SELECT status, user_id FROM support_requests WHERE id = $1 FOR UPDATE", request_id)
        if row is None or row["user_id"] != user_id:
            return False
        if row["status"] == "closed":
            raise BadTransition(row["status"])
        replies = await conn.fetchval("SELECT count(*) FROM support_messages WHERE request_id = $1 AND NOT from_staff", request_id)
        if replies >= MAX_REPLIES:
            raise TooManyReplies
        await conn.execute("INSERT INTO support_messages (request_id, author_id, from_staff, body) VALUES ($1, $2, FALSE, $3)", request_id, user_id, text)
        await conn.execute(
            "UPDATE support_requests SET status = CASE WHEN status = 'answered' THEN 'new' ELSE status END, waiting_since = now(), updated_at = now() WHERE id = $1",
            request_id,
        )
    return True


async def close(conn: asyncpg.Connection, request_id: UUID, admin_id: UUID) -> bool:
    """Any open state (also answered) -> closed. Final."""
    async with conn.transaction():
        row = await conn.fetchrow("SELECT status FROM support_requests WHERE id = $1 FOR UPDATE", request_id)
        if row is None:
            return False
        if row["status"] == "closed":
            raise BadTransition(row["status"])
        await conn.execute(
            "UPDATE support_requests SET status = 'closed', handled_by = $2, handled_at = now(), updated_at = now() WHERE id = $1", request_id, admin_id
        )
    return True
