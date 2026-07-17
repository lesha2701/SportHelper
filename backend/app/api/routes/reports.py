from __future__ import annotations

import logging
from uuid import UUID, uuid4

import asyncpg
from fastapi import APIRouter, Depends, UploadFile

from app.api.deps import get_current_user, get_db, get_settings_dep
from app.config import Settings
from app.core.exceptions import APIError, ForbiddenError, NotFoundError
from app.integrations.paths import build_team_file_path
from app.integrations.yandex_disk import YandexDiskError
from app.repositories import files as files_repo
from app.repositories import reports as reports_repo
from app.repositories import teams as teams_repo
from app.repositories import trainings as trainings_repo
from app.schemas.report import ReportOut, ReportReviewIn, ReportSubmitIn
from app.services.uploads import IMAGE_MIME_EXTENSIONS, VIDEO_MIME_EXTENSIONS, FileTooLarge, upload_to_disk

logger = logging.getLogger("teamflow.reports")

router = APIRouter(prefix="/api/trainings", tags=["reports"])

_COACH_STAFF = {"head_coach", "assistant_coach"}


async def _get_independent_training_or_404(conn: asyncpg.Connection, training_id: UUID) -> dict:
    training = await trainings_repo.get_training(conn, training_id)
    if training is None or training["type"] != "independent":
        raise NotFoundError("independent training not found")
    return training


def _require_responsible(training: dict, user_id: UUID) -> None:
    if training["responsible_user_id"] != user_id:
        raise ForbiddenError("only the responsible player can manage this report")


@router.post("/{training_id}/report", response_model=ReportOut)
async def submit_report(
    training_id: UUID,
    payload: ReportSubmitIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> ReportOut:
    training = await _get_independent_training_or_404(conn, training_id)
    _require_responsible(training, user["id"])
    report = await reports_repo.upsert_report(conn, training_id, user["id"], payload.text_report)
    return ReportOut(**report)


@router.get("/{training_id}/report", response_model=ReportOut)
async def get_report(
    training_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> ReportOut:
    training = await _get_independent_training_or_404(conn, training_id)
    member = await teams_repo.get_member(conn, training["team_id"], user["id"])
    if member is None:
        raise ForbiddenError("you do not have access to this report")
    report = await reports_repo.get_report(conn, training_id)
    if report is None:
        raise NotFoundError("no report has been submitted for this training yet")
    return ReportOut(**report)


@router.post("/{training_id}/report/review", response_model=ReportOut)
async def review_report(
    training_id: UUID,
    payload: ReportReviewIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> ReportOut:
    training = await _get_independent_training_or_404(conn, training_id)
    member = await teams_repo.get_member(conn, training["team_id"], user["id"])
    if member is None or member["role"] not in _COACH_STAFF:
        raise ForbiddenError("only the head coach or an assistant coach can review reports")
    report = await reports_repo.review_report(conn, training_id, user["id"], payload.decision, payload.coach_comment)
    if report is None:
        raise NotFoundError("no report has been submitted for this training yet")
    return ReportOut(**report)


async def _upload_report_media(
    training_id: UUID,
    file: UploadFile,
    user: dict,
    conn: asyncpg.Connection,
    settings: Settings,
    *,
    category: str,
    allowed_types: dict[str, str],
    max_size_mb: int,
    set_field,
) -> ReportOut:
    training = await _get_independent_training_or_404(conn, training_id)
    _require_responsible(training, user["id"])

    report = await reports_repo.get_report(conn, training_id)
    if report is None:
        raise APIError(
            "submit the text report before attaching photo or video", code="report_required", status_code=409
        )

    if file.content_type not in allowed_types:
        kind = "image" if category == "photo" else "video"
        raise APIError(f"file must be a {kind} ({', '.join(allowed_types)})", code="unsupported_media_type", status_code=415)

    max_bytes = max_size_mb * 1024 * 1024
    chunk_size = settings.upload_chunk_size_kb * 1024
    file_id = uuid4()
    extension = allowed_types[file.content_type]
    disk_path = build_team_file_path(
        settings.yandex_disk_root_folder, settings.app_mode, training["team_id"], f"trainings/{training_id}/report", file_id, extension
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
        team_id=training["team_id"],
        entity_type=f"training_report_{category}",
        entity_id=training_id,
        disk_path=disk_path,
        filename=file.filename or f"{file_id}.{extension}",
        mime_type=file.content_type,
        size_bytes=size_bytes,
        access_level="TEAM",
    )
    updated = await set_field(conn, training_id, file_record["id"])
    assert updated is not None
    return ReportOut(**updated)


@router.post("/{training_id}/report/photo", response_model=ReportOut)
async def upload_report_photo(
    training_id: UUID,
    file: UploadFile,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> ReportOut:
    return await _upload_report_media(
        training_id,
        file,
        user,
        conn,
        settings,
        category="photo",
        allowed_types=IMAGE_MIME_EXTENSIONS,
        max_size_mb=settings.max_image_size_mb,
        set_field=reports_repo.set_photo,
    )


@router.post("/{training_id}/report/video", response_model=ReportOut)
async def upload_report_video(
    training_id: UUID,
    file: UploadFile,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> ReportOut:
    return await _upload_report_media(
        training_id,
        file,
        user,
        conn,
        settings,
        category="video",
        allowed_types=VIDEO_MIME_EXTENSIONS,
        max_size_mb=settings.max_video_size_mb,
        set_field=reports_repo.set_video,
    )
