from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

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
