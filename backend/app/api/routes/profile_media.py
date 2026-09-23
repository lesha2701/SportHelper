from __future__ import annotations

import logging
from uuid import UUID, uuid4

import asyncpg
from fastapi import APIRouter, Depends, Form, UploadFile

from app.api.deps import get_current_user, get_db, get_settings_dep
from app.config import Settings
from app.core.exceptions import APIError, NotFoundError
from app.integrations.paths import build_user_file_path
from app.integrations.yandex_disk import YandexDiskError
from app.repositories import profile_media as profile_media_repo
from app.repositories import files as files_repo
from app.schemas.profile_media import ProfileMediaOut
from app.services.uploads import (
    IMAGE_MIME_EXTENSIONS,
    VIDEO_MIME_EXTENSIONS,
    FileTooLarge,
    VideoProbeError,
    VideoTooLong,
    upload_to_disk,
    upload_video_to_disk,
)

logger = logging.getLogger("teamflow.profile_media")

router = APIRouter(prefix="/api/profile/media", tags=["profile_media"])


async def _upload_media(
    user: dict,
    conn: asyncpg.Connection,
    settings: Settings,
    file: UploadFile,
    caption: str | None,
    *,
    media_type: str,
    allowed_types: dict[str, str],
    max_size_mb: int,
) -> ProfileMediaOut:
    if file.content_type not in allowed_types:
        kind = "image" if media_type == "photo" else "video"
        raise APIError(
            f"file must be a {kind} ({', '.join(allowed_types)})", code="unsupported_media_type", status_code=415
        )

    max_bytes = max_size_mb * 1024 * 1024
    chunk_size = settings.upload_chunk_size_kb * 1024
    file_id = uuid4()
    extension = allowed_types[file.content_type]
    disk_path = build_user_file_path(
        settings.yandex_disk_root_folder, settings.app_mode, user["id"], f"achievements/{media_type}", file_id, extension
    )

    try:
        if media_type == "video":
            size_bytes = await upload_video_to_disk(
                settings, disk_path, file, max_bytes, chunk_size, settings.max_video_duration_seconds
            )
        else:
            size_bytes = await upload_to_disk(settings, disk_path, file, max_bytes, chunk_size)
    except RuntimeError as exc:
        raise APIError(str(exc), code="yandex_disk_not_configured", status_code=503) from exc
    except FileTooLarge as exc:
        raise APIError(f"file must be smaller than {max_size_mb} MB", code="file_too_large", status_code=413) from exc
    except VideoTooLong as exc:
        raise APIError(
            f"video must be under {settings.max_video_duration_seconds} seconds (got {exc.duration_seconds:.0f}s)",
            code="video_too_long",
            status_code=413,
        ) from exc
    except VideoProbeError as exc:
        raise APIError(f"could not read this video file: {exc}", code="invalid_video", status_code=415) from exc
    except YandexDiskError as exc:
        logger.error("Yandex.Disk upload failed: %s", exc)
        raise APIError("failed to store the file", code="storage_error", status_code=502) from exc

    file_record = await files_repo.create_file(
        conn,
        owner_id=user["id"],
        team_id=None,
        entity_type=f"profile_media_{media_type}",
        entity_id=None,
        disk_path=disk_path,
        filename=file.filename or f"{file_id}.{extension}",
        mime_type=file.content_type,
        size_bytes=size_bytes,
        # PUBLIC: achievements are meant to be shown off, same as a coach
        # listing's photo/video.
        access_level="PUBLIC",
    )
    media = await profile_media_repo.add_media(
        conn, user_id=user["id"], file_id=file_record["id"], media_type=media_type, caption=caption
    )
    return ProfileMediaOut(**media)


@router.post("/photo", response_model=ProfileMediaOut)
async def upload_profile_photo(
    file: UploadFile,
    caption: str | None = Form(default=None),
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> ProfileMediaOut:
    return await _upload_media(
        user, conn, settings, file, caption,
        media_type="photo", allowed_types=IMAGE_MIME_EXTENSIONS, max_size_mb=settings.max_image_size_mb,
    )


@router.post("/video", response_model=ProfileMediaOut)
async def upload_profile_video(
    file: UploadFile,
    caption: str | None = Form(default=None),
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> ProfileMediaOut:
    return await _upload_media(
        user, conn, settings, file, caption,
        media_type="video", allowed_types=VIDEO_MIME_EXTENSIONS, max_size_mb=settings.max_video_size_mb,
    )


@router.get("/{user_id}", response_model=list[ProfileMediaOut])
async def list_profile_media(
    user_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[ProfileMediaOut]:
    """Any authenticated user may view another user's achievement gallery —
    it exists to be shown off (teammates, coach marketplace visitors, etc.),
    same spirit as a coach listing's PUBLIC photo/video."""
    media = await profile_media_repo.list_media(conn, user_id)
    return [ProfileMediaOut(**m) for m in media]


@router.delete("/{media_id}", status_code=204, response_model=None)
async def delete_profile_media(
    media_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    deleted = await profile_media_repo.delete_media(conn, media_id, user["id"])
    if deleted is None:
        raise NotFoundError("media not found")
