from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from uuid import UUID, uuid4

import asyncpg
from fastapi import APIRouter, Depends, UploadFile
from fastapi.responses import StreamingResponse

from app.api.deps import get_current_user, get_db, get_settings_dep
from app.config import Settings
from app.core.exceptions import APIError, ForbiddenError, NotFoundError
from app.integrations.paths import build_team_file_path
from app.integrations.yandex_disk import YandexDiskClient, YandexDiskError
from app.api.routes.teams import _team_out
from app.repositories import exercises as exercises_repo
from app.repositories import files as files_repo
from app.repositories import teams as teams_repo
from app.schemas.team import TeamOut
from app.services.uploads import IMAGE_MIME_EXTENSIONS, FileTooLarge, upload_to_disk

_EXERCISE_MEDIA_ENTITY_TYPES = ("exercise_photo", "exercise_video")

logger = logging.getLogger("teamflow.files")

team_files_router = APIRouter(prefix="/api/teams", tags=["files"])
files_router = APIRouter(prefix="/api/files", tags=["files"])

_ALLOWED_IMAGE_TYPES = IMAGE_MIME_EXTENSIONS


@team_files_router.post("/{team_id}/logo", response_model=TeamOut)
async def upload_team_logo(
    team_id: UUID,
    file: UploadFile,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> TeamOut:
    team = await teams_repo.get_team(conn, team_id)
    if team is None:
        raise NotFoundError("team not found")
    member = await teams_repo.get_member(conn, team_id, user["id"])
    if member is None or member["role"] not in ("head_coach", "assistant_coach"):
        raise ForbiddenError("only the head coach or an assistant coach can change the team logo")

    if file.content_type not in _ALLOWED_IMAGE_TYPES:
        raise APIError(
            "logo must be an image (jpeg, png, webp or gif)", code="unsupported_media_type", status_code=415
        )

    max_bytes = settings.max_image_size_mb * 1024 * 1024
    chunk_size = settings.upload_chunk_size_kb * 1024
    file_id = uuid4()
    extension = _ALLOWED_IMAGE_TYPES[file.content_type]
    disk_path = build_team_file_path(settings.yandex_disk_root_folder, settings.app_mode, team_id, "logo", file_id, extension)

    try:
        size_bytes = await upload_to_disk(settings, disk_path, file, max_bytes, chunk_size)
    except RuntimeError as exc:
        raise APIError(str(exc), code="yandex_disk_not_configured", status_code=503) from exc
    except FileTooLarge as exc:
        raise APIError(
            f"logo must be smaller than {settings.max_image_size_mb} MB", code="file_too_large", status_code=413
        ) from exc
    except YandexDiskError as exc:
        logger.error("Yandex.Disk upload failed: %s", exc)
        raise APIError("failed to store the file", code="storage_error", status_code=502) from exc

    file_record = await files_repo.create_file(
        conn,
        owner_id=user["id"],
        team_id=team_id,
        entity_type="team_logo",
        entity_id=team_id,
        disk_path=disk_path,
        filename=file.filename or f"{file_id}.{extension}",
        mime_type=file.content_type,
        size_bytes=size_bytes,
        access_level="TEAM",
    )
    await files_repo.replace_team_logo(conn, team_id, file_record["id"])

    updated_team = await teams_repo.get_team(conn, team_id)
    members_count = await teams_repo.count_members(conn, team_id)
    return _team_out(updated_team, my_role=member["role"], members_count=members_count)


@files_router.get("/{file_id}")
async def download_file(
    file_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> StreamingResponse:
    file_record = await files_repo.get_file(conn, file_id)
    if file_record is None:
        raise NotFoundError("file not found")

    access_level = file_record["access_level"]
    if access_level == "PRIVATE":
        if file_record["owner_id"] != user["id"]:
            # Exercise photos/videos are PRIVATE by default (an exercise can
            # be shared with several teams, so it has no single team_id to
            # key a TEAM-level file on) — fall back to checking whether the
            # exercise is currently shared with a team the requester belongs to.
            visible = False
            if file_record["entity_type"] in _EXERCISE_MEDIA_ENTITY_TYPES:
                shared_team_ids = await exercises_repo.list_shared_team_ids(conn, file_record["entity_id"])
                for team_id in shared_team_ids:
                    if await teams_repo.get_member(conn, team_id, user["id"]) is not None:
                        visible = True
                        break
            if not visible:
                raise ForbiddenError("you do not have access to this file")
    elif access_level in ("TEAM", "COACHES_ONLY"):
        member = None
        if file_record["team_id"] is not None:
            member = await teams_repo.get_member(conn, file_record["team_id"], user["id"])
        if member is None:
            raise ForbiddenError("you do not have access to this file")
        if access_level == "COACHES_ONLY" and member["role"] not in ("head_coach", "assistant_coach"):
            raise ForbiddenError("you do not have access to this file")

    try:
        client = YandexDiskClient(settings)
        stream = client.stream_download(file_record["disk_path"])
    except RuntimeError as exc:
        raise APIError(str(exc), code="yandex_disk_not_configured", status_code=503) from exc

    async def proxy() -> AsyncIterator[bytes]:
        try:
            async for chunk in stream:
                yield chunk
        except YandexDiskError as exc:
            logger.error("Yandex.Disk download failed: %s", exc)

    return StreamingResponse(
        proxy(),
        media_type=file_record["mime_type"],
        headers={"Content-Disposition": f'inline; filename="{file_record["filename"]}"'},
    )
