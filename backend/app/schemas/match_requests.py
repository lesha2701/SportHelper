"""The «Подобрать тренера» form of an athlete and what the administrators see of it."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.admin import PersonOut

MatchLevel = Literal["beginner", "amateur", "advanced", "pro"]
MatchFormat = Literal["online", "offline", "any"]
DayPart = Literal["morning", "day", "evening"]
MatchStatus = Literal["new", "in_progress", "closed", "canceled"]


def _one_line(value: str | None) -> str | None:
    if value is None:
        return None
    text = " ".join(value.split())
    return text or None


def _prose(value: str | None) -> str | None:
    """Line breaks stay (it is prose), runs of spaces and of blank lines do not."""
    if value is None:
        return None
    lines = [" ".join(line.split()) for line in value.strip().splitlines()]
    text = "\n".join(lines)
    while "\n\n\n" in text:
        text = text.replace("\n\n\n", "\n\n")
    return text.strip() or None


class MatchRequestIn(BaseModel):
    """Only the sport is required; everything else the person may leave empty."""

    model_config = ConfigDict(extra="forbid")

    sport: str = Field(min_length=1, max_length=100)
    goal: str | None = Field(default=None, max_length=1000)
    level: MatchLevel | None = None
    format: MatchFormat | None = None
    city: str | None = Field(default=None, max_length=100)
    budget_min: Decimal | None = Field(default=None, ge=0, le=Decimal("99999999"))
    budget_max: Decimal | None = Field(default=None, ge=0, le=Decimal("99999999"))
    currency: str = Field(default="RUB", min_length=3, max_length=3)
    weekdays: list[int] = Field(default_factory=list, max_length=7)
    day_parts: list[DayPart] = Field(default_factory=list, max_length=3)
    schedule_note: str | None = Field(default=None, max_length=500)
    comment: str | None = Field(default=None, max_length=1500)

    @field_validator("sport")
    @classmethod
    def _sport(cls, value: str) -> str:
        text = " ".join(value.split())
        if not 2 <= len(text) <= 100:
            raise ValueError("Вид спорта: от 2 до 100 символов.")
        return text

    @field_validator("city", "schedule_note")
    @classmethod
    def _line(cls, value: str | None) -> str | None:
        return _one_line(value)

    @field_validator("goal", "comment")
    @classmethod
    def _text(cls, value: str | None) -> str | None:
        return _prose(value)

    @field_validator("currency")
    @classmethod
    def _currency(cls, value: str) -> str:
        return value.upper()

    @field_validator("weekdays")
    @classmethod
    def _weekdays(cls, value: list[int]) -> list[int]:
        if any(day < 0 or day > 6 for day in value):
            raise ValueError("Дни недели: от 0 (понедельник) до 6 (воскресенье).")
        return sorted(set(value))

    @field_validator("day_parts")
    @classmethod
    def _day_parts(cls, value: list[str]) -> list[str]:
        return [part for part in ("morning", "day", "evening") if part in value]

    @model_validator(mode="after")
    def _budget(self) -> "MatchRequestIn":
        if self.budget_min is not None and self.budget_max is not None and self.budget_min > self.budget_max:
            raise ValueError("Бюджет «от» не может быть больше бюджета «до».")
        return self


class MatchRequestOut(BaseModel):
    id: UUID
    sport: str
    goal: str | None
    level: MatchLevel | None
    format: MatchFormat | None
    city: str | None
    # Numbers, not strings: the phone apps decode them straight into amounts (as the price of a listing).
    budget_min: float | None
    budget_max: float | None
    currency: str
    weekdays: list[int]
    day_parts: list[DayPart]
    schedule_note: str | None
    comment: str | None
    status: MatchStatus
    created_at: datetime


class MatchRequestAdminOut(MatchRequestOut):
    author: PersonOut
    admin_note: str | None
    handled_by: str | None
    handled_at: datetime | None


class MatchRequestPageOut(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[MatchRequestAdminOut]


class CloseMatchRequestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str | None = Field(default=None, max_length=1000)

    @field_validator("note")
    @classmethod
    def _note(cls, value: str | None) -> str | None:
        return _prose(value)
