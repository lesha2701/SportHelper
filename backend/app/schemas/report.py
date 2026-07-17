from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

ReportStatus = Literal["pending", "accepted", "needs_revision"]
ReviewDecision = Literal["accepted", "needs_revision"]


class ReportSubmitIn(BaseModel):
    text_report: str = Field(min_length=1, max_length=2000)


class ReportReviewIn(BaseModel):
    decision: ReviewDecision
    coach_comment: str | None = Field(default=None, max_length=1000)


class ReportOut(BaseModel):
    training_id: UUID
    submitted_by: UUID
    text_report: str
    photo_file_id: UUID | None
    video_file_id: UUID | None
    status: ReportStatus
    coach_comment: str | None
    reviewed_by: UUID | None
    reviewed_at: datetime | None
    created_at: datetime
    updated_at: datetime
