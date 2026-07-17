from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class TrainingFeedbackIn(BaseModel):
    wellbeing: int | None = Field(default=None, ge=1, le=5)
    difficulty: int | None = Field(default=None, ge=1, le=10)
    comment: str | None = Field(default=None, max_length=1000)


class TrainingFeedbackOut(BaseModel):
    training_id: UUID
    user_id: UUID
    wellbeing: int | None
    difficulty: int | None
    comment: str | None
    skipped: bool
    created_at: datetime
