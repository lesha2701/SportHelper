from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db
from app.core.exceptions import APIError, ForbiddenError, NotFoundError
from app.repositories import exercises as exercises_repo
from app.repositories import plans as plans_repo
from app.repositories import profiles as profiles_repo
from app.repositories import teams as teams_repo
from app.schemas.plan import PlanExerciseIn, PlanExerciseOut, PlanIn, PlanOut, SharePlanIn

router = APIRouter(prefix="/api/plans", tags=["plans"])
team_plans_router = APIRouter(prefix="/api/teams", tags=["plans"])

_COACH_STAFF = {"head_coach", "assistant_coach"}


async def _plan_out(conn: asyncpg.Connection, plan: dict, *, with_exercises: bool = True) -> PlanOut:
    exercises = await plans_repo.list_plan_exercises(conn, plan["id"]) if with_exercises else []
    shared_team_ids = await plans_repo.list_shared_team_ids(conn, plan["id"])
    return PlanOut(**plan, exercises=[PlanExerciseOut(**e) for e in exercises], shared_team_ids=shared_team_ids)


async def _plans_out_without_exercises(conn: asyncpg.Connection, plans: list[dict]) -> list[PlanOut]:
    """Batched form of _plan_out(with_exercises=False) for list endpoints —
    one query for all plans' shared_team_ids instead of one query per plan."""
    shared_by_id = await plans_repo.list_shared_team_ids_batch(conn, [p["id"] for p in plans])
    return [PlanOut(**plan, exercises=[], shared_team_ids=shared_by_id.get(plan["id"], [])) for plan in plans]


async def _get_owned_plan_or_404(conn: asyncpg.Connection, plan_id: UUID, owner_id: UUID) -> dict:
    plan = await plans_repo.get_plan(conn, plan_id)
    if plan is None or plan["owner_id"] != owner_id:
        raise NotFoundError("plan not found")
    return plan


@router.post("", response_model=PlanOut)
async def create_plan(
    payload: PlanIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> PlanOut:
    coach_profile = await profiles_repo.get_coach_profile(conn, user["id"])
    if coach_profile is None:
        raise APIError(
            "create a coach profile before creating training plans", code="coach_profile_required", status_code=409
        )
    plan = await plans_repo.create_plan(conn, user["id"], **payload.model_dump())
    return await _plan_out(conn, plan)


@router.get("/mine", response_model=list[PlanOut])
async def list_my_plans(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[PlanOut]:
    plans = await plans_repo.list_owned(conn, user["id"])
    return await _plans_out_without_exercises(conn, plans)


@router.get("/{plan_id}", response_model=PlanOut)
async def get_plan(
    plan_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> PlanOut:
    plan = await plans_repo.get_plan(conn, plan_id)
    if plan is None:
        raise NotFoundError("plan not found")
    if plan["owner_id"] != user["id"]:
        shared_team_ids = await plans_repo.list_shared_team_ids(conn, plan_id)
        visible = False
        for team_id in shared_team_ids:
            if await teams_repo.get_member(conn, team_id, user["id"]) is not None:
                visible = True
                break
        if not visible:
            raise ForbiddenError("you do not have access to this plan")
    return await _plan_out(conn, plan)


@router.put("/{plan_id}", response_model=PlanOut)
async def update_plan(
    plan_id: UUID,
    payload: PlanIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> PlanOut:
    await _get_owned_plan_or_404(conn, plan_id, user["id"])
    plan = await plans_repo.update_plan(conn, plan_id, user["id"], **payload.model_dump())
    if plan is None:
        raise NotFoundError("plan not found")
    return await _plan_out(conn, plan)


@router.delete("/{plan_id}", status_code=204, response_model=None)
async def delete_plan(
    plan_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    deleted = await plans_repo.soft_delete(conn, plan_id, user["id"])
    if not deleted:
        raise NotFoundError("plan not found")


@router.post("/{plan_id}/duplicate", response_model=PlanOut)
async def duplicate_plan(
    plan_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> PlanOut:
    new_plan = await plans_repo.duplicate_plan(conn, plan_id, user["id"])
    if new_plan is None:
        raise NotFoundError("plan not found")
    return await _plan_out(conn, new_plan)


@router.post("/{plan_id}/exercises", response_model=PlanExerciseOut)
async def add_plan_exercise(
    plan_id: UUID,
    payload: PlanExerciseIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> PlanExerciseOut:
    await _get_owned_plan_or_404(conn, plan_id, user["id"])
    exercise = await exercises_repo.get_exercise(conn, payload.exercise_id)
    if exercise is None or exercise["owner_id"] != user["id"]:
        raise NotFoundError("exercise not found")
    plan_exercise = await plans_repo.add_plan_exercise(conn, plan_id, **payload.model_dump())
    return PlanExerciseOut(**plan_exercise)


@router.put("/{plan_id}/exercises/{plan_exercise_id}", response_model=PlanExerciseOut)
async def update_plan_exercise(
    plan_id: UUID,
    plan_exercise_id: UUID,
    payload: PlanExerciseIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> PlanExerciseOut:
    await _get_owned_plan_or_404(conn, plan_id, user["id"])
    exercise = await exercises_repo.get_exercise(conn, payload.exercise_id)
    if exercise is None or exercise["owner_id"] != user["id"]:
        raise NotFoundError("exercise not found")
    plan_exercise = await plans_repo.update_plan_exercise(conn, plan_exercise_id, plan_id, **payload.model_dump())
    if plan_exercise is None:
        raise NotFoundError("plan exercise not found")
    return PlanExerciseOut(**plan_exercise)


@router.delete("/{plan_id}/exercises/{plan_exercise_id}", status_code=204, response_model=None)
async def remove_plan_exercise(
    plan_id: UUID,
    plan_exercise_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    await _get_owned_plan_or_404(conn, plan_id, user["id"])
    removed = await plans_repo.remove_plan_exercise(conn, plan_exercise_id, plan_id)
    if not removed:
        raise NotFoundError("plan exercise not found")


@router.post("/{plan_id}/share", response_model=PlanOut)
async def share_plan(
    plan_id: UUID,
    payload: SharePlanIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> PlanOut:
    plan = await _get_owned_plan_or_404(conn, plan_id, user["id"])
    member = await teams_repo.get_member(conn, payload.team_id, user["id"])
    if member is None or member["role"] not in _COACH_STAFF:
        raise ForbiddenError("you must coach the team you are sharing a plan with")
    await plans_repo.share_with_team(conn, plan_id, payload.team_id, user["id"])
    return await _plan_out(conn, plan)


@router.delete("/{plan_id}/share/{team_id}", response_model=PlanOut)
async def unshare_plan(
    plan_id: UUID,
    team_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> PlanOut:
    plan = await _get_owned_plan_or_404(conn, plan_id, user["id"])
    await plans_repo.unshare_from_team(conn, plan_id, team_id)
    return await _plan_out(conn, plan)


@team_plans_router.get("/{team_id}/plans", response_model=list[PlanOut])
async def list_team_plans(
    team_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[PlanOut]:
    member = await teams_repo.get_member(conn, team_id, user["id"])
    if member is None:
        raise ForbiddenError("you are not a member of this team")
    plans = await plans_repo.list_shared_with_team(conn, team_id)
    return await _plans_out_without_exercises(conn, plans)
