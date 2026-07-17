from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db
from app.core.exceptions import APIError, NotFoundError
from app.repositories import exercises as exercises_repo
from app.repositories import plans as plans_repo
from app.repositories import profiles as profiles_repo
from app.repositories import task_templates as templates_repo
from app.schemas.task_template import TaskTemplateExerciseOut, TaskTemplateIn, TaskTemplateOut

router = APIRouter(prefix="/api/task-templates", tags=["task-templates"])


async def _template_out(conn: asyncpg.Connection, template: dict, *, with_exercises: bool = True) -> TaskTemplateOut:
    exercises = await templates_repo.list_template_exercises(conn, template["id"]) if with_exercises else []
    return TaskTemplateOut(**template, exercises=[TaskTemplateExerciseOut(**e) for e in exercises])


async def _get_owned_template_or_404(conn: asyncpg.Connection, template_id: UUID, owner_id: UUID) -> dict:
    template = await templates_repo.get_template(conn, template_id)
    if template is None or template["owner_id"] != owner_id:
        raise NotFoundError("task template not found")
    return template


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


@router.post("", response_model=TaskTemplateOut)
async def create_template(
    payload: TaskTemplateIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> TaskTemplateOut:
    coach_profile = await profiles_repo.get_coach_profile(conn, user["id"])
    if coach_profile is None:
        raise APIError(
            "create a coach profile before creating task templates", code="coach_profile_required", status_code=409
        )
    await _validate_plan_ownership(conn, payload.plan_id, user["id"])
    await _validate_exercise_ownership(conn, payload.exercise_ids, user["id"])

    fields = payload.model_dump(exclude={"exercise_ids"})
    template = await templates_repo.create_template(conn, user["id"], **fields)
    await templates_repo.set_template_exercises(conn, template["id"], payload.exercise_ids)
    return await _template_out(conn, template)


@router.get("/mine", response_model=list[TaskTemplateOut])
async def list_my_templates(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[TaskTemplateOut]:
    templates = await templates_repo.list_owned(conn, user["id"])
    return [await _template_out(conn, template, with_exercises=False) for template in templates]


@router.get("/{template_id}", response_model=TaskTemplateOut)
async def get_template(
    template_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> TaskTemplateOut:
    template = await _get_owned_template_or_404(conn, template_id, user["id"])
    return await _template_out(conn, template)


@router.put("/{template_id}", response_model=TaskTemplateOut)
async def update_template(
    template_id: UUID,
    payload: TaskTemplateIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> TaskTemplateOut:
    await _get_owned_template_or_404(conn, template_id, user["id"])
    await _validate_plan_ownership(conn, payload.plan_id, user["id"])
    await _validate_exercise_ownership(conn, payload.exercise_ids, user["id"])

    fields = payload.model_dump(exclude={"exercise_ids"})
    template = await templates_repo.update_template(conn, template_id, user["id"], **fields)
    if template is None:
        raise NotFoundError("task template not found")
    await templates_repo.set_template_exercises(conn, template_id, payload.exercise_ids)
    return await _template_out(conn, template)


@router.delete("/{template_id}", status_code=204, response_model=None)
async def delete_template(
    template_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    deleted = await templates_repo.soft_delete(conn, template_id, user["id"])
    if not deleted:
        raise NotFoundError("task template not found")
