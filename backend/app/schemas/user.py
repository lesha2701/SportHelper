from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


# Bump to show the welcome guide again to every user who finished an older
# one (the guide's content lives in the frontend, see WelcomeGuide.tsx).
CURRENT_ONBOARDING_VERSION = 1


class UserOut(BaseModel):
    id: UUID
    telegram_id: int
    username: str | None
    first_name: str
    last_name: str | None
    photo_url: str | None
    avatar_file_id: UUID | None = Field(default=None)
    language_code: str | None
    active_mode: str | None
    created_at: datetime
    last_login_at: datetime | None
    # The guide is due while completed < current. The current version is sent
    # along so the client doesn't carry its own copy of the number.
    completed_onboarding_version: int = Field(default=0)
    current_onboarding_version: int = Field(default=CURRENT_ONBOARDING_VERSION)
