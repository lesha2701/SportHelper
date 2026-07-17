from __future__ import annotations

from datetime import date, time
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

CalendarEventType = Literal["training", "match", "task_deadline"]


class CalendarEventOut(BaseModel):
    id: UUID
    type: CalendarEventType
    date: date
    time: time | None
    title: str
    team_id: UUID | None
    team_name: str | None
    status: str
