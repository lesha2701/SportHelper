"""Data access for a user's achievement/highlight media gallery (many photos
and videos per user) — distinct from files.py's single-pointer-per-entity
patterns (team logo, listing photo/video). All queries are parameterized."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

_FIELDS = "id, user_id, file_id, media_type, caption, sort_order, created_at"


async def add_media(
    conn: asyncpg.Connection, *, user_id: UUID, file_id: UUID, media_type: str, caption: str | None
) -> dict[str, Any]:
    next_order = await conn.fetchval(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM profile_media WHERE user_id = $1 AND deleted_at IS NULL",
        user_id,
    )
    row = await conn.fetchrow(
        f"""
        INSERT INTO profile_media (user_id, file_id, media_type, caption, sort_order)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING {_FIELDS}
        """,
        user_id,
        file_id,
        media_type,
        caption,
        next_order,
    )
    return dict(row)


async def list_media(conn: asyncpg.Connection, user_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"SELECT {_FIELDS} FROM profile_media WHERE user_id = $1 AND deleted_at IS NULL ORDER BY sort_order",
        user_id,
    )
    return [dict(row) for row in rows]


async def delete_media(conn: asyncpg.Connection, media_id: UUID, user_id: UUID) -> UUID | None:
    """Soft-deletes the gallery entry and its underlying file (ownership
    checked — only the owning user may delete their own item). Returns the
    deleted file's id, or None if no matching entry was found."""
    async with conn.transaction():
        row = await conn.fetchrow(
            "SELECT file_id FROM profile_media WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE",
            media_id,
            user_id,
        )
        if row is None:
            return None
        await conn.execute("UPDATE profile_media SET deleted_at = now() WHERE id = $1", media_id)
        await conn.execute("UPDATE files SET deleted_at = now() WHERE id = $1", row["file_id"])
        return row["file_id"]
