from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class CoachPublicProfileOut(BaseModel):
    """A coach's own profile info, viewable by anyone — unlike
    CoachListingProfileOut, this isn't scoped to one listing."""

    user_id: UUID
    full_name: str
    sport: str
    specialization: str | None
    experience_years: int | None
    description: str | None
    avatar_file_id: UUID | None
    photo_url: str | None
    average_rating: float | None
    review_count: int
