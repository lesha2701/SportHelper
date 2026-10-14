from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.config import get_settings

# Bump to show the welcome guide again to every user who finished an older
# one (the guide's content lives in the frontend, see WelcomeGuide.tsx).
CURRENT_ONBOARDING_VERSION = 1


class UserOut(BaseModel):
    id: UUID
    email: str | None = None
    email_verified: bool = False
    username: str | None = None
    first_name: str
    last_name: str | None = None
    photo_url: str | None = None
    avatar_file_id: UUID | None = Field(default=None)
    language_code: str | None = None
    active_mode: str | None = None
    # Role picked at sign-up ("player" / "coach"); only a hint for onboarding.
    preferred_role: str | None = None
    created_at: datetime
    last_login_at: datetime | None = None
    # Telegram is an optional notification channel, not an identity.
    telegram_linked: bool = False
    has_password: bool = False
    is_admin: bool = False
    deletion_requested_at: datetime | None = None
    # The guide is due while completed < current. The current version is sent
    # along so the client doesn't carry its own copy of the number.
    completed_onboarding_version: int = Field(default=0)
    current_onboarding_version: int = Field(default=CURRENT_ONBOARDING_VERSION)

    @model_validator(mode="before")
    @classmethod
    def _derive_flags(cls, data: Any) -> Any:
        # Built straight from a repository row, so the derived flags are
        # computed here once instead of at every call site.
        if isinstance(data, dict):
            data = dict(data)
            email = data.get("email")
            verified = data.get("email_verified_at") is not None
            data.setdefault("email_verified", verified)
            data.setdefault("telegram_linked", data.get("telegram_id") is not None)
            data.setdefault(
                "is_admin",
                bool(email and verified and str(email).lower() in get_settings().admin_emails_list),
            )
        return data
