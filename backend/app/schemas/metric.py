from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field


class MetricIn(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    unit: str | None = Field(default=None, max_length=30)
    value: float
    recorded_date: date
    higher_is_better: bool = True
    source: str | None = Field(default=None, max_length=150)
    comment: str | None = Field(default=None, max_length=1000)


class MetricOut(BaseModel):
    id: UUID
    user_id: UUID
    recorded_by: UUID
    name: str
    unit: str | None
    value: float
    recorded_date: date
    higher_is_better: bool
    source: str | None
    comment: str | None
    created_at: datetime
    updated_at: datetime


class PersonalRecordOut(BaseModel):
    name: str
    unit: str | None
    value: float
    recorded_date: date
    higher_is_better: bool
