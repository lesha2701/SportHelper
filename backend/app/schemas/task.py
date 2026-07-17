from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

TaskAssignmentStatus = Literal[
    "assigned", "viewed", "in_progress", "submitted",
    "accepted", "needs_revision", "overdue", "missed", "cancelled",
]
TaskTargetType = Literal["team", "players", "position", "absentees"]
TaskReviewDecision = Literal["accepted", "needs_revision"]


class TaskExerciseOut(BaseModel):
    id: UUID
    task_id: UUID
    exercise_id: UUID
    exercise_name: str | None
    order_index: int


class TaskAssignmentOut(BaseModel):
    id: UUID
    task_id: UUID
    user_id: UUID
    telegram_id: int
    first_name: str
    last_name: str | None
    photo_url: str | None
    position: str | None
    status: TaskAssignmentStatus
    comment: str | None
    photo_file_id: UUID | None
    video_file_id: UUID | None
    sets: int | None
    reps: int | None
    duration_minutes: int | None
    metric_value: float | None
    difficulty: int | None
    wellbeing: int | None
    coach_comment: str | None
    reviewed_by: UUID | None
    reviewed_at: datetime | None
    viewed_at: datetime | None
    submitted_at: datetime | None
    created_at: datetime
    updated_at: datetime


class TaskCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=150)
    description: str | None = Field(default=None, max_length=2000)
    plan_id: UUID | None = None
    exercise_ids: list[UUID] = Field(default_factory=list, max_length=30)
    deadline: datetime | None = None
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
    # Who gets the task: the whole team, an explicit list of players, every
    # player at a given position, or everyone marked absent at a training.
    target_type: TaskTargetType
    player_ids: list[UUID] = Field(default_factory=list, max_length=50)
    position: str | None = Field(default=None, max_length=50)
    training_id: UUID | None = None


class TaskUpdateIn(BaseModel):
    title: str = Field(min_length=1, max_length=150)
    description: str | None = Field(default=None, max_length=2000)
    plan_id: UUID | None = None
    exercise_ids: list[UUID] = Field(default_factory=list, max_length=30)
    deadline: datetime | None = None
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


class TaskOut(BaseModel):
    id: UUID
    team_id: UUID
    created_by: UUID
    title: str
    description: str | None
    plan_id: UUID | None
    deadline: datetime | None
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
    target_training_id: UUID | None
    created_at: datetime
    updated_at: datetime
    exercises: list[TaskExerciseOut] = []
    assignments: list[TaskAssignmentOut] = []


class TaskSubmitIn(BaseModel):
    comment: str | None = Field(default=None, max_length=2000)
    sets: int | None = Field(default=None, ge=0, le=100)
    reps: int | None = Field(default=None, ge=0, le=1000)
    duration_minutes: int | None = Field(default=None, ge=0, le=1000)
    metric_value: float | None = None
    difficulty: int | None = Field(default=None, ge=1, le=10)
    wellbeing: int | None = Field(default=None, ge=1, le=5)


class TaskReviewIn(BaseModel):
    decision: TaskReviewDecision
    coach_comment: str | None = Field(default=None, max_length=1000)


class MyTaskOut(BaseModel):
    task: TaskOut
    assignment: TaskAssignmentOut
