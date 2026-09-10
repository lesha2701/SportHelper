from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class BookingIn(BaseModel):
    coach_user_id: UUID
    starts_at: datetime
    format: str  # "online" | "offline"

    @model_validator(mode="after")
    def _normalize_starts_at_to_utc(self) -> "BookingIn":
        # bookings.starts_at is a real TIMESTAMPTZ column, so the whole
        # booking pipeline (slot lookup, double-booking guard, INSERT) must
        # agree on one timezone-aware representation. A naive input is
        # assumed to already be UTC (this repo's usual "naive means UTC"
        # convention); an aware input with a different offset is converted.
        # Without this, two requests for the "same" wall-clock slot but
        # different UTC offsets would insert two different starts_at values
        # and slip past the UNIQUE (coach_user_id, starts_at) guard.
        if self.starts_at.tzinfo is None:
            self.starts_at = self.starts_at.replace(tzinfo=timezone.utc)
        else:
            self.starts_at = self.starts_at.astimezone(timezone.utc)
        return self


class BookingOut(BaseModel):
    id: UUID
    coach_user_id: UUID
    coach_full_name: str
    athlete_user_id: UUID
    starts_at: datetime
    duration_minutes: int
    format: str
    price_per_session: float | None
    currency: str
    status: str
    is_completed: bool
    training_id: UUID | None
    has_review: bool


class ReviewIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    text: str | None = Field(default=None, max_length=2000)


class ReviewOut(BaseModel):
    id: UUID
    booking_id: UUID
    rating: int
    text: str | None
