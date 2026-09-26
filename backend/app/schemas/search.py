from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel


class SearchResultOut(BaseModel):
    # team | player | coach | exercise | training | match | task
    type: str
    id: UUID
    title: str
    subtitle: str | None = None
    team_id: UUID | None = None
    on_date: date | None = None
