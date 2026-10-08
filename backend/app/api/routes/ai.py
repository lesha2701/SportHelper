from __future__ import annotations

import json
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db, get_settings_dep
from app.config import Settings
from app.core.exceptions import APIError, ForbiddenError, NotFoundError
from app.repositories import bookings as bookings_repo
from app.repositories import profiles as profiles_repo
from app.repositories import reports as reports_repo
from app.repositories import teams as teams_repo
from app.repositories import trainings as trainings_repo
from app.repositories import training_ai_analyses as analyses_repo
from app.repositories import training_feedback as training_feedback_repo
from app.repositories import users as users_repo
from app.schemas.ai import (
    AITextOut,
    PlayerAnalysisStatusOut,
    PlayerPreSessionAnalysisOut,
    PrivacySettingsIn,
    PrivacySettingsOut,
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
training_ai_router = APIRouter(prefix="/api/trainings", tags=["ai"])
privacy_router = APIRouter(prefix="/api/users/me", tags=["privacy"])

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


# --- Coach's AI pre-session analysis of the athlete ---------------------------


async def _require_personal_session_coach(
    conn: asyncpg.Connection, training_id: UUID, user_id: UUID
) -> tuple[dict, dict]:
    """Proves the requester is the coach of this very personal training.

    The athlete is never taken from the request: it's derived from the
    training/booking. All of these must hold:
      * the training exists (404 otherwise),
      * it is a personal training,
      * a *confirmed* booking links it to this requester as its coach
        (an old, declined, expired or someone else's booking never does),
      * the booking's athlete is the training's owner.
    Returns (training, booking). Existence is only revealed as far as 404 vs
    403 goes; nothing about the athlete is in the error text.
    """
    training = await trainings_repo.get_training(conn, training_id)
    if training is None:
        raise NotFoundError("training not found")
    forbidden = ForbiddenError("only the coach of this personal training can use this", code="not_session_coach")
    if training["type"] != "personal":
        raise forbidden
    booking = await bookings_repo.get_confirmed_for_training(conn, training_id, user_id)
    if booking is None or booking["athlete_user_id"] != training["created_by"]:
        raise forbidden
    return training, booking


def _player_disabled_error() -> ForbiddenError:
    return ForbiddenError("the player has not allowed AI analysis", code="player_ai_analysis_disabled")


def _load_analysis(row: dict) -> PlayerPreSessionAnalysisOut:
    data = json.loads(row["analysis_json"])
    data["generated_at"] = row["generated_at"]
    return PlayerPreSessionAnalysisOut(**data)


@training_ai_router.get("/{training_id}/ai/player-analysis", response_model=PlayerAnalysisStatusOut)
async def get_player_analysis_status(
    training_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> PlayerAnalysisStatusOut:
    """Lets the coach UI show either the action or the "player did not allow"
    notice, plus the last saved analysis — which is only ever served while
    the player's consent is on."""
    training, _booking = await _require_personal_session_coach(conn, training_id, user["id"])
    allowed = await users_repo.get_ai_analysis_consent(conn, training["created_by"])
    if not allowed:
        return PlayerAnalysisStatusOut(allowed=False)
    row = await analyses_repo.get_for_training(conn, training_id, user["id"])
    return PlayerAnalysisStatusOut(allowed=True, analysis=_load_analysis(row) if row else None)


@training_ai_router.post("/{training_id}/ai/player-analysis", response_model=PlayerPreSessionAnalysisOut)
async def run_player_analysis(
    training_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> PlayerPreSessionAnalysisOut:
    training, booking = await _require_personal_session_coach(conn, training_id, user["id"])
    player_user_id = training["created_by"]
    if not await users_repo.get_ai_analysis_consent(conn, player_user_id):
        raise _player_disabled_error()

    analysis = await ai_service.build_player_pre_session_analysis(
        conn,
        settings,
        coach_id=user["id"],
        player_user_id=player_user_id,
        training=training,
        booking=booking,
    )
    stored = analysis.model_dump(mode="json", exclude={"generated_at"})
    row = await analyses_repo.upsert(
        conn,
        training_id=training_id,
        coach_user_id=user["id"],
        player_user_id=player_user_id,
        analysis_json=json.dumps(stored, ensure_ascii=False),
    )
    return analysis.model_copy(update={"generated_at": row["generated_at"]})


# --- The player's own privacy settings ----------------------------------------


@privacy_router.get("/privacy", response_model=PrivacySettingsOut)
async def get_privacy_settings(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> PrivacySettingsOut:
    return PrivacySettingsOut(
        allow_ai_analysis_by_personal_coach=await users_repo.get_ai_analysis_consent(conn, user["id"])
    )


@privacy_router.put("/privacy", response_model=PrivacySettingsOut)
async def update_privacy_settings(
    payload: PrivacySettingsIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> PrivacySettingsOut:
    """Always acts on the caller's own settings (there is no user id in the
    path or body). Withdrawing consent also erases every stored analysis of
    this player, so a coach can't keep reading an old one."""
    # Erase first: if the second statement failed, consent would still be on
    # and nothing stale is left behind (and GET re-checks consent anyway).
    if not payload.allow_ai_analysis_by_personal_coach:
        await analyses_repo.delete_for_player(conn, user["id"])
    value = await users_repo.set_ai_analysis_consent(conn, user["id"], payload.allow_ai_analysis_by_personal_coach)
    return PrivacySettingsOut(allow_ai_analysis_by_personal_coach=value)
