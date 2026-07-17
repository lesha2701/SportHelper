from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db, get_settings_dep
from app.config import Settings
from app.core.exceptions import APIError, ForbiddenError, NotFoundError
from app.repositories import profiles as profiles_repo
from app.repositories import reports as reports_repo
from app.repositories import teams as teams_repo
from app.repositories import trainings as trainings_repo
from app.repositories import training_feedback as training_feedback_repo
from app.schemas.ai import (
    AITextOut,
    PersonalTrainingDraftIn,
    PersonalTrainingDraftOut,
    TaskDraftIn,
    TaskDraftOut,
    TrainingEvaluationIn,
    TrainingPlanDraftIn,
    TrainingPlanDraftOut,
)
from app.services import ai as ai_service

router = APIRouter(prefix="/api/ai", tags=["ai"])
team_ai_router = APIRouter(prefix="/api/teams", tags=["ai"])

_COACH_STAFF = {"head_coach", "assistant_coach"}


async def _require_coach_profile(conn: asyncpg.Connection, user_id: UUID) -> dict:
    profile = await profiles_repo.get_coach_profile(conn, user_id)
    if profile is None:
        raise APIError(
            "create a coach profile before using AI coach tools", code="coach_profile_required", status_code=409
        )
    return profile


async def _require_player_profile(conn: asyncpg.Connection, user_id: UUID) -> dict:
    profile = await profiles_repo.get_player_profile(conn, user_id)
    if profile is None:
        raise APIError(
            "create a player profile before using AI player tools", code="player_profile_required", status_code=409
        )
    return profile


async def _require_coach_team(conn: asyncpg.Connection, team_id: UUID, user_id: UUID) -> dict:
    member = await teams_repo.get_member(conn, team_id, user_id)
    if member is None or member["role"] not in _COACH_STAFF:
        raise ForbiddenError("only the head coach or an assistant coach can use AI tools for this team")
    team = await teams_repo.get_team(conn, team_id)
    if team is None:
        raise NotFoundError("team not found")
    return team


@router.post("/training-plan-draft", response_model=TrainingPlanDraftOut)
async def training_plan_draft(
    payload: TrainingPlanDraftIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> TrainingPlanDraftOut:
    await _require_coach_profile(conn, user["id"])
    team = None
    if payload.team_id is not None:
        team = await _require_coach_team(conn, payload.team_id, user["id"])
    return await ai_service.build_training_plan_draft(
        conn, settings, coach_id=user["id"], team=team, payload=payload
    )


@router.post("/personal-training-draft", response_model=PersonalTrainingDraftOut)
async def personal_training_draft(
    payload: PersonalTrainingDraftIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> PersonalTrainingDraftOut:
    player_profile = await _require_player_profile(conn, user["id"])
    return await ai_service.build_personal_training_draft(
        conn, settings, player_profile=player_profile, payload=payload
    )


@router.post("/training-evaluation", response_model=AITextOut)
async def training_evaluation(
    payload: TrainingEvaluationIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> AITextOut:
    player_profile = await _require_player_profile(conn, user["id"])
    training = await trainings_repo.get_training(conn, payload.training_id)
    if training is None:
        raise NotFoundError("training not found")

    attendance_row: dict | None = None
    if training["type"] == "personal":
        if training["created_by"] != user["id"]:
            raise ForbiddenError("you do not have access to this training")
    else:
        member = await teams_repo.get_member(conn, training["team_id"], user["id"])
        if member is None:
            raise ForbiddenError("you do not have access to this training")
        attendance_row = await trainings_repo.get_attendance_for_user(conn, training["id"], user["id"])

    if training["status"] != "completed":
        raise APIError(
            "the AI can only evaluate a training that's been marked completed",
            code="training_not_completed",
            status_code=409,
        )

    report = None
    if training["type"] == "independent":
        report = await reports_repo.get_report(conn, training["id"])
    feedback = await training_feedback_repo.get_feedback(conn, training["id"], user["id"])

    text = await ai_service.build_training_evaluation(
        conn,
        settings,
        player_profile=player_profile,
        training=training,
        attendance_row=attendance_row,
        report=report,
        feedback=feedback,
    )
    return AITextOut(text=text)


@router.post("/progress-analysis", response_model=AITextOut)
async def progress_analysis(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> AITextOut:
    player_profile = await _require_player_profile(conn, user["id"])
    text = await ai_service.build_progress_analysis(conn, settings, player_profile=player_profile)
    return AITextOut(text=text)


@team_ai_router.post("/{team_id}/ai/task-draft", response_model=TaskDraftOut)
async def task_draft(
    team_id: UUID,
    payload: TaskDraftIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> TaskDraftOut:
    team = await _require_coach_team(conn, team_id, user["id"])
    return await ai_service.build_task_draft(conn, settings, team=team, payload=payload)


@team_ai_router.post("/{team_id}/ai/report-analysis", response_model=AITextOut)
async def report_analysis(
    team_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> AITextOut:
    team = await _require_coach_team(conn, team_id, user["id"])
    text = await ai_service.build_report_analysis(conn, settings, team=team)
    return AITextOut(text=text)


@team_ai_router.post("/{team_id}/ai/attendance-analysis", response_model=AITextOut)
async def attendance_analysis(
    team_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> AITextOut:
    team = await _require_coach_team(conn, team_id, user["id"])
    text = await ai_service.build_attendance_analysis(conn, settings, team=team)
    return AITextOut(text=text)


@team_ai_router.post("/{team_id}/ai/team-summary", response_model=AITextOut)
async def team_summary(
    team_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> AITextOut:
    team = await _require_coach_team(conn, team_id, user["id"])
    text = await ai_service.build_team_summary(conn, settings, team=team, coach_id=user["id"])
    return AITextOut(text=text)
