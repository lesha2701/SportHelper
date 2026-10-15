"""Moderation of uploaded photos and videos: find them, hide/restore them, and delete them safely.

The file bytes live on Yandex.Disk; this module only touches the database. Deleting first detaches the file from
whatever shows it, in one transaction, and refuses when the file is not exclusively ONE object's file."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

from app.repositories.admin_users import like_pattern

# What an administrator sees as "kinds" of media -> the entity_type values stored in files.
KINDS: dict[str, list[str]] = {
    "avatar": ["user_avatar"],
    "logo": ["team_logo"],
    "listing": ["coach_listing_photo", "coach_listing_video"],
    "gallery": ["profile_media_photo", "profile_media_video"],
    "exercise": ["exercise_photo", "exercise_video"],
    "training": ["training_report_photo", "training_report_video", "task_photo", "task_video"],
}
KIND_OF_ENTITY = {entity: kind for kind, entities in KINDS.items() for entity in entities}

# Every column that points at files(id), and what to do with it when the file is removed: set it to NULL, or
# remove the row that exists only to show that file. A test compares this with the database's real foreign keys,
# so a future table referencing files cannot be forgotten here.
REFERENCES: dict[tuple[str, str], str] = {
    ("users", "avatar_file_id"): "null",
    ("teams", "logo_file_id"): "null",
    ("coach_listings", "photo_file_id"): "null",
    ("coach_listings", "video_file_id"): "null",
    ("exercises", "photo_file_id"): "null",
    ("exercises", "video_file_id"): "null",
    ("training_reports", "photo_file_id"): "null",
    ("training_reports", "video_file_id"): "null",
    ("task_assignments", "photo_file_id"): "null",
    ("task_assignments", "video_file_id"): "null",
    ("profile_media", "file_id"): "delete",
}

_FILE_COLUMNS = """
    f.id, f.entity_type, f.entity_id, f.filename, f.mime_type, f.size_bytes, f.access_level, f.created_at,
    f.hidden_at, f.moderation_reason, (f.thumb_disk_path IS NOT NULL) AS has_thumb,
    o.id AS owner_id, o.email AS owner_email, o.first_name AS owner_first_name, o.last_name AS owner_last_name,
    hb.email AS hidden_by_email
"""
_FILE_FROM = "FROM files f JOIN users o ON o.id = f.owner_id LEFT JOIN users hb ON hb.id = f.hidden_by"


async def list_media(
    conn: asyncpg.Connection,
    *,
    query: str | None,
    kind: str | None,
    media_type: str | None,
    state: str | None,
    limit: int,
    offset: int,
) -> tuple[int, list[dict[str, Any]]]:
    entities = KINDS.get(kind) if kind else None
    owner_id: UUID | None = None
    if query:
        try:
            owner_id = UUID(query.strip())
        except ValueError:
            owner_id = None
    where = """
        WHERE f.deleted_at IS NULL
          AND ($1::text[] IS NULL OR f.entity_type = ANY($1::text[]))
          AND ($2::text IS NULL OR f.mime_type LIKE $2 || '/%')
          AND ($3::text IS NULL OR ($3 = 'hidden' AND f.hidden_at IS NOT NULL) OR ($3 = 'visible' AND f.hidden_at IS NULL))
          AND ($4::text IS NULL OR o.email ILIKE $4 OR o.first_name ILIKE $4 OR o.last_name ILIKE $4
               OR (o.first_name || ' ' || COALESCE(o.last_name, '')) ILIKE $4 OR f.filename ILIKE $4
               OR ($5::uuid IS NOT NULL AND (o.id = $5::uuid OR f.id = $5::uuid)))
    """
    args = (entities, media_type, state, like_pattern(query), owner_id)
    total = await conn.fetchval(f"SELECT count(*) FROM files f JOIN users o ON o.id = f.owner_id {where}", *args)
    rows = await conn.fetch(
        f"SELECT {_FILE_COLUMNS} {_FILE_FROM} {where} ORDER BY f.created_at DESC, f.id LIMIT $6 OFFSET $7", *args, limit, offset
    )
    return total, [dict(r) for r in rows]


async def get_media(conn: asyncpg.Connection, file_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_FILE_COLUMNS} {_FILE_FROM} WHERE f.id = $1 AND f.deleted_at IS NULL", file_id)
    return dict(row) if row else None


async def get_storage_record(conn: asyncpg.Connection, file_id: UUID) -> dict[str, Any] | None:
    """The paths the bytes live at. Only for the admin content route and the deletion cleanup."""
    row = await conn.fetchrow(
        "SELECT id, disk_path, thumb_disk_path, mime_type, filename FROM files WHERE id = $1 AND deleted_at IS NULL", file_id
    )
    return dict(row) if row else None


async def describe_relation(conn: asyncpg.Connection, media: dict[str, Any]) -> dict[str, Any] | None:
    """What this file belongs to, for the "open the related listing/profile" links."""
    entity, entity_id = media["entity_type"], media["entity_id"]
    if entity == "user_avatar":
        return {"type": "user", "id": media["owner_id"], "label": "Профиль владельца"}
    if entity == "profile_media_photo" or entity == "profile_media_video":
        return {"type": "user", "id": media["owner_id"], "label": "Галерея достижений владельца"}
    if entity in ("coach_listing_photo", "coach_listing_video") and entity_id:
        title = await conn.fetchval("SELECT title FROM coach_listings WHERE id = $1", entity_id)
        return {"type": "listing", "id": entity_id, "label": f"Объявление «{title}»" if title else "Объявление"}
    if entity == "team_logo" and entity_id:
        name = await conn.fetchval("SELECT name FROM teams WHERE id = $1", entity_id)
        return {"type": "team", "id": entity_id, "label": f"Команда «{name}»" if name else "Команда"}
    if entity in ("exercise_photo", "exercise_video") and entity_id:
        name = await conn.fetchval("SELECT name FROM exercises WHERE id = $1", entity_id)
        return {"type": "exercise", "id": entity_id, "label": f"Упражнение «{name}»" if name else "Упражнение"}
    if entity.startswith("training_report") and entity_id:
        return {"type": "training", "id": entity_id, "label": "Отчёт о тренировке"}
    if entity.startswith("task_") and entity_id:
        title = await conn.fetchval("SELECT title FROM tasks WHERE id = $1", entity_id)
        return {"type": "task", "id": entity_id, "label": f"Задание «{title}»" if title else "Задание"}
    return None


async def open_complaints_count(conn: asyncpg.Connection, file_id: UUID) -> int:
    return await conn.fetchval(
        "SELECT count(*) FROM complaints WHERE target_type = 'media' AND target_id = $1 AND status IN ('new', 'in_progress')", file_id
    )


class WrongState(Exception):
    pass


async def set_hidden(conn: asyncpg.Connection, file_id: UUID, admin_id: UUID, hide: bool, reason: str) -> dict[str, Any] | None:
    """Hides or restores a file. WrongState if it is already in the requested state; None if there is no such file."""
    async with conn.transaction():
        current = await conn.fetchrow("SELECT id, hidden_at FROM files WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", file_id)
        if current is None:
            return None
        if (current["hidden_at"] is not None) == hide:
            raise WrongState()
        if hide:
            await conn.execute(
                "UPDATE files SET hidden_at = now(), hidden_by = $2, moderation_reason = $3 WHERE id = $1", file_id, admin_id, reason
            )
        else:
            await conn.execute("UPDATE files SET hidden_at = NULL, hidden_by = NULL, moderation_reason = NULL WHERE id = $1", file_id)
    return await get_media(conn, file_id)


class Shared(Exception):
    """The file is used by more than one object, or another file record points at the same bytes."""


async def reference_count(conn: asyncpg.Connection, file_id: UUID) -> int:
    total = 0
    for (table, column), _ in REFERENCES.items():
        # Identifiers come from the constant above, never from a request.
        extra = " AND deleted_at IS NULL" if table == "profile_media" else ""
        total += await conn.fetchval(f"SELECT count(*) FROM {table} WHERE {column} = $1{extra}", file_id)
    return total


async def unknown_references(conn: asyncpg.Connection) -> list[tuple[str, str]]:
    """Foreign keys to files(id) that REFERENCES does not know about (used by a test and as a runtime guard)."""
    rows = await conn.fetch(
        """
        SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
        FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f' AND c.confrelid = 'files'::regclass
        """
    )
    return sorted((r["tbl"], r["col"]) for r in rows if (r["tbl"], r["col"]) not in REFERENCES)


async def detach_and_remove(conn: asyncpg.Connection, file_id: UUID, retention_days: int) -> dict[str, Any] | None:
    """In ONE transaction: refuse if the file is shared, detach it from everything that shows it and mark it deleted
    far enough in the past that the background purge would take it at its next run. Returns the storage paths, or None
    if the file does not exist. Raises Shared. The caller then removes the bytes and finally the row."""
    async with conn.transaction():
        record = await conn.fetchrow(
            "SELECT id, disk_path, thumb_disk_path FROM files WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", file_id
        )
        if record is None:
            return None
        if await unknown_references(conn):
            raise Shared()
        same_bytes = await conn.fetchval(
            "SELECT count(*) FROM files WHERE disk_path = $1 AND id <> $2 AND deleted_at IS NULL", record["disk_path"], file_id
        )
        if same_bytes or await reference_count(conn, file_id) > 1:
            raise Shared()
        for (table, column), action in REFERENCES.items():
            if action == "delete":
                await conn.execute(f"DELETE FROM {table} WHERE {column} = $1", file_id)
            else:
                await conn.execute(f"UPDATE {table} SET {column} = NULL WHERE {column} = $1", file_id)
        await conn.execute(
            "UPDATE files SET deleted_at = now() - make_interval(days => $2 + 1) WHERE id = $1", file_id, retention_days
        )
    return dict(record)
