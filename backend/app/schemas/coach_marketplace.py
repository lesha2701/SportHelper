from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class CoachMarketplaceSettingsIn(BaseModel):
    is_listed: bool
    price_per_session: float | None = Field(default=None, ge=0)
    currency: str = Field(default="RUB", min_length=3, max_length=3)
    offers_online: bool = False
    offers_offline: bool = False
    location: str | None = Field(default=None, max_length=200)
    session_duration_minutes: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _validate_listing_requirements(self) -> "CoachMarketplaceSettingsIn":
        if not self.is_listed:
            return self
        if not (self.offers_online or self.offers_offline):
            raise ValueError("choose at least one training format before listing")
        if self.price_per_session is None:
            raise ValueError("set a price before listing")
        if self.session_duration_minutes is None:
            raise ValueError("set a session duration before listing")
        return self


class CoachMarketplaceSettingsOut(BaseModel):
    user_id: UUID
    is_listed: bool
    price_per_session: float | None
    currency: str
    offers_online: bool
    offers_offline: bool
    location: str | None
    session_duration_minutes: int | None
