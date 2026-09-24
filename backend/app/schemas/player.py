from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel

SkillLevel = Literal["beginner", "amateur", "intermediate", "advanced", "professional"]


class PlayerPublicProfileOut(BaseModel):
    """A player's profile as viewed by someone other than themself — a
    coach they've booked (or been booked by), or a coach who shares a team
    with them. Unlike PlayerProfileOut, this carries their avatar too."""

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
    avatar_file_id: UUID | None
    photo_url: str | None
