from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class TaskTemplateExerciseOut(BaseModel):
    id: UUID
    template_id: UUID
    exercise_id: UUID
    exercise_name: str | None
    order_index: int


class TaskTemplateIn(BaseModel):
    title: str = Field(min_length=1, max_length=150)
    description: str | None = Field(default=None, max_length=2000)
    plan_id: UUID | None = None
    exercise_ids: list[UUID] = Field(default_factory=list, max_length=30)
    metric_name: str | None = Field(default=None, max_length=100)
    metric_unit: str | None = Field(default=None, max_length=30)
    metric_target: float | None = None
    require_comment: bool = False
    require_photo: bool = False
    require_video: bool = False
    require_sets_reps: bool = False
    require_duration: bool = False
    require_metric_value: bool = False
    require_difficulty: bool = False
    require_wellbeing: bool = False


class TaskTemplateOut(BaseModel):
    id: UUID
    owner_id: UUID
    title: str
    description: str | None
    plan_id: UUID | None
    metric_name: str | None
    metric_unit: str | None
    metric_target: float | None
    require_comment: bool
    require_photo: bool
    require_video: bool
    require_sets_reps: bool
    require_duration: bool
    require_metric_value: bool
    require_difficulty: bool
    require_wellbeing: bool
    created_at: datetime
    updated_at: datetime
    exercises: list[TaskTemplateExerciseOut] = []
