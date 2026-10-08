"""Data access for the notification queue and per-category preferences. All
queries are parameterized."""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg

_NOTIFICATION_FIELDS = (
    "id, user_id, category, title, body, entity_type, entity_id, send_at, "
    "status, attempts, last_error, dedup_key, created_at, sent_at, read_at"
)


async def create_or_reschedule(
    conn: asyncpg.Connection,
    *,
    user_id: UUID,
    category: str,
    title: str,
    body: str,
    entity_type: str,
    entity_id: UUID,
    send_at: datetime,
    dedup_key: str,
) -> None:
    """Upserts by dedup_key: a fresh schedule (e.g. the coach moved the
    training) resets a pending/cancelled/failed row back to pending with the
    new send_at, but never touches a row that has already been sent."""
    await conn.execute(
        """
        INSERT INTO notifications (user_id, category, title, body, entity_type, entity_id, send_at, dedup_key)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (dedup_key) DO UPDATE SET
            send_at = EXCLUDED.send_at,
            title = EXCLUDED.title,
            body = EXCLUDED.body,
            status = 'pending',
            attempts = 0,
            last_error = NULL,
            sent_at = NULL
        WHERE notifications.status != 'sent'
        """,
        user_id,
        category,
        title,
        body,
        entity_type,
        entity_id,
        send_at,
        dedup_key,
    )


async def cancel_pending_for_entity(conn: asyncpg.Connection, entity_type: str, entity_id: UUID) -> None:
    await conn.execute(
        "UPDATE notifications SET status = 'cancelled' WHERE entity_type = $1 AND entity_id = $2 AND status = 'pending'",
        entity_type,
        entity_id,
    )


async def list_due(conn: asyncpg.Connection, limit: int = 100) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT {_NOTIFICATION_FIELDS} FROM notifications
        WHERE status = 'pending' AND send_at <= now()
        ORDER BY send_at
        LIMIT $1
        """,
        limit,
    )
    return [dict(row) for row in rows]


async def list_for_user(conn: asyncpg.Connection, user_id: UUID, limit: int = 50) -> list[dict[str, Any]]:
    """The website bell's feed — every notification that has actually
    "happened" for this user (due and not cancelled by a disabled
    preference), newest first. Excludes still-pending future-dated rows
    (e.g. a training reminder that hasn't fired yet) since those haven't
    happened from the user's point of view."""
    rows = await conn.fetch(
        f"""
        SELECT {_NOTIFICATION_FIELDS} FROM notifications
        WHERE user_id = $1 AND status != 'cancelled' AND send_at <= now()
        ORDER BY send_at DESC
        LIMIT $2
        """,
        user_id,
        limit,
    )
    return [dict(row) for row in rows]


async def mark_read(conn: asyncpg.Connection, notification_id: UUID, user_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"""
        UPDATE notifications SET read_at = COALESCE(read_at, now())
        WHERE id = $1 AND user_id = $2
        RETURNING {_NOTIFICATION_FIELDS}
        """,
        notification_id,
        user_id,
    )
    return dict(row) if row else None


async def mark_all_read(conn: asyncpg.Connection, user_id: UUID) -> None:
    await conn.execute(
        "UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", user_id
    )


async def mark_sent(conn: asyncpg.Connection, notification_id: UUID) -> None:
    await conn.execute(
        "UPDATE notifications SET status = 'sent', sent_at = now() WHERE id = $1", notification_id
    )


async def mark_retry(conn: asyncpg.Connection, notification_id: UUID, next_send_at: datetime, error: str) -> None:
    await conn.execute(
        """
        UPDATE notifications SET send_at = $2, attempts = attempts + 1, last_error = $3
        WHERE id = $1
        """,
        notification_id,
        next_send_at,
        error,
    )


async def mark_failed(conn: asyncpg.Connection, notification_id: UUID, error: str) -> None:
    await conn.execute(
        "UPDATE notifications SET status = 'failed', attempts = attempts + 1, last_error = $2 WHERE id = $1",
        notification_id,
        error,
    )


async def mark_cancelled(conn: asyncpg.Connection, notification_id: UUID) -> None:
    await conn.execute("UPDATE notifications SET status = 'cancelled' WHERE id = $1", notification_id)


async def is_enabled(conn: asyncpg.Connection, user_id: UUID, category: str) -> bool:
    value = await conn.fetchval(
        "SELECT enabled FROM notification_preferences WHERE user_id = $1 AND category = $2", user_id, category
    )
    return True if value is None else bool(value)


async def list_preferences(conn: asyncpg.Connection, user_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        "SELECT category, enabled FROM notification_preferences WHERE user_id = $1", user_id
    )
    return [dict(row) for row in rows]


async def set_preference(conn: asyncpg.Connection, user_id: UUID, category: str, enabled: bool) -> None:
    await conn.execute(
        """
        INSERT INTO notification_preferences (user_id, category, enabled)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, category) DO UPDATE SET enabled = EXCLUDED.enabled
        """,
        user_id,
        category,
        enabled,
    )


async def list_nudge_candidates(
    conn: asyncpg.Connection,
    *,
    inactive_before: datetime,
    min_gap_after: datetime,
    max_unanswered: int,
    limit: int,
) -> list[dict[str, Any]]:
    """Users who should get a "time to train" nudge right now:

    * not banned, and not active since `inactive_before` (last_login_at);
    * players or profile-less newcomers — coach-only accounts are skipped;
    * the category isn't switched off in their notification settings;
    * no nudge already queued/sent after `min_gap_after` (the minimum gap);
    * fewer than `max_unanswered` nudges since they last opened the app, so
      someone who has gone quiet (or blocked the bot) isn't nagged forever.
    """
    rows = await conn.fetch(
        """
        SELECT u.id AS user_id, (pp.user_id IS NOT NULL) AS has_player_profile
        FROM users u
        LEFT JOIN player_profiles pp ON pp.user_id = u.id
        LEFT JOIN coach_profiles cp ON cp.user_id = u.id
        WHERE u.is_banned = FALSE
          AND COALESCE(u.last_login_at, u.created_at) < $1
          AND (pp.user_id IS NOT NULL OR cp.user_id IS NULL)
          AND NOT EXISTS (
              SELECT 1 FROM notification_preferences np
              WHERE np.user_id = u.id AND np.category = 'training_nudge' AND np.enabled = FALSE
          )
          AND NOT EXISTS (
              SELECT 1 FROM notifications n
              WHERE n.user_id = u.id AND n.category = 'training_nudge'
                AND n.status IN ('pending', 'sent') AND n.send_at > $2
          )
          AND (
              SELECT COUNT(*) FROM notifications n
              WHERE n.user_id = u.id AND n.category = 'training_nudge'
                AND n.status IN ('pending', 'sent', 'failed')
                AND n.send_at > COALESCE(u.last_login_at, u.created_at)
          ) < $3
        ORDER BY COALESCE(u.last_login_at, u.created_at)
        LIMIT $4
        """,
        inactive_before,
        min_gap_after,
        max_unanswered,
        limit,
    )
    return [dict(row) for row in rows]
