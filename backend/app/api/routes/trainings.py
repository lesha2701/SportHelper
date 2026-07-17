from __future__ import annotations

from datetime import date, timedelta
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db
from app.core.exceptions import APIError, ForbiddenError, NotFoundError
from app.repositories import notifications as notifications_repo
from app.repositories import plans as plans_repo
from app.repositories import teams as teams_repo
from app.repositories import trainings as trainings_repo
from app.repositories import training_feedback as training_feedback_repo
from app.schemas.training import (
    AttendanceOut,
    AttendanceStatusIn,
    TrainingCreateIn,
    TrainingOut,
    TrainingUpdateIn,
)
from app.schemas.training_feedback import TrainingFeedbackIn, TrainingFeedbackOut
from app.services.notifications import schedule_new_training_notification, schedule_training_reminders

router = APIRouter(prefix="/api/trainings", tags=["trainings"])
team_trainings_router = APIRouter(prefix="/api/teams", tags=["trainings"])

_COACH_STAFF = {"head_coach", "assistant_coach"}


def _weekly_dates(start: date, until: date) -> list[date]:
    dates: list[date] = []
    current = start
    while current <= until:
        dates.append(current)
        current += timedelta(days=7)
    return dates


async def _validate_plan_ownership(conn: asyncpg.Connection, plan_id: UUID | None, user_id: UUID) -> None:
    if plan_id is None:
        return
    plan = await plans_repo.get_plan(conn, plan_id)
    if plan is None or plan["owner_id"] != user_id:
        raise NotFoundError("plan not found")


async def _resolve_responsible_user_id(
    conn: asyncpg.Connection, team_id: UUID, responsible_user_id: UUID | None
) -> UUID:
    """Independent trainings need exactly one responsible player: whoever the
    coach picked, or the team captain by default."""
    if responsible_user_id is not None:
        member = await teams_repo.get_member(conn, team_id, responsible_user_id)
        if member is None:
            raise NotFoundError("the chosen responsible player is not a member of this team")
        return responsible_user_id

    captain = await teams_repo.get_captain(conn, team_id)
    if captain is None:
        raise APIError(
            "this team has no captain yet — pick a responsible player explicitly",
            code="responsible_player_required",
            status_code=409,
        )
    return captain["user_id"]


async def _check_view_access(conn: asyncpg.Connection, training: dict, user_id: UUID) -> None:
    if training["type"] == "personal":
        if training["created_by"] != user_id:
            raise ForbiddenError("you do not have access to this training")
    else:
        member = await teams_repo.get_member(conn, training["team_id"], user_id)
        if member is None:
            raise ForbiddenError("you do not have access to this training")


async def _check_edit_access(conn: asyncpg.Connection, training: dict, user_id: UUID) -> None:
    if training["type"] == "personal":
        if training["created_by"] != user_id:
            raise ForbiddenError("you do not have access to this training")
    else:
        member = await teams_repo.get_member(conn, training["team_id"], user_id)
        if member is None or member["role"] not in _COACH_STAFF:
            raise ForbiddenError("only the head coach or an assistant coach can manage team trainings")


async def _get_training_or_404(conn: asyncpg.Connection, training_id: UUID) -> dict:
    training = await trainings_repo.get_training(conn, training_id)
    if training is None:
        raise NotFoundError("training not found")
    return training


@team_trainings_router.post("/{team_id}/trainings", response_model=list[TrainingOut])
async def create_team_training(
    team_id: UUID,
    payload: TrainingCreateIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[TrainingOut]:
    member = await teams_repo.get_member(conn, team_id, user["id"])
    if member is None or member["role"] not in _COACH_STAFF:
        raise ForbiddenError("only the head coach or an assistant coach can schedule team trainings")
    await _validate_plan_ownership(conn, payload.plan_id, user["id"])

    responsible_user_id = None
    if payload.is_independent:
        responsible_user_id = await _resolve_responsible_user_id(conn, team_id, payload.responsible_user_id)

    fields = dict(
        team_id=team_id,
        type="independent" if payload.is_independent else "team",
        plan_id=payload.plan_id,
        start_time=payload.start_time,
        duration_minutes=payload.duration_minutes,
        location=payload.location,
        description=payload.description,
        reminder_minutes_before=payload.reminder_minutes_before,
        responsible_user_id=responsible_user_id,
    )
    if payload.repeat_weekly_until:
        dates = _weekly_dates(payload.training_date, payload.repeat_weekly_until)
        trainings = await trainings_repo.create_recurring_series(conn, user["id"], dates, **fields)
    else:
        trainings = [
            await trainings_repo.create_training(conn, user["id"], training_date=payload.training_date, **fields)
        ]
    for training in trainings:
        await schedule_training_reminders(conn, training)
    # One "new training" ping per series, not per occurrence — a
    # months-long weekly series would otherwise flood recipients with one
    # notification per generated row.
    await schedule_new_training_notification(conn, trainings[0])
    return [TrainingOut(**t) for t in trainings]


@router.post("/personal", response_model=list[TrainingOut])
async def create_personal_training(
    payload: TrainingCreateIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[TrainingOut]:
    await _validate_plan_ownership(conn, payload.plan_id, user["id"])

    fields = dict(
        team_id=None,
        type="personal",
        plan_id=payload.plan_id,
        start_time=payload.start_time,
        duration_minutes=payload.duration_minutes,
        location=payload.location,
        description=payload.description,
        reminder_minutes_before=payload.reminder_minutes_before,
        responsible_user_id=None,
    )
    if payload.repeat_weekly_until:
        dates = _weekly_dates(payload.training_date, payload.repeat_weekly_until)
        trainings = await trainings_repo.create_recurring_series(conn, user["id"], dates, **fields)
    else:
        trainings = [
            await trainings_repo.create_training(conn, user["id"], training_date=payload.training_date, **fields)
        ]
    for training in trainings:
        await schedule_training_reminders(conn, training)
    return [TrainingOut(**t) for t in trainings]


@team_trainings_router.get("/{team_id}/trainings", response_model=list[TrainingOut])
async def list_team_trainings(
    team_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[TrainingOut]:
    member = await teams_repo.get_member(conn, team_id, user["id"])
    if member is None:
        raise ForbiddenError("you are not a member of this team")
    trainings = await trainings_repo.list_team_trainings(conn, team_id)
    return [TrainingOut(**t) for t in trainings]


@router.get("/mine", response_model=list[TrainingOut])
async def list_my_personal_trainings(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[TrainingOut]:
    trainings = await trainings_repo.list_personal_trainings(conn, user["id"])
    return [TrainingOut(**t) for t in trainings]


@router.get("/{training_id}", response_model=TrainingOut)
async def get_training(
    training_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> TrainingOut:
    training = await _get_training_or_404(conn, training_id)
    await _check_view_access(conn, training, user["id"])
    return TrainingOut(**training)


@router.put("/{training_id}", response_model=TrainingOut)
async def update_training(
    training_id: UUID,
    payload: TrainingUpdateIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> TrainingOut:
    training = await _get_training_or_404(conn, training_id)
    await _check_edit_access(conn, training, user["id"])
    await _validate_plan_ownership(conn, payload.plan_id, user["id"])

    if training["type"] == "personal":
        if payload.is_independent:
            raise APIError("a personal training cannot be independent", code="invalid_training_type", status_code=400)
        new_type = "personal"
        responsible_user_id = None
    elif payload.is_independent:
        new_type = "independent"
        responsible_user_id = await _resolve_responsible_user_id(conn, training["team_id"], payload.responsible_user_id)
    else:
        new_type = "team"
        responsible_user_id = None

    updated = await trainings_repo.update_training(
        conn,
        training_id,
        training_date=payload.training_date,
        start_time=payload.start_time,
        duration_minutes=payload.duration_minutes,
        location=payload.location,
        description=payload.description,
        plan_id=payload.plan_id,
        reminder_minutes_before=payload.reminder_minutes_before,
        status=payload.status,
        type=new_type,
        responsible_user_id=responsible_user_id,
    )
    if updated is None:
        raise NotFoundError("training not found")
    await schedule_training_reminders(conn, updated)
    return TrainingOut(**updated)


@router.delete("/{training_id}", status_code=204, response_model=None)
async def delete_training(
    training_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    training = await _get_training_or_404(conn, training_id)
    await _check_edit_access(conn, training, user["id"])
    await trainings_repo.soft_delete(conn, training_id)
    await notifications_repo.cancel_pending_for_entity(conn, "training", training_id)


@router.post("/{training_id}/cancel-series", status_code=204, response_model=None)
async def cancel_training_series(
    training_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    training = await _get_training_or_404(conn, training_id)
    await _check_edit_access(conn, training, user["id"])
    if training["recurrence_group_id"] is None:
        raise NotFoundError("this training is not part of a recurring series")
    series = await trainings_repo.list_recurrence_group(conn, training["recurrence_group_id"])
    await trainings_repo.cancel_series(conn, training["recurrence_group_id"])
    for series_training in series:
        await notifications_repo.cancel_pending_for_entity(conn, "training", series_training["id"])


def _can_mark_attendance(training: dict, member: dict | None, user_id: UUID) -> bool:
    if member is not None and member["role"] in _COACH_STAFF:
        return True
    return training["type"] == "independent" and training["responsible_user_id"] == user_id


@router.get("/{training_id}/attendance", response_model=list[AttendanceOut])
async def get_attendance(
    training_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[AttendanceOut]:
    training = await _get_training_or_404(conn, training_id)
    if training["type"] not in ("team", "independent"):
        raise NotFoundError("training not found")
    member = await teams_repo.get_member(conn, training["team_id"], user["id"])
    if member is None:
        raise ForbiddenError("you do not have access to this training")
    await trainings_repo.ensure_attendance_initialized(conn, training_id, training["team_id"])
    rows = await trainings_repo.list_attendance(conn, training_id)
    return [AttendanceOut(**row) for row in rows]


@router.patch("/{training_id}/attendance/{target_user_id}", response_model=AttendanceOut)
async def set_attendance(
    training_id: UUID,
    target_user_id: UUID,
    payload: AttendanceStatusIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> AttendanceOut:
    training = await _get_training_or_404(conn, training_id)
    if training["type"] not in ("team", "independent"):
        raise NotFoundError("training not found")
    member = await teams_repo.get_member(conn, training["team_id"], user["id"])
    if not _can_mark_attendance(training, member, user["id"]):
        raise ForbiddenError("only the head coach, an assistant coach, or the responsible player can mark attendance")

    target_member = await teams_repo.get_member(conn, training["team_id"], target_user_id)
    if target_member is None:
        raise NotFoundError("this user is not a member of the team")

    await trainings_repo.ensure_attendance_initialized(conn, training_id, training["team_id"])
    updated = await trainings_repo.set_attendance_status(conn, training_id, target_user_id, payload.status, user["id"])
    if updated is None:
        raise NotFoundError("attendance record not found")
    return AttendanceOut(**updated)


@router.get("/{training_id}/feedback", response_model=TrainingFeedbackOut | None)
async def get_training_feedback(
    training_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> TrainingFeedbackOut | None:
    training = await _get_training_or_404(conn, training_id)
    await _check_view_access(conn, training, user["id"])
    feedback = await training_feedback_repo.get_feedback(conn, training_id, user["id"])
    return TrainingFeedbackOut(**feedback) if feedback else None


@router.post("/{training_id}/feedback", response_model=TrainingFeedbackOut)
async def submit_training_feedback(
    training_id: UUID,
    payload: TrainingFeedbackIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> TrainingFeedbackOut:
    training = await _get_training_or_404(conn, training_id)
    await _check_view_access(conn, training, user["id"])
    if training["status"] != "completed":
        raise APIError(
            "feedback can only be left for a training marked completed", code="training_not_completed", status_code=409
        )
    feedback = await training_feedback_repo.upsert_feedback(
        conn, training_id, user["id"],
        wellbeing=payload.wellbeing, difficulty=payload.difficulty, comment=payload.comment,
    )
    return TrainingFeedbackOut(**feedback)


@router.post("/{training_id}/feedback/skip", response_model=TrainingFeedbackOut)
async def skip_training_feedback(
    training_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> TrainingFeedbackOut:
    training = await _get_training_or_404(conn, training_id)
    await _check_view_access(conn, training, user["id"])
    if training["status"] != "completed":
        raise APIError(
            "feedback can only be left for a training marked completed", code="training_not_completed", status_code=409
        )
    feedback = await training_feedback_repo.mark_skipped(conn, training_id, user["id"])
    return TrainingFeedbackOut(**feedback)
