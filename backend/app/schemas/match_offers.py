"""«Подобрать тренера», offers to trainers: what the trainer, the athlete and the administrators each see of them.

The trainer sees an anonymous summary of the request (no name, no contacts); the athlete sees only the trainers who agreed."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.admin import PersonOut
from app.schemas.coach_listing import CoachListingCardOut
from app.schemas.match_types import DayPart, MatchFormat, MatchLevel, MatchOfferStatus


class MatchRequestSummaryOut(BaseModel):
    """The request as a trainer sees it: only what helps to decide. Free text has contacts masked."""

    sport: str
    goal: str | None
    level: MatchLevel | None
    format: MatchFormat | None
    city: str | None
    budget_min: float | None
    budget_max: float | None
    currency: str
    weekdays: list[int]
    day_parts: list[DayPart]
    schedule_note: str | None
    comment: str | None


class CoachOfferOut(BaseModel):
    id: UUID
    status: MatchOfferStatus
    created_at: datetime
    # Until when the trainer can answer.
    expires_at: datetime
    # The platform's share of the first session with this client, fixed in the offer (a number of percent).
    first_session_percent: float
    admin_message: str | None
    request: MatchRequestSummaryOut


class MatchOfferSettingsOut(BaseModel):
    enabled: bool
    # The terms the trainer has accepted (None if never) and the current ones.
    accepted_version: str | None
    current_version: str
    # False when the trainer has to accept the current terms (again) before switching the matching on.
    terms_accepted: bool
    first_session_percent: float
    terms_title: str
    terms: list[str]


class MatchOfferSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool
    # Required when switching on: the version of the terms the trainer has read.
    accept_terms_version: str | None = Field(default=None, max_length=40)


class DeclineOfferIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str | None = Field(default=None, max_length=500)

    @field_validator("reason")
    @classmethod
    def _tidy(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = " ".join(value.split())
        return text or None


class AthleteOfferCoachOut(BaseModel):
    user_id: UUID
    full_name: str
    is_pro: bool
    photo_url: str | None
    sport: str
    specialization: str | None
    experience_years: int | None
    average_rating: float | None
    review_count: int


class AthleteOfferOut(BaseModel):
    """A trainer who agreed to take the athlete. The athlete picks one (then books a session as usual) or declines."""

    id: UUID
    status: MatchOfferStatus
    # Until when the athlete can choose this trainer.
    expires_at: datetime | None
    coach: AthleteOfferCoachOut
    listings: list[CoachListingCardOut]


class AdminOfferOut(BaseModel):
    id: UUID
    status: MatchOfferStatus
    coach: PersonOut
    coach_sport: str | None
    first_session_percent: float
    admin_message: str | None
    coach_decline_reason: str | None
    created_at: datetime
    expires_at: datetime
    athlete_expires_at: datetime | None
    coach_responded_at: datetime | None
    athlete_responded_at: datetime | None


class CreateOfferIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    coach_user_id: UUID
    message: str | None = Field(default=None, max_length=500)

    @field_validator("message")
    @classmethod
    def _tidy(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = " ".join(value.split())
        return text or None


class CandidateOut(BaseModel):
    """A trainer who may be offered the request: opted in, with a published listing, no block or history with the athlete."""

    coach_user_id: UUID
    name: str
    is_pro: bool
    sport: str
    specialization: str | None
    experience_years: int | None
    average_rating: float | None
    review_count: int
    same_sport: bool
    already_offered: bool
