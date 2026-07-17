from __future__ import annotations

import logging
from uuid import UUID, uuid4

import asyncpg
from fastapi import APIRouter, Depends, UploadFile

from app.api.deps import get_current_user, get_db, get_settings_dep
from app.config import Settings
from app.core.exceptions import APIError, ForbiddenError, NotFoundError
from app.integrations.paths import build_user_file_path
from app.integrations.yandex_disk import YandexDiskError
from app.repositories import exercises as exercises_repo
from app.repositories import files as files_repo
from app.repositories import profiles as profiles_repo
from app.repositories import teams as teams_repo
from app.schemas.exercise import ExerciseIn, ExerciseOut, ShareExerciseIn
from app.services.uploads import IMAGE_MIME_EXTENSIONS, VIDEO_MIME_EXTENSIONS, FileTooLarge, upload_to_disk

logger = logging.getLogger("teamflow.exercises")

router = APIRouter(prefix="/api/exercises", tags=["exercises"])
team_exercises_router = APIRouter(prefix="/api/teams", tags=["exercises"])

_COACH_STAFF = {"head_coach", "assistant_coach"}


async def _exercise_out(conn: asyncpg.Connection, exercise: dict) -> ExerciseOut:
    shared_team_ids = await exercises_repo.list_shared_team_ids(conn, exercise["id"])
    return ExerciseOut(**exercise, shared_team_ids=shared_team_ids)


async def _exercises_out(conn: asyncpg.Connection, exercises: list[dict]) -> list[ExerciseOut]:
    """Batched form of _exercise_out for list endpoints — one query for all
    exercises' shared_team_ids instead of one query per exercise."""
    shared_by_id = await exercises_repo.list_shared_team_ids_batch(conn, [e["id"] for e in exercises])
    return [ExerciseOut(**exercise, shared_team_ids=shared_by_id.get(exercise["id"], [])) for exercise in exercises]


async def _get_owned_exercise_or_404(conn: asyncpg.Connection, exercise_id: UUID, owner_id: UUID) -> dict:
    exercise = await exercises_repo.get_exercise(conn, exercise_id)
    if exercise is None or exercise["owner_id"] != owner_id:
        raise NotFoundError("exercise not found")
    return exercise


@router.post("", response_model=ExerciseOut)
async def create_exercise(
    payload: ExerciseIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> ExerciseOut:
    coach_profile = await profiles_repo.get_coach_profile(conn, user["id"])
    if coach_profile is None:
        raise APIError(
            "create a coach profile before creating exercises", code="coach_profile_required", status_code=409
        )
    exercise = await exercises_repo.create_exercise(conn, user["id"], **payload.model_dump())
    return await _exercise_out(conn, exercise)


@router.get("/mine", response_model=list[ExerciseOut])
async def list_my_exercises(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[ExerciseOut]:
    exercises = await exercises_repo.list_owned(conn, user["id"])
    return await _exercises_out(conn, exercises)


@router.get("/{exercise_id}", response_model=ExerciseOut)
async def get_exercise(
    exercise_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> ExerciseOut:
    exercise = await exercises_repo.get_exercise(conn, exercise_id)
    if exercise is None:
        raise NotFoundError("exercise not found")
    if exercise["owner_id"] != user["id"]:
        shared_team_ids = await exercises_repo.list_shared_team_ids(conn, exercise_id)
        visible = False
        for team_id in shared_team_ids:
            if await teams_repo.get_member(conn, team_id, user["id"]) is not None:
                visible = True
                break
        if not visible:
            raise ForbiddenError("you do not have access to this exercise")
    return await _exercise_out(conn, exercise)


@router.put("/{exercise_id}", response_model=ExerciseOut)
async def update_exercise(
    exercise_id: UUID,
    payload: ExerciseIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> ExerciseOut:
    await _get_owned_exercise_or_404(conn, exercise_id, user["id"])
    exercise = await exercises_repo.update_exercise(conn, exercise_id, user["id"], **payload.model_dump())
    if exercise is None:
        raise NotFoundError("exercise not found")
    return await _exercise_out(conn, exercise)


@router.delete("/{exercise_id}", status_code=204, response_model=None)
async def delete_exercise(
    exercise_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    deleted = await exercises_repo.soft_delete(conn, exercise_id, user["id"])
    if not deleted:
        raise NotFoundError("exercise not found")


@router.post("/{exercise_id}/share", response_model=ExerciseOut)
async def share_exercise(
    exercise_id: UUID,
    payload: ShareExerciseIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> ExerciseOut:
    exercise = await _get_owned_exercise_or_404(conn, exercise_id, user["id"])
    member = await teams_repo.get_member(conn, payload.team_id, user["id"])
    if member is None or member["role"] not in _COACH_STAFF:
        raise ForbiddenError("you must coach the team you are sharing an exercise with")
    await exercises_repo.share_with_team(conn, exercise_id, payload.team_id, user["id"])
    return await _exercise_out(conn, exercise)


@router.delete("/{exercise_id}/share/{team_id}", response_model=ExerciseOut)
async def unshare_exercise(
    exercise_id: UUID,
    team_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> ExerciseOut:
    exercise = await _get_owned_exercise_or_404(conn, exercise_id, user["id"])
    await exercises_repo.unshare_from_team(conn, exercise_id, team_id)
    return await _exercise_out(conn, exercise)


async def _upload_exercise_media(
    exercise_id: UUID,
    file: UploadFile,
    user: dict,
    conn: asyncpg.Connection,
    settings: Settings,
    *,
    category: str,
    allowed_types: dict[str, str],
    max_size_mb: int,
    db_field: str,
) -> ExerciseOut:
    exercise = await _get_owned_exercise_or_404(conn, exercise_id, user["id"])

    if file.content_type not in allowed_types:
        kind = "image" if category == "photo" else "video"
        raise APIError(f"file must be a {kind} ({', '.join(allowed_types)})", code="unsupported_media_type", status_code=415)

    max_bytes = max_size_mb * 1024 * 1024
    chunk_size = settings.upload_chunk_size_kb * 1024
    file_id = uuid4()
    extension = allowed_types[file.content_type]
    disk_path = build_user_file_path(
        settings.yandex_disk_root_folder, settings.app_mode, user["id"], f"exercises/{exercise_id}/{category}", file_id, extension
    )

    try:
        size_bytes = await upload_to_disk(settings, disk_path, file, max_bytes, chunk_size)
    except RuntimeError as exc:
        raise APIError(str(exc), code="yandex_disk_not_configured", status_code=503) from exc
    except FileTooLarge as exc:
        raise APIError(f"file must be smaller than {max_size_mb} MB", code="file_too_large", status_code=413) from exc
    except YandexDiskError as exc:
        logger.error("Yandex.Disk upload failed: %s", exc)
        raise APIError("failed to store the file", code="storage_error", status_code=502) from exc

    file_record = await files_repo.create_file(
        conn,
        owner_id=user["id"],
        team_id=None,
        entity_type=f"exercise_{category}",
        entity_id=exercise_id,
        disk_path=disk_path,
        filename=file.filename or f"{file_id}.{extension}",
        mime_type=file.content_type,
        size_bytes=size_bytes,
        access_level="PRIVATE",
    )
    updated = await exercises_repo.update_exercise(conn, exercise_id, user["id"], **{db_field: file_record["id"]})
    assert updated is not None
    return await _exercise_out(conn, updated)


@router.post("/{exercise_id}/photo", response_model=ExerciseOut)
async def upload_exercise_photo(
    exercise_id: UUID,
    file: UploadFile,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> ExerciseOut:
    return await _upload_exercise_media(
        exercise_id,
        file,
        user,
        conn,
        settings,
        category="photo",
        allowed_types=IMAGE_MIME_EXTENSIONS,
        max_size_mb=settings.max_image_size_mb,
        db_field="photo_file_id",
    )


@router.post("/{exercise_id}/video", response_model=ExerciseOut)
async def upload_exercise_video(
    exercise_id: UUID,
    file: UploadFile,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> ExerciseOut:
    return await _upload_exercise_media(
        exercise_id,
        file,
        user,
        conn,
        settings,
        category="video",
        allowed_types=VIDEO_MIME_EXTENSIONS,
        max_size_mb=settings.max_video_size_mb,
        db_field="video_file_id",
    )


@team_exercises_router.get("/{team_id}/exercises", response_model=list[ExerciseOut])
async def list_team_exercises(
    team_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[ExerciseOut]:
    member = await teams_repo.get_member(conn, team_id, user["id"])
    if member is None:
        raise ForbiddenError("you are not a member of this team")
    exercises = await exercises_repo.list_shared_with_team(conn, team_id)
    return await _exercises_out(conn, exercises)
