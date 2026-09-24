from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

NotificationCategory = Literal[
    "training_reminder", "task_deadline", "new_training", "new_match", "new_task",
    "booking_requested", "booking_decided",
]

NOTIFICATION_CATEGORIES: tuple[NotificationCategory, ...] = (
    "training_reminder",
    "task_deadline",
    "new_training",
    "new_match",
    "new_task",
    "booking_requested",
    "booking_decided",
)


class NotificationPreferenceOut(BaseModel):
    category: NotificationCategory
    enabled: bool


class NotificationPreferenceIn(BaseModel):
    category: NotificationCategory
    enabled: bool


class NotificationPreferencesUpdateIn(BaseModel):
    preferences: list[NotificationPreferenceIn]


class NotificationOut(BaseModel):
    id: UUID
    category: NotificationCategory
    title: str
    body: str
    entity_type: str
    entity_id: UUID
    send_at: datetime
    read_at: datetime | None = Field(default=None)
