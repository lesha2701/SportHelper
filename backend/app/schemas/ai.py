from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.task import TaskTargetType

PersonalTrainingStyle = Literal["reps", "circuit"]


class TrainingPlanDraftIn(BaseModel):
    goals: str = Field(min_length=1, max_length=1000)
    team_id: UUID | None = None
    sport: str | None = Field(default=None, max_length=50)
    age_category: str | None = Field(default=None, max_length=50)
    level: str | None = Field(default=None, max_length=30)
    player_count: int | None = Field(default=None, ge=1, le=50)
    duration_minutes: int | None = Field(default=None, ge=10, le=300)
    equipment: str | None = Field(default=None, max_length=300)


class TrainingPlanDraftOut(BaseModel):
    name: str
    sport: str
    description: str
    duration_minutes: int | None
    equipment: str | None
    comment: str | None


class TaskDraftIn(BaseModel):
    goal: str = Field(min_length=1, max_length=1000)
    target_type_hint: str | None = Field(default=None, max_length=30)


class TaskDraftOut(BaseModel):
    title: str
    description: str
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
    target_type: TaskTargetType
    target_position: str | None


class PersonalTrainingDraftIn(BaseModel):
    style: PersonalTrainingStyle = "reps"
    goals: str | None = Field(default=None, max_length=1000)
    duration_minutes: int | None = Field(default=None, ge=10, le=300)


class PersonalTrainingExerciseDraft(BaseModel):
    exercise: str
    reps: int | None = None
    sets: int | None = None
    duration_seconds: int | None = None


class PersonalTrainingDraftOut(BaseModel):
    style: PersonalTrainingStyle
    exercises: list[PersonalTrainingExerciseDraft]
    notes: str | None
    duration_minutes: int | None


class TrainingEvaluationIn(BaseModel):
    training_id: UUID


class AITextOut(BaseModel):
    text: str
