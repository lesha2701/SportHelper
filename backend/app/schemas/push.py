from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class PushDeviceIn(BaseModel):
    """What the app gives the server after the system issued it a token: `ios` for an APNs token, `android` for an FCM token."""

    platform: Literal["ios", "android"]
    token: str = Field(min_length=8, max_length=4096)
    app_version: str | None = Field(default=None, max_length=40)


class PushDeviceRemoveIn(BaseModel):
    token: str = Field(min_length=8, max_length=4096)
