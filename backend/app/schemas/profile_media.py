from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class ProfileMediaOut(BaseModel):
    id: UUID
    user_id: UUID
    file_id: UUID
    media_type: Literal["photo", "video"]
    caption: str | None
    sort_order: int
    created_at: datetime
