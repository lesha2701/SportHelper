from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.profile import SkillLevel

TeamRole = Literal["head_coach", "assistant_coach", "captain", "player"]
TeamStatus = Literal["active", "without_coach"]
InviteKind = Literal["join", "head_coach"]
JoinRequestStatus = Literal["pending", "accepted", "rejected", "cancelled"]


class TeamIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=1000)
    sport: str = Field(min_length=1, max_length=50)
    age_category: str | None = Field(default=None, max_length=50)
    level: SkillLevel | None = None
    # Left out of a request = unchanged (the older clients of the update do not know these two).
    tournaments: list[str] | None = Field(default=None, max_length=20)
    home_venue: str | None = Field(default=None, max_length=200)

    @field_validator("tournaments")
    @classmethod
    def _clean_tournaments(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned: list[str] = []
        for item in value:
            name = item.strip()
            if not name:
                continue
            if len(name) > 150:
                raise ValueError("a tournament name is at most 150 characters")
            if name not in cleaned:
                cleaned.append(name)
        return cleaned

    @field_validator("home_venue")
    @classmethod
    def _clean_venue(cls, value: str | None) -> str | None:
        return (value or "").strip() or None


class TeamOut(BaseModel):
    id: UUID
    name: str
    description: str | None
    sport: str
    age_category: str | None
    level: SkillLevel | None
    status: TeamStatus
    created_by: UUID
    logo_file_id: UUID | None = None
    tournaments: list[str] = []
    home_venue: str | None = None
    created_at: datetime
    updated_at: datetime
    my_role: TeamRole | None = None
    members_count: int = 0


class TeamMemberOut(BaseModel):
    user_id: UUID
    first_name: str
    last_name: str | None
    username: str | None
    photo_url: str | None
    role: TeamRole
    position: str | None
    joined_at: datetime


class MemberUpdateIn(BaseModel):
    role: Literal["captain", "assistant_coach", "player"] | None = None
    position: str | None = Field(default=None, max_length=50)


class TransferOwnershipIn(BaseModel):
    to_user_id: UUID
    confirmation_phrase: str


class InviteCreateIn(BaseModel):
    kind: InviteKind = "join"


class InviteOut(BaseModel):
    id: UUID
    team_id: UUID
    token: str
    kind: InviteKind
    link: str
    expires_at: datetime
    created_at: datetime


class JoinRequestOut(BaseModel):
    id: UUID
    team_id: UUID
    user_id: UUID
    first_name: str
    last_name: str | None
    username: str | None
    photo_url: str | None
    status: JoinRequestStatus
    created_at: datetime


class ApplyResultOut(BaseModel):
    status: Literal["pending", "joined"]
    team: TeamOut
