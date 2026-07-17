from __future__ import annotations

from datetime import date, datetime, time
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

MatchStatus = Literal["scheduled", "completed", "cancelled"]
MatchResult = Literal["win", "loss", "draw"]


class MatchCreateIn(BaseModel):
    opponent_name: str = Field(min_length=1, max_length=150)
    match_date: date
    start_time: time
    location: str | None = Field(default=None, max_length=200)
    is_home: bool = True
    tournament: str | None = Field(default=None, max_length=150)


class MatchUpdateIn(BaseModel):
    opponent_name: str = Field(min_length=1, max_length=150)
    match_date: date
    start_time: time
    location: str | None = Field(default=None, max_length=200)
    is_home: bool = True
    tournament: str | None = Field(default=None, max_length=150)
    status: MatchStatus = "scheduled"


class MatchResultIn(BaseModel):
    our_score: int = Field(ge=0, le=999)
    opponent_score: int = Field(ge=0, le=999)
    comment: str | None = Field(default=None, max_length=2000)


class MatchRosterIn(BaseModel):
    user_ids: list[UUID] = Field(default_factory=list, max_length=50)


class RosterMemberOut(BaseModel):
    id: UUID
    match_id: UUID
    user_id: UUID
    telegram_id: int
    first_name: str
    last_name: str | None
    photo_url: str | None


class MatchOut(BaseModel):
    id: UUID
    team_id: UUID
    created_by: UUID
    opponent_name: str
    match_date: date
    start_time: time
    location: str | None
    is_home: bool
    tournament: str | None
    status: MatchStatus
    our_score: int | None
    opponent_score: int | None
    result: MatchResult | None
    comment: str | None
    created_at: datetime
    updated_at: datetime
    roster: list[RosterMemberOut] = []
