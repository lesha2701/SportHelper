from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.profile import SkillLevel


class ExerciseIn(BaseModel):
    sport: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=150)
    description: str | None = Field(default=None, max_length=2000)
    goal: str | None = Field(default=None, max_length=500)
    sets: int | None = Field(default=None, ge=0, le=100)
    reps: int | None = Field(default=None, ge=0, le=1000)
    duration_seconds: int | None = Field(default=None, ge=0, le=36000)
    rest_seconds: int | None = Field(default=None, ge=0, le=36000)
    equipment: str | None = Field(default=None, max_length=500)
    difficulty: SkillLevel | None = None
    technique: str | None = Field(default=None, max_length=2000)
    common_mistakes: str | None = Field(default=None, max_length=2000)
    warnings: str | None = Field(default=None, max_length=1000)
    coach_comment: str | None = Field(default=None, max_length=1000)


class ExerciseOut(BaseModel):
    id: UUID
    owner_id: UUID
    sport: str
    name: str
    description: str | None
    goal: str | None
    photo_file_id: UUID | None
    video_file_id: UUID | None
    sets: int | None
    reps: int | None
    duration_seconds: int | None
    rest_seconds: int | None
    equipment: str | None
    difficulty: SkillLevel | None
    technique: str | None
    common_mistakes: str | None
    warnings: str | None
    coach_comment: str | None
    created_at: datetime
    updated_at: datetime
    shared_team_ids: list[UUID] = []


class ShareExerciseIn(BaseModel):
    team_id: UUID
