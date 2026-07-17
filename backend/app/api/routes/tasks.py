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
from app.repositories import exercises as exercises_repo
from app.repositories import files as files_repo
from app.repositories import notifications as notifications_repo
from app.repositories import plans as plans_repo
from app.repositories import tasks as tasks_repo
from app.repositories import teams as teams_repo
from app.repositories import trainings as trainings_repo
from app.schemas.task import (
    MyTaskOut,
    TaskAssignmentOut,
    TaskCreateIn,
    TaskExerciseOut,
    TaskOut,
    TaskReviewIn,
    TaskSubmitIn,
    TaskUpdateIn,
)
from app.services.notifications import schedule_new_task_notification, schedule_task_deadline_reminders
from app.services.uploads import IMAGE_MIME_EXTENSIONS, VIDEO_MIME_EXTENSIONS, FileTooLarge, upload_to_disk

logger = logging.getLogger("teamflow.tasks")

router = APIRouter(prefix="/api/tasks", tags=["tasks"])
team_tasks_router = APIRouter(prefix="/api/teams", tags=["tasks"])

_COACH_STAFF = {"head_coach", "assistant_coach"}
# Only players and the captain receive tasks — coaches assign them, they
# don't do the homework.
_ASSIGNABLE_ROLES = {"captain", "player"}


async def _task_out(
    conn: asyncpg.Connection,
    task: dict,
    *,
    exercises: list[dict] | None = None,
    assignments: list[dict] | None = None,
) -> TaskOut:
    return TaskOut(
        **task,
        exercises=[TaskExerciseOut(**e) for e in (exercises or [])],
        assignments=[TaskAssignmentOut(**a) for a in (assignments or [])],
    )


async def _get_task_or_404(conn: asyncpg.Connection, task_id: UUID) -> dict:
    task = await tasks_repo.get_task(conn, task_id)
    if task is None:
        raise NotFoundError("task not found")
    return task


async def _check_manage_access(conn: asyncpg.Connection, task: dict, user_id: UUID) -> None:
    member = await teams_repo.get_member(conn, task["team_id"], user_id)
    if member is None or member["role"] not in _COACH_STAFF:
        raise ForbiddenError("only the head coach or an assistant coach can manage tasks")


async def _validate_plan_ownership(conn: asyncpg.Connection, plan_id: UUID | None, user_id: UUID) -> None:
    if plan_id is None:
        return
    plan = await plans_repo.get_plan(conn, plan_id)
    if plan is None or plan["owner_id"] != user_id:
        raise NotFoundError("plan not found")


async def _validate_exercise_ownership(conn: asyncpg.Connection, exercise_ids: list[UUID], user_id: UUID) -> None:
    for exercise_id in exercise_ids:
        exercise = await exercises_repo.get_exercise(conn, exercise_id)
        if exercise is None or exercise["owner_id"] != user_id:
            raise NotFoundError("exercise not found")


async def _resolve_targets(conn: asyncpg.Connection, team_id: UUID, payload: TaskCreateIn) -> list[UUID]:
    if payload.target_type == "team":
        members = await teams_repo.list_members(conn, team_id)
        return [m["user_id"] for m in members if m["role"] in _ASSIGNABLE_ROLES]

    if payload.target_type == "players":
        if not payload.player_ids:
            raise APIError("select at least one player", code="players_required", status_code=400)
        user_ids: list[UUID] = []
        for user_id in payload.player_ids:
            member = await teams_repo.get_member(conn, team_id, user_id)
            if member is None:
                raise NotFoundError("one of the selected players is not a member of this team")
            user_ids.append(user_id)
        return user_ids

    if payload.target_type == "position":
        if not payload.position:
            raise APIError("position is required", code="position_required", status_code=400)
        members = await teams_repo.list_members(conn, team_id)
        return [
            m["user_id"] for m in members
            if m["role"] in _ASSIGNABLE_ROLES and m["position"] == payload.position
        ]

    if payload.target_type == "absentees":
        if payload.training_id is None:
            raise APIError("training_id is required", code="training_required", status_code=400)
        training = await trainings_repo.get_training(conn, payload.training_id)
        if training is None or training["team_id"] != team_id or training["type"] not in ("team", "independent"):
            raise NotFoundError("training not found")
        await trainings_repo.ensure_attendance_initialized(conn, training["id"], team_id)
        attendance = await trainings_repo.list_attendance(conn, training["id"])
        absent_ids = {a["user_id"] for a in attendance if a["status"] == "absent"}
        members = await teams_repo.list_members(conn, team_id)
        return [
            m["user_id"] for m in members
            if m["role"] in _ASSIGNABLE_ROLES and m["user_id"] in absent_ids
        ]

    raise APIError("invalid target_type", code="invalid_target_type", status_code=400)


@team_tasks_router.post("/{team_id}/tasks", response_model=TaskOut)
async def create_task(
    team_id: UUID,
    payload: TaskCreateIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> TaskOut:
    member = await teams_repo.get_member(conn, team_id, user["id"])
    if member is None or member["role"] not in _COACH_STAFF:
        raise ForbiddenError("only the head coach or an assistant coach can assign tasks")

    await _validate_plan_ownership(conn, payload.plan_id, user["id"])
    await _validate_exercise_ownership(conn, payload.exercise_ids, user["id"])
    user_ids = await _resolve_targets(conn, team_id, payload)
    if not user_ids:
        raise APIError("no players match the selected target", code="no_recipients", status_code=400)

    fields = payload.model_dump(exclude={"exercise_ids", "player_ids", "position", "target_type", "training_id"})
    fields["target_position"] = payload.position if payload.target_type == "position" else None
    fields["target_training_id"] = payload.training_id if payload.target_type == "absentees" else None

    task = await tasks_repo.create_task(conn, team_id, user["id"], target_type=payload.target_type, **fields)
    await tasks_repo.set_task_exercises(conn, task["id"], payload.exercise_ids)
    await tasks_repo.bulk_create_assignments(conn, task["id"], user_ids)

    exercises = await tasks_repo.list_task_exercises(conn, task["id"])
    assignments = await tasks_repo.list_assignments(conn, task["id"])
    await schedule_task_deadline_reminders(conn, task, [a["user_id"] for a in assignments], settings)
    await schedule_new_task_notification(conn, task, [a["user_id"] for a in assignments])
    return await _task_out(conn, task, exercises=exercises, assignments=assignments)


@team_tasks_router.get("/{team_id}/tasks", response_model=list[TaskOut])
async def list_team_tasks(
    team_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[TaskOut]:
    member = await teams_repo.get_member(conn, team_id, user["id"])
    if member is None:
        raise ForbiddenError("you are not a member of this team")

    is_coach = member["role"] in _COACH_STAFF
    tasks = await tasks_repo.list_team_tasks(conn, team_id)
    assignments_by_task = await tasks_repo.list_assignments_for_tasks(
        conn, [task["id"] for task in tasks], user_id=None if is_coach else user["id"]
    )
    result: list[TaskOut] = []
    for task in tasks:
        assignments = assignments_by_task.get(task["id"], [])
        if not is_coach and not assignments:
            continue
        result.append(await _task_out(conn, task, assignments=assignments))
    return result


@router.get("/mine", response_model=list[MyTaskOut])
async def list_my_tasks(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[MyTaskOut]:
    rows = await tasks_repo.list_my_assignments(conn, user["id"])
    return [MyTaskOut(**row) for row in rows]


@router.get("/{task_id}", response_model=TaskOut)
async def get_task(
    task_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> TaskOut:
    task = await _get_task_or_404(conn, task_id)
    member = await teams_repo.get_member(conn, task["team_id"], user["id"])
    if member is None:
        raise ForbiddenError("you do not have access to this task")

    exercises = await tasks_repo.list_task_exercises(conn, task_id)
    if member["role"] in _COACH_STAFF:
        assignments = await tasks_repo.list_assignments(conn, task_id)
    else:
        assignment = await tasks_repo.get_assignment(conn, task_id, user["id"])
        if assignment is None:
            raise ForbiddenError("you do not have access to this task")
        if assignment["status"] == "assigned":
            assignment = await tasks_repo.mark_viewed(conn, task_id, user["id"])
        assignments = [assignment]
    return await _task_out(conn, task, exercises=exercises, assignments=assignments)


@router.put("/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: UUID,
    payload: TaskUpdateIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> TaskOut:
    task = await _get_task_or_404(conn, task_id)
    await _check_manage_access(conn, task, user["id"])
    await _validate_plan_ownership(conn, payload.plan_id, user["id"])
    await _validate_exercise_ownership(conn, payload.exercise_ids, user["id"])

    fields = payload.model_dump(exclude={"exercise_ids"})
    updated = await tasks_repo.update_task(conn, task_id, **fields)
    if updated is None:
        raise NotFoundError("task not found")
    await tasks_repo.set_task_exercises(conn, task_id, payload.exercise_ids)

    exercises = await tasks_repo.list_task_exercises(conn, task_id)
    assignments = await tasks_repo.list_assignments(conn, task_id)
    await schedule_task_deadline_reminders(conn, updated, [a["user_id"] for a in assignments], settings)
    return await _task_out(conn, updated, exercises=exercises, assignments=assignments)


@router.delete("/{task_id}", status_code=204, response_model=None)
async def delete_task(
    task_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    task = await _get_task_or_404(conn, task_id)
    await _check_manage_access(conn, task, user["id"])
    await tasks_repo.cancel_open_assignments(conn, task_id)
    await tasks_repo.soft_delete(conn, task_id)
    await notifications_repo.cancel_pending_for_entity(conn, "task", task_id)


@router.post("/{task_id}/start", response_model=TaskAssignmentOut)
async def start_task(
    task_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> TaskAssignmentOut:
    await _get_task_or_404(conn, task_id)
    assignment = await tasks_repo.get_assignment(conn, task_id, user["id"])
    if assignment is None:
        raise ForbiddenError("this task is not assigned to you")
    updated = await tasks_repo.start_assignment(conn, task_id, user["id"])
    if updated is None:
        raise APIError("task cannot be started from its current status", code="invalid_status", status_code=409)
    return TaskAssignmentOut(**updated)


@router.post("/{task_id}/submit", response_model=TaskAssignmentOut)
async def submit_task(
    task_id: UUID,
    payload: TaskSubmitIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> TaskAssignmentOut:
    task = await _get_task_or_404(conn, task_id)
    assignment = await tasks_repo.get_assignment(conn, task_id, user["id"])
    if assignment is None:
        raise ForbiddenError("this task is not assigned to you")
    if assignment["status"] == "cancelled":
        raise APIError("this task has been cancelled", code="task_cancelled", status_code=409)

    missing = []
    if task["require_comment"] and not payload.comment:
        missing.append("comment")
    if task["require_photo"] and assignment["photo_file_id"] is None:
        missing.append("photo")
    if task["require_video"] and assignment["video_file_id"] is None:
        missing.append("video")
    if task["require_sets_reps"] and (payload.sets is None or payload.reps is None):
        missing.append("sets_reps")
    if task["require_duration"] and payload.duration_minutes is None:
        missing.append("duration")
    if task["require_metric_value"] and payload.metric_value is None:
        missing.append("metric_value")
    if task["require_difficulty"] and payload.difficulty is None:
        missing.append("difficulty")
    if task["require_wellbeing"] and payload.wellbeing is None:
        missing.append("wellbeing")
    if missing:
        raise APIError(
            f"missing required fields: {', '.join(missing)}", code="submission_incomplete", status_code=422
        )

    updated = await tasks_repo.submit_assignment(conn, task_id, user["id"], **payload.model_dump())
    assert updated is not None
    return TaskAssignmentOut(**updated)


async def _upload_assignment_media(
    task_id: UUID,
    file: UploadFile,
    user: dict,
    conn: asyncpg.Connection,
    settings: Settings,
    *,
    category: str,
    allowed_types: dict[str, str],
    max_size_mb: int,
    set_field,
) -> TaskAssignmentOut:
    task = await _get_task_or_404(conn, task_id)
    assignment = await tasks_repo.get_assignment(conn, task_id, user["id"])
    if assignment is None:
        raise ForbiddenError("this task is not assigned to you")
    if assignment["status"] == "cancelled":
        raise APIError("this task has been cancelled", code="task_cancelled", status_code=409)

    if file.content_type not in allowed_types:
        kind = "image" if category == "photo" else "video"
        raise APIError(f"file must be a {kind} ({', '.join(allowed_types)})", code="unsupported_media_type", status_code=415)

    max_bytes = max_size_mb * 1024 * 1024
    chunk_size = settings.upload_chunk_size_kb * 1024
    file_id = uuid4()
    extension = allowed_types[file.content_type]
    disk_path = build_team_file_path(
        settings.yandex_disk_root_folder,
        settings.app_mode,
        task["team_id"],
        f"tasks/{task_id}/assignments/{user['id']}",
        file_id,
        extension,
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
        team_id=task["team_id"],
        entity_type=f"task_{category}",
        entity_id=task_id,
        disk_path=disk_path,
        filename=file.filename or f"{file_id}.{extension}",
        mime_type=file.content_type,
        size_bytes=size_bytes,
        access_level="TEAM",
    )
    updated = await set_field(conn, task_id, user["id"], file_record["id"])
    assert updated is not None
    return TaskAssignmentOut(**updated)


@router.post("/{task_id}/submit/photo", response_model=TaskAssignmentOut)
async def upload_task_photo(
    task_id: UUID,
    file: UploadFile,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> TaskAssignmentOut:
    return await _upload_assignment_media(
        task_id,
        file,
        user,
        conn,
        settings,
        category="photo",
        allowed_types=IMAGE_MIME_EXTENSIONS,
        max_size_mb=settings.max_image_size_mb,
        set_field=tasks_repo.set_assignment_photo,
    )


@router.post("/{task_id}/submit/video", response_model=TaskAssignmentOut)
async def upload_task_video(
    task_id: UUID,
    file: UploadFile,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> TaskAssignmentOut:
    return await _upload_assignment_media(
        task_id,
        file,
        user,
        conn,
        settings,
        category="video",
        allowed_types=VIDEO_MIME_EXTENSIONS,
        max_size_mb=settings.max_video_size_mb,
        set_field=tasks_repo.set_assignment_video,
    )


@router.post("/{task_id}/review/{target_user_id}", response_model=TaskAssignmentOut)
async def review_task(
    task_id: UUID,
    target_user_id: UUID,
    payload: TaskReviewIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> TaskAssignmentOut:
    task = await _get_task_or_404(conn, task_id)
    await _check_manage_access(conn, task, user["id"])
    updated = await tasks_repo.review_assignment(
        conn, task_id, target_user_id, user["id"], payload.decision, payload.coach_comment
    )
    if updated is None:
        raise NotFoundError("this task is not assigned to that player")
    return TaskAssignmentOut(**updated)
