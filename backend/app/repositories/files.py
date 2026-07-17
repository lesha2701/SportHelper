"""Data access for file metadata. Actual bytes live on Yandex.Disk; only
pointers and access-control metadata are stored here. All queries are
parameterized."""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg

_FILE_FIELDS = (
    "id, owner_id, team_id, entity_type, entity_id, disk_path, filename, "
    "mime_type, size_bytes, status, access_level, created_at, updated_at, deleted_at"
)


async def create_file(
    conn: asyncpg.Connection,
    *,
    owner_id: UUID,
    team_id: UUID | None,
    entity_type: str,
    entity_id: UUID | None,
    disk_path: str,
    filename: str,
    mime_type: str,
    size_bytes: int,
    access_level: str,
) -> dict[str, Any]:
    row = await conn.fetchrow(
        f"""
        INSERT INTO files (
            owner_id, team_id, entity_type, entity_id, disk_path, filename,
            mime_type, size_bytes, status, access_level
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ready', $9)
        RETURNING {_FILE_FIELDS}
        """,
        owner_id,
        team_id,
        entity_type,
        entity_id,
        disk_path,
        filename,
        mime_type,
        size_bytes,
        access_level,
    )
    return dict(row)


async def get_file(conn: asyncpg.Connection, file_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"SELECT {_FILE_FIELDS} FROM files WHERE id = $1 AND deleted_at IS NULL", file_id
    )
    return dict(row) if row else None


async def replace_team_logo(conn: asyncpg.Connection, team_id: UUID, new_file_id: UUID) -> UUID | None:
    """Point the team at the new logo file and soft-delete the previous one
    (if any). The old file's bytes are cleaned up from Yandex.Disk by the
    background retention job, not here."""
    async with conn.transaction():
        old_file_id = await conn.fetchval(
            "SELECT logo_file_id FROM teams WHERE id = $1 FOR UPDATE", team_id
        )
        await conn.execute("UPDATE teams SET logo_file_id = $2 WHERE id = $1", team_id, new_file_id)
        if old_file_id is not None:
            await conn.execute("UPDATE files SET deleted_at = now() WHERE id = $1", old_file_id)
    return old_file_id


async def list_purgeable(conn: asyncpg.Connection, before: datetime, limit: int = 100) -> list[dict[str, Any]]:
    """Files soft-deleted before the retention cutoff — safe to remove from
    Yandex.Disk and the database for good."""
    rows = await conn.fetch(
        f"""
        SELECT {_FILE_FIELDS} FROM files
        WHERE deleted_at IS NOT NULL AND deleted_at < $1
        ORDER BY deleted_at
        LIMIT $2
        """,
        before,
        limit,
    )
    return [dict(row) for row in rows]


async def hard_delete(conn: asyncpg.Connection, file_id: UUID) -> None:
    await conn.execute("DELETE FROM files WHERE id = $1", file_id)
