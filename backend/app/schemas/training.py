from __future__ import annotations

from datetime import date, datetime, time
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

TrainingType = Literal["team", "personal", "independent"]
TrainingStatus = Literal["scheduled", "completed", "cancelled"]
AttendanceStatus = Literal["present", "absent"]
ReportStatus = Literal["pending", "accepted", "needs_revision"]


class TrainingCreateIn(BaseModel):
    training_date: date
    start_time: time
    duration_minutes: int = Field(gt=0, le=600)
    location: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    plan_id: UUID | None = None
    reminder_minutes_before: int | None = Field(default=None, ge=0, le=10080)
    # If set, also creates a training on the same weekday every week up to
    # and including this date (all sharing one recurrence_group_id).
    repeat_weekly_until: date | None = None
    # Team trainings only: mark this as a self-run session (no coach
    # present) and optionally pick who is responsible for it — defaults to
    # the team captain when omitted.
    is_independent: bool = False
    responsible_user_id: UUID | None = None


class TrainingUpdateIn(BaseModel):
    training_date: date
    start_time: time
    duration_minutes: int = Field(gt=0, le=600)
    location: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    plan_id: UUID | None = None
    reminder_minutes_before: int | None = Field(default=None, ge=0, le=10080)
    status: TrainingStatus = "scheduled"
    is_independent: bool = False
    responsible_user_id: UUID | None = None


class TrainingOut(BaseModel):
    id: UUID
    team_id: UUID | None
    created_by: UUID
    type: TrainingType
    plan_id: UUID | None
    training_date: date
    start_time: time
    duration_minutes: int
    location: str | None
    description: str | None
    status: TrainingStatus
    reminder_minutes_before: int | None
    recurrence_group_id: UUID | None
    responsible_user_id: UUID | None
    created_at: datetime
    updated_at: datetime


class AttendanceOut(BaseModel):
    training_id: UUID
    user_id: UUID
    telegram_id: int
    first_name: str
    last_name: str | None
    photo_url: str | None
    status: AttendanceStatus
    marked_by: UUID | None
    marked_at: datetime


class AttendanceStatusIn(BaseModel):
    status: AttendanceStatus
