from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class UserOut(BaseModel):
    id: UUID
    telegram_id: int
    username: str | None
    first_name: str
    last_name: str | None
    photo_url: str | None
    language_code: str | None
    active_mode: str | None
    created_at: datetime
    last_login_at: datetime | None
