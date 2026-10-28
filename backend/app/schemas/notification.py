from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

# Categories a person may switch off in the settings...
PreferenceCategory = Literal[
    "training_reminder", "task_deadline", "new_training", "new_match", "new_task",
    "booking_requested", "booking_decided", "review_requested", "training_nudge",
]
# ...and every category a notification can have: the money ones are transactional (a payment, an earning, a withdrawal,
# a finance alert for administrators) and have no switch, but they appear in the list like any other notification.
NotificationCategory = Literal[
    "training_reminder", "task_deadline", "new_training", "new_match", "new_task",
    "booking_requested", "booking_decided", "review_requested", "training_nudge",
    "payment_update", "earning_update", "withdrawal_update", "finance_admin",
]

NOTIFICATION_CATEGORIES: tuple[PreferenceCategory, ...] = (
    "training_reminder",
    "task_deadline",
    "new_training",
    "new_match",
    "new_task",
    "booking_requested",
    "booking_decided",
    "review_requested",
    "training_nudge",
)


class NotificationPreferenceOut(BaseModel):
    category: PreferenceCategory
    enabled: bool


class NotificationPreferenceIn(BaseModel):
    category: PreferenceCategory
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
