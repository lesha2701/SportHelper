from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class BookingIn(BaseModel):
    coach_user_id: UUID
    starts_at: datetime
    format: str  # "online" | "offline"


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
    training_id: UUID
    has_review: bool
