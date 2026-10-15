from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from uuid import UUID, uuid4

import asyncpg
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, UploadFile
from fastapi.responses import StreamingResponse

from app.api.deps import get_current_user, get_db, get_optional_user, get_settings_dep
from app.config import Settings
from app.core.exceptions import APIError, ForbiddenError, NotFoundError, UnauthorizedError
from app.integrations.paths import build_team_file_path, build_user_file_path
from app.integrations.yandex_disk import YandexDiskClient, YandexDiskError
from app.api.routes.teams import _team_out
from app.repositories import exercises as exercises_repo
from app.repositories import files as files_repo
from app.repositories import teams as teams_repo
from app.repositories import users as users_repo
from app.schemas.team import TeamOut
from app.schemas.user import UserOut
from app.services.uploads import IMAGE_MIME_EXTENSIONS, discard_stored_image, safe_filename, store_image_or_raise

_EXERCISE_MEDIA_ENTITY_TYPES = ("exercise_photo", "exercise_video")

logger = logging.getLogger("teamflow.files")

team_files_router = APIRouter(prefix="/api/teams", tags=["files"])
user_files_router = APIRouter(prefix="/api/users", tags=["files"])
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

    file_id = uuid4()
    stored = await store_image_or_raise(
        settings, file, "team_logo",
        lambda extension: build_team_file_path(settings.yandex_disk_root_folder, settings.app_mode, team_id, "logo", file_id, extension),
    )

    try:
        file_record = await files_repo.create_file(
            conn,
            owner_id=user["id"],
            team_id=team_id,
            entity_type="team_logo",
            entity_id=team_id,
            disk_path=stored.disk_path,
            filename=safe_filename(file.filename, stored.extension, "logo"),
            mime_type=stored.mime_type,
            size_bytes=stored.size_bytes,
            access_level="TEAM",
        )
    except Exception:
        await discard_stored_image(settings, stored)
        raise
    await files_repo.replace_team_logo(conn, team_id, file_record["id"])

    updated_team = await teams_repo.get_team(conn, team_id)
    members_count = await teams_repo.count_members(conn, team_id)
    return _team_out(updated_team, my_role=member["role"], members_count=members_count)


@user_files_router.post("/me/avatar", response_model=UserOut)
async def upload_user_avatar(
    file: UploadFile,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> UserOut:
    if file.content_type not in _ALLOWED_IMAGE_TYPES:
        raise APIError(
            "avatar must be an image (jpeg, png, webp or gif)", code="unsupported_media_type", status_code=415
        )

    file_id = uuid4()
    stored = await store_image_or_raise(
        settings, file, "avatar",
        lambda extension: build_user_file_path(settings.yandex_disk_root_folder, settings.app_mode, user["id"], "avatar", file_id, extension),
    )

    try:
        file_record = await files_repo.create_file(
            conn,
            owner_id=user["id"],
            team_id=None,
            entity_type="user_avatar",
            entity_id=user["id"],
            disk_path=stored.disk_path,
            filename=safe_filename(file.filename, stored.extension, "avatar"),
            mime_type=stored.mime_type,
            size_bytes=stored.size_bytes,
            # PUBLIC: an avatar is meant to be seen anywhere the user's name
            # shows up (teammates, coach marketplace, bookings), not gated to
            # one team the way a team logo is.
            access_level="PUBLIC",
        )
    except Exception:
        await discard_stored_image(settings, stored)
        raise
    await files_repo.replace_user_avatar(conn, user["id"], file_record["id"])

    updated_user = await users_repo.get_by_id(conn, user["id"])
    assert updated_user is not None
    return UserOut(**updated_user)


@user_files_router.delete("/me/avatar", response_model=UserOut)
async def remove_user_avatar(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> UserOut:
    await files_repo.remove_user_avatar(conn, user["id"])
    updated_user = await users_repo.get_by_id(conn, user["id"])
    assert updated_user is not None
    return UserOut(**updated_user)


@files_router.get("/{file_id}")
async def download_file(
    file_id: UUID,
    size: str | None = Query(default=None, pattern="^thumb$"),
    user: dict | None = Depends(get_optional_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> StreamingResponse:
    file_record = await files_repo.get_file(conn, file_id)
    if file_record is None or file_record.get("hidden_at") is not None:
        # A file hidden by moderation is gone as far as the platform is concerned (moderators view it through the admin API).
        raise NotFoundError("file not found")

    access_level = file_record["access_level"]
    if user is None and access_level != "PUBLIC":
        # Only files explicitly marked PUBLIC (avatars, coach-listing media)
        # are visible to guests; everything else needs a signed-in user.
        raise UnauthorizedError("authentication required")
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
    elif access_level == "PUBLIC":
        pass  # anyone, signed in or not, may view a public avatar / coach-listing photo or video
    else:
        raise ForbiddenError("you do not have access to this file")

    # `?size=thumb` serves the small copy for lists and cards when the file has one; every other file
    # (all those uploaded before thumbnails existed, small pictures, videos) answers with itself.
    thumb_path = file_record.get("thumb_disk_path") if size == "thumb" else None
    disk_path = thumb_path or file_record["disk_path"]
    mime_type = "image/webp" if thumb_path else file_record["mime_type"]

    try:
        client = YandexDiskClient(settings)
        stream = client.stream_download(disk_path)
    except RuntimeError as exc:
        raise APIError(str(exc), code="yandex_disk_not_configured", status_code=503) from exc

    # Read the first chunk BEFORE answering: if Yandex.Disk cannot serve the file, the browser must get an
    # error status (and the cause lands in the log), not a "200 OK" with an empty body that shows up as a
    # broken picture.
    try:
        first_chunk = await anext(stream, b"")
    except YandexDiskError as exc:
        logger.error("Yandex.Disk download failed (status %s) for file %s: %s", exc.status_code, file_id, str(exc)[:300])
        raise APIError("Не удалось загрузить файл. Попробуйте ещё раз позже.", code="storage_error", status_code=502) from exc

    async def proxy() -> AsyncIterator[bytes]:
        yield first_chunk
        try:
            async for chunk in stream:
                yield chunk
        except YandexDiskError as exc:  # too late to change the status; the body is cut short
            logger.error("Yandex.Disk download interrupted (status %s) for file %s: %s", exc.status_code, file_id, str(exc)[:300])

    return StreamingResponse(
        proxy(),
        media_type=mime_type,
        headers={
            "Content-Disposition": _content_disposition(file_record["filename"]),
            "Cache-Control": _cache_control(access_level),
        },
    )


def _cache_control(access_level: str) -> str:
    """A file id never changes what it points at (a replaced photo gets a new id), so browsers may keep
    the bytes. Public files may sit in shared caches; everything else stays in the viewer's own browser."""
    if access_level == "PUBLIC":
        return "public, max-age=86400"
    return "private, max-age=3600"


def _content_disposition(filename: str) -> str:
    """Old records can hold any user-chosen name (quotes, Cyrillic, ...): an ASCII fallback plus the RFC 6266
    UTF-8 form keeps the header valid whatever was stored."""
    ascii_name = "".join(c if 32 <= ord(c) < 127 and c not in '"\\' else "_" for c in filename) or "file"
    return f"inline; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename, safe='')}"
