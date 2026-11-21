from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class BlockedUserOut(BaseModel):
    user_id: UUID
    full_name: str
    blocked_at: datetime
