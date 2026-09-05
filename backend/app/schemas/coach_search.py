from __future__ import annotations

from datetime import date, datetime, time
from uuid import UUID

from pydantic import BaseModel


class CoachCardOut(BaseModel):
    user_id: UUID
    full_name: str
    photo_url: str | None
    sport: str
    specialization: str | None
    description: str | None
    experience_years: int | None
    average_rating: float | None
    review_count: int
    price_per_session: float | None
    currency: str
    location: str | None
    offers_online: bool
    offers_offline: bool
    next_available_slot: datetime | None


class CoachPublicProfileOut(CoachCardOut):
    session_duration_minutes: int | None
    availability: list[dict]  # {weekday, start_time, end_time} — reuses AvailabilityWindowOut shape
    recent_reviews: list["CoachReviewOut"]


class CoachReviewOut(BaseModel):
    id: UUID
    athlete_first_name: str
    rating: int
    text: str | None
    created_at: datetime


class OpenSlotOut(BaseModel):
    starts_at: datetime
    duration_minutes: int


CoachPublicProfileOut.model_rebuild()
