from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

SkillLevel = Literal["beginner", "amateur", "intermediate", "advanced", "professional"]
ActiveMode = Literal["player", "coach"]


class PlayerProfileIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=100)
    age: int | None = Field(default=None, ge=3, le=100)
    height_cm: int | None = Field(default=None, ge=50, le=260)
    weight_kg: float | None = Field(default=None, ge=15, le=300)
    sport: str = Field(min_length=1, max_length=50)
    position: str | None = Field(default=None, max_length=50)
    level: SkillLevel | None = None
    goals: str | None = Field(default=None, max_length=1000)
    load_restrictions: str | None = Field(default=None, max_length=1000)


class PlayerProfileOut(BaseModel):
    user_id: UUID
    full_name: str
    age: int | None
    height_cm: int | None
    weight_kg: float | None
    sport: str
    position: str | None
    level: SkillLevel | None
    goals: str | None
    load_restrictions: str | None
    created_at: datetime
    updated_at: datetime


class CoachProfileIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=100)
    sport: str = Field(min_length=1, max_length=50)
    experience_years: int | None = Field(default=None, ge=0, le=80)
    specialization: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=1000)


class CoachProfileOut(BaseModel):
    user_id: UUID
    full_name: str
    sport: str
    experience_years: int | None
    specialization: str | None
    description: str | None
    created_at: datetime
    updated_at: datetime


class ProfileMeOut(BaseModel):
    active_mode: ActiveMode | None
    player: PlayerProfileOut | None
    coach: CoachProfileOut | None


class ActiveModeIn(BaseModel):
    mode: ActiveMode
