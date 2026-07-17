from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

PlanSection = Literal["warmup", "main", "game", "cooldown"]


class PlanIn(BaseModel):
    sport: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=150)
    description: str | None = Field(default=None, max_length=2000)
    duration_minutes: int | None = Field(default=None, ge=0, le=600)
    equipment: str | None = Field(default=None, max_length=500)
    comment: str | None = Field(default=None, max_length=1000)


class PlanExerciseIn(BaseModel):
    exercise_id: UUID
    section: PlanSection
    order_index: int = Field(default=0, ge=0, le=1000)
    sets: int | None = Field(default=None, ge=0, le=100)
    reps: int | None = Field(default=None, ge=0, le=1000)
    duration_seconds: int | None = Field(default=None, ge=0, le=36000)
    rest_seconds: int | None = Field(default=None, ge=0, le=36000)
    notes: str | None = Field(default=None, max_length=500)


class PlanExerciseOut(BaseModel):
    id: UUID
    plan_id: UUID
    exercise_id: UUID
    exercise_name: str | None
    section: PlanSection
    order_index: int
    sets: int | None
    reps: int | None
    duration_seconds: int | None
    rest_seconds: int | None
    notes: str | None


class PlanOut(BaseModel):
    id: UUID
    owner_id: UUID
    sport: str
    name: str
    description: str | None
    duration_minutes: int | None
    equipment: str | None
    comment: str | None
    created_at: datetime
    updated_at: datetime
    exercises: list[PlanExerciseOut] = []
    shared_team_ids: list[UUID] = []


class SharePlanIn(BaseModel):
    team_id: UUID
