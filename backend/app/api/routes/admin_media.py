"""Moderation of user photos and videos (administrators with the second factor only).

The first move is always "hide": the file disappears from the whole platform but nothing is destroyed. Restoring
undoes it. Deleting is separate, irreversible, asks for a fresh second-factor code and refuses to touch a file that
is shared or lives outside the application's own storage folder."""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from app.api.deps import AuthContext, get_db, get_settings_dep, require_admin_mfa, require_admin_recent_mfa
from app.config import Settings
from app.core.exceptions import APIError, ConflictError, NotFoundError
from app.integrations.yandex_disk import YandexDiskClient, YandexDiskError
from app.repositories import admin_media as media_repo
from app.repositories import files as files_repo
from app.schemas.admin import (
    ConfirmedReasonIn,
    MediaDeletedOut,
    MediaDetailOut,
    MediaOwnerOut,
    MediaPageOut,
    MediaRowOut,
    ReasonIn,
    RelatedObjectOut,
)
from app.services import admin_audit

logger = logging.getLogger("teamflow.admin.media")

router = APIRouter(prefix="/api/admin/media", tags=["admin"])


def _media_type(mime: str) -> str:
    return "image" if mime.startswith("image/") else "video" if mime.startswith("video/") else "other"


def _row(r: dict) -> MediaRowOut:
    return MediaRowOut(
        id=r["id"],
        kind=media_repo.KIND_OF_ENTITY.get(r["entity_type"], "other"),
        media_type=_media_type(r["mime_type"]),
        filename=r["filename"],
        mime_type=r["mime_type"],
        size_bytes=r["size_bytes"],
        created_at=r["created_at"],
        owner=MediaOwnerOut(id=r["owner_id"], email=r["owner_email"], name=" ".join(filter(None, [r["owner_first_name"], r["owner_last_name"]]))),
        hidden=r["hidden_at"] is not None,
        hidden_at=r["hidden_at"],
        moderation_reason=r["moderation_reason"],
        hidden_by=r["hidden_by_email"],
        has_thumb=r["has_thumb"],
    )


async def _detail(conn: asyncpg.Connection, file_id: UUID) -> MediaDetailOut:
    media = await media_repo.get_media(conn, file_id)
    if media is None:
        raise NotFoundError("file not found")
    related = await media_repo.describe_relation(conn, media)
    return MediaDetailOut(
        **_row(media).model_dump(),
        related=RelatedObjectOut(**related) if related else None,
        open_complaints=await media_repo.open_complaints_count(conn, file_id),
    )


def _snapshot(media: MediaDetailOut | dict) -> dict:
    data = media if isinstance(media, dict) else media.model_dump()
    return {"hidden": data["hidden"], "kind": data["kind"], "owner": str(data["owner"]["id"]) if isinstance(data["owner"], dict) else str(data["owner"].id)}


@router.get("", response_model=MediaPageOut)
async def list_media(
    q: str | None = Query(default=None, max_length=100),
    kind: Literal["avatar", "logo", "listing", "gallery", "exercise", "training"] | None = None,
    media_type: Literal["image", "video"] | None = None,
    state: Literal["visible", "hidden"] | None = None,
    limit: int = Query(default=24, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=1_000_000),
    ctx: AuthContext = Depends(require_admin_mfa),
    conn: asyncpg.Connection = Depends(get_db),
) -> MediaPageOut:
    total, rows = await media_repo.list_media(conn, query=q, kind=kind, media_type=media_type, state=state, limit=limit, offset=offset)
    return MediaPageOut(total=total, limit=limit, offset=offset, items=[_row(r) for r in rows])


@router.get("/{file_id}", response_model=MediaDetailOut)
async def media_detail(
    file_id: UUID, ctx: AuthContext = Depends(require_admin_mfa), conn: asyncpg.Connection = Depends(get_db)
) -> MediaDetailOut:
    return await _detail(conn, file_id)


@router.get("/{file_id}/content")
async def media_content(
    file_id: UUID,
    size: str | None = Query(default=None, pattern="^thumb$"),
    ctx: AuthContext = Depends(require_admin_mfa),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> StreamingResponse:
    """The file itself, hidden or not, for moderators. This is the only way to view a hidden file."""
    record = await media_repo.get_storage_record(conn, file_id)
    if record is None:
        raise NotFoundError("file not found")
    path = (record["thumb_disk_path"] if size == "thumb" else None) or record["disk_path"]
    try:
        stream = YandexDiskClient(settings).stream_download(path)
        first = await anext(stream, b"")
    except RuntimeError as exc:
        raise APIError(str(exc), code="yandex_disk_not_configured", status_code=503) from exc
    except YandexDiskError as exc:
        logger.error("Yandex.Disk download failed (status %s) for file %s", exc.status_code, file_id)
        raise APIError("Не удалось загрузить файл. Попробуйте ещё раз позже.", code="storage_error", status_code=502) from exc

    async def proxy() -> AsyncIterator[bytes]:
        yield first
        try:
            async for chunk in stream:
                yield chunk
        except YandexDiskError as exc:
            logger.error("Yandex.Disk download interrupted (status %s) for file %s", exc.status_code, file_id)

    return StreamingResponse(
        proxy(),
        media_type="image/webp" if size == "thumb" and record["thumb_disk_path"] else record["mime_type"],
        headers={"Cache-Control": "private, no-store", "Content-Disposition": "inline"},
    )


async def _set_hidden(file_id: UUID, hide: bool, reason: str, ctx: AuthContext, conn: asyncpg.Connection) -> MediaDetailOut:
    before = await _detail(conn, file_id)
    try:
        async with conn.transaction():
            updated = await media_repo.set_hidden(conn, file_id, ctx.user["id"], hide, reason)
            if updated is None:
                raise NotFoundError("file not found")
            after = await _detail(conn, file_id)
            await admin_audit.record(
                conn, ctx.user["id"], "media_hide" if hide else "media_restore", target_type="media", target_id=file_id,
                reason=reason, before=_snapshot(before), after=_snapshot(after),
            )
    except media_repo.WrongState:
        raise ConflictError("Файл уже скрыт." if hide else "Файл не скрыт.", code="already_hidden" if hide else "not_hidden") from None
    return after


@router.post("/{file_id}/hide", response_model=MediaDetailOut)
async def hide_media(
    file_id: UUID, payload: ReasonIn, ctx: AuthContext = Depends(require_admin_mfa), conn: asyncpg.Connection = Depends(get_db)
) -> MediaDetailOut:
    return await _set_hidden(file_id, True, payload.reason, ctx, conn)


@router.post("/{file_id}/restore", response_model=MediaDetailOut)
async def restore_media(
    file_id: UUID, payload: ReasonIn, ctx: AuthContext = Depends(require_admin_mfa), conn: asyncpg.Connection = Depends(get_db)
) -> MediaDetailOut:
    return await _set_hidden(file_id, False, payload.reason, ctx, conn)


def _managed(path: str, settings: Settings) -> bool:
    """Only files under this application's own folder (<root>/<mode>/...) may ever be deleted from the disk."""
    root = f"{settings.yandex_disk_root_folder.rstrip('/')}/{settings.app_mode}/"
    return path.startswith(root) and ".." not in path.split("/")


@router.post("/{file_id}/delete", response_model=MediaDeletedOut)
async def delete_media(
    file_id: UUID,
    payload: ConfirmedReasonIn,
    ctx: AuthContext = Depends(require_admin_recent_mfa),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> MediaDeletedOut:
    """Irreversible. Order matters so a failure never leaves a broken page behind: first the database (the file stops
    being shown anywhere, together with the audit entry, in one transaction), then the bytes on the disk, and only if
    that worked the last record. If the disk cannot be reached the file is already gone from the site and the
    background clean-up finishes the job."""
    before = await _detail(conn, file_id)
    record = await media_repo.get_storage_record(conn, file_id)
    if record is None:
        raise NotFoundError("file not found")
    paths = [p for p in (record["disk_path"], record["thumb_disk_path"]) if p]
    if not all(_managed(p, settings) for p in paths):
        await admin_audit.record(
            conn, ctx.user["id"], "media_delete", target_type="media", target_id=file_id, reason=payload.reason,
            before=_snapshot(before), result="denied", extra={"why": "outside the application's storage folder"},
        )
        raise ConflictError("Файл лежит вне папки приложения — удалять его отсюда нельзя.", code="unmanaged_path")
    try:
        async with conn.transaction():
            if await media_repo.detach_and_remove(conn, file_id, settings.soft_delete_retention_days) is None:
                raise NotFoundError("file not found")
            await admin_audit.record(
                conn, ctx.user["id"], "media_delete", target_type="media", target_id=file_id, reason=payload.reason,
                before=_snapshot(before), after={"deleted": True},
            )
    except media_repo.Shared:
        await admin_audit.record(
            conn, ctx.user["id"], "media_delete", target_type="media", target_id=file_id, reason=payload.reason,
            before=_snapshot(before), result="denied", extra={"why": "file is shared"},
        )
        raise ConflictError(
            "Этот файл используется несколькими объектами или совпадает с другим файлом — удалить его нельзя. Скройте его.",
            code="file_shared",
        ) from None

    storage_deleted = False
    try:
        client = YandexDiskClient(settings)
        for path in paths:
            await client.delete(path)
        await files_repo.hard_delete(conn, file_id)
        storage_deleted = True
    except (RuntimeError, YandexDiskError, asyncpg.PostgresError):
        logger.warning("Could not remove the bytes of deleted file %s now; the background clean-up will retry", file_id)
    await admin_audit.record(
        conn, ctx.user["id"], "media_storage_cleanup", target_type="media", target_id=file_id,
        result="success" if storage_deleted else "failed",
    )
    return MediaDeletedOut(deleted=True, storage_deleted=storage_deleted)
