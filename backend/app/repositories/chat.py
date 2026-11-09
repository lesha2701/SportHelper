"""Data access for chats. Who may read or write is decided in services/chat.py; this module only stores and fetches."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

_MESSAGE_SELECT = """
    SELECT m.id, m.conversation_id, m.sender_id, m.body, m.file_id, m.attachment_kind, m.created_at, m.deleted_at,
           u.first_name AS sender_first_name, u.last_name AS sender_last_name,
           f.filename AS file_name, f.mime_type AS file_mime, f.thumb_disk_path IS NOT NULL AS has_thumb
      FROM chat_messages m
      JOIN users u ON u.id = m.sender_id
      LEFT JOIN files f ON f.id = m.file_id
"""


async def get_conversation(conn: asyncpg.Connection, conversation_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow("SELECT id, kind, booking_id, team_id, created_at FROM chat_conversations WHERE id = $1", conversation_id)
    return dict(row) if row else None


async def find_for_booking(conn: asyncpg.Connection, booking_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow("SELECT id, kind, booking_id, team_id, created_at FROM chat_conversations WHERE booking_id = $1", booking_id)
    return dict(row) if row else None


async def find_for_team(conn: asyncpg.Connection, team_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow("SELECT id, kind, booking_id, team_id, created_at FROM chat_conversations WHERE team_id = $1", team_id)
    return dict(row) if row else None


async def ensure_for_booking(conn: asyncpg.Connection, booking_id: UUID) -> dict[str, Any]:
    await conn.execute("INSERT INTO chat_conversations (kind, booking_id) VALUES ('booking', $1) ON CONFLICT (booking_id) DO NOTHING", booking_id)
    found = await find_for_booking(conn, booking_id)
    assert found is not None
    return found


async def ensure_for_team(conn: asyncpg.Connection, team_id: UUID) -> dict[str, Any]:
    await conn.execute("INSERT INTO chat_conversations (kind, team_id) VALUES ('team', $1) ON CONFLICT (team_id) DO NOTHING", team_id)
    found = await find_for_team(conn, team_id)
    assert found is not None
    return found


async def get_message(conn: asyncpg.Connection, message_id: int) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"{_MESSAGE_SELECT} WHERE m.id = $1", message_id)
    return dict(row) if row else None


async def get_by_client_key(conn: asyncpg.Connection, conversation_id: UUID, sender_id: UUID, client_key: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"{_MESSAGE_SELECT} WHERE m.conversation_id = $1 AND m.sender_id = $2 AND m.client_key = $3", conversation_id, sender_id, client_key
    )
    return dict(row) if row else None


async def get_by_file(conn: asyncpg.Connection, file_id: UUID) -> dict[str, Any] | None:
    """The live (not deleted) message a chat file belongs to - the way a chat file's access is decided."""
    row = await conn.fetchrow(
        "SELECT m.id, m.conversation_id FROM chat_messages m WHERE m.file_id = $1 AND m.deleted_at IS NULL", file_id
    )
    return dict(row) if row else None


async def list_messages(
    conn: asyncpg.Connection, conversation_id: UUID, *, before_id: int | None, after_id: int | None, limit: int
) -> tuple[list[dict[str, Any]], bool]:
    """Oldest-first page. `after_id` = what is new since I last looked; `before_id` = an older page; neither = the latest page.
    The flag says whether there is anything older than the first returned message."""
    if after_id is not None:
        rows = await conn.fetch(f"{_MESSAGE_SELECT} WHERE m.conversation_id = $1 AND m.id > $2 ORDER BY m.id LIMIT $3", conversation_id, after_id, limit)
        items = [dict(r) for r in rows]
        return items, False
    rows = await conn.fetch(
        f"{_MESSAGE_SELECT} WHERE m.conversation_id = $1 AND ($2::bigint IS NULL OR m.id < $2) ORDER BY m.id DESC LIMIT $3",
        conversation_id, before_id, limit + 1,
    )
    items = [dict(r) for r in rows]
    more = len(items) > limit
    items = list(reversed(items[:limit]))
    return items, more


async def insert_message(
    conn: asyncpg.Connection, *, conversation_id: UUID, sender_id: UUID, body: str | None, file_id: UUID | None,
    attachment_kind: str | None, client_key: UUID,
) -> int | None:
    """None when this client_key was already used by this sender in this chat (a double click or a retry)."""
    return await conn.fetchval(
        """
        INSERT INTO chat_messages (conversation_id, sender_id, body, file_id, attachment_kind, client_key)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (conversation_id, sender_id, client_key) DO NOTHING
        RETURNING id
        """,
        conversation_id, sender_id, body, file_id, attachment_kind, client_key,
    )


async def soft_delete(conn: asyncpg.Connection, message_id: int, deleted_by: UUID) -> bool:
    """Blanks nothing in storage but hides the message and its file from everyone; false when it was already deleted."""
    async with conn.transaction():
        row = await conn.fetchrow(
            "UPDATE chat_messages SET deleted_at = now(), deleted_by = $2 WHERE id = $1 AND deleted_at IS NULL RETURNING file_id", message_id, deleted_by
        )
        if row is None:
            return False
        if row["file_id"] is not None:
            await conn.execute("UPDATE files SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL", row["file_id"])
        return True


async def mark_read(conn: asyncpg.Connection, conversation_id: UUID, user_id: UUID, up_to_id: int) -> None:
    await conn.execute(
        """
        INSERT INTO chat_reads (conversation_id, user_id, last_read_id) VALUES ($1, $2, $3)
        ON CONFLICT (conversation_id, user_id) DO UPDATE
           SET last_read_id = GREATEST(chat_reads.last_read_id, EXCLUDED.last_read_id), updated_at = now()
        """,
        conversation_id, user_id, up_to_id,
    )


async def unread_for_user(conn: asyncpg.Connection, user_id: UUID) -> dict[str, dict[str, int]]:
    """Unread (from other people, not deleted) per booking chat and per team chat the person can currently read."""
    bookings = await conn.fetch(
        """
        SELECT c.booking_id AS ref, count(*) AS n
          FROM chat_conversations c
          JOIN bookings b ON b.id = c.booking_id AND (b.athlete_user_id = $1 OR b.coach_user_id = $1)
          JOIN chat_messages m ON m.conversation_id = c.id AND m.sender_id <> $1 AND m.deleted_at IS NULL
          LEFT JOIN chat_reads r ON r.conversation_id = c.id AND r.user_id = $1
         WHERE m.id > COALESCE(r.last_read_id, 0)
         GROUP BY c.booking_id
        """,
        user_id,
    )
    teams = await conn.fetch(
        """
        SELECT c.team_id AS ref, count(*) AS n
          FROM chat_conversations c
          JOIN team_members tm ON tm.team_id = c.team_id AND tm.user_id = $1
          JOIN chat_messages m ON m.conversation_id = c.id AND m.sender_id <> $1 AND m.deleted_at IS NULL
          LEFT JOIN chat_reads r ON r.conversation_id = c.id AND r.user_id = $1
         WHERE m.id > COALESCE(r.last_read_id, 0)
         GROUP BY c.team_id
        """,
        user_id,
    )
    return {"booking": {str(r["ref"]): int(r["n"]) for r in bookings}, "team": {str(r["ref"]): int(r["n"]) for r in teams}}


async def team_member_ids(conn: asyncpg.Connection, team_id: UUID) -> list[UUID]:
    return [r["user_id"] for r in await conn.fetch("SELECT user_id FROM team_members WHERE team_id = $1", team_id)]


async def queue_notifications(
    conn: asyncpg.Connection, *, conversation_id: UUID, recipients: list[UUID], category: str, title: str, body: str, entity_type: str, entity_id: UUID
) -> None:
    """One notification per person per UNREAD STREAK: the key carries how far they had read, so a second message before they open
    the chat adds nothing, and the next one after they read starts a new notification. A bulk insert: a big team is one statement."""
    if not recipients:
        return
    await conn.execute(
        """
        INSERT INTO notifications (user_id, category, title, body, entity_type, entity_id, send_at, dedup_key)
        SELECT r.user_id, $2, $3, $4, $5, $6, now(), 'chat:' || $1::text || ':' || r.user_id::text || ':' || COALESCE(cr.last_read_id, 0)::text
          FROM unnest($7::uuid[]) AS r(user_id)
          LEFT JOIN chat_reads cr ON cr.conversation_id = $1 AND cr.user_id = r.user_id
        ON CONFLICT (dedup_key) DO NOTHING
        """,
        conversation_id, category, title, body, entity_type, entity_id, recipients,
    )
