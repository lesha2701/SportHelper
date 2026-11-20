"""Blocks between people (database/patches/0055). A block is directed: the blocker stops seeing the blocked person's chat messages."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

# A SQL condition for a message row `m` (sender m.sender_id) that is TRUE when the viewer ($n) has NOT blocked its sender.
NOT_BLOCKED_BY = "NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE ub.blocker_id = {viewer} AND ub.blocked_id = m.sender_id)"


async def block(conn: asyncpg.Connection, blocker_id: UUID, blocked_id: UUID) -> None:
    await conn.execute("INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", blocker_id, blocked_id)


async def unblock(conn: asyncpg.Connection, blocker_id: UUID, blocked_id: UUID) -> None:
    await conn.execute("DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2", blocker_id, blocked_id)


async def list_blocked(conn: asyncpg.Connection, blocker_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        "SELECT b.blocked_id AS user_id, u.first_name, u.last_name, b.created_at FROM user_blocks b JOIN users u ON u.id = b.blocked_id "
        "WHERE b.blocker_id = $1 ORDER BY b.created_at DESC",
        blocker_id,
    )
    return [dict(r) for r in rows]


async def either_blocked(conn: asyncpg.Connection, a: UUID, b: UUID) -> bool:
    """Whether one of the two has blocked the other."""
    return bool(
        await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1))", a, b
        )
    )


async def blockers_among(conn: asyncpg.Connection, sender_id: UUID, recipients: list[UUID]) -> set[UUID]:
    """Of these people, those who have blocked the sender (they are not notified of his messages)."""
    if not recipients:
        return set()
    rows = await conn.fetch("SELECT blocker_id FROM user_blocks WHERE blocked_id = $1 AND blocker_id = ANY($2::uuid[])", sender_id, recipients)
    return {r["blocker_id"] for r in rows}
