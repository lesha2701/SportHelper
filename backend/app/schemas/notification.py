from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

NotificationCategory = Literal["training_reminder", "task_deadline", "new_training", "new_match", "new_task"]

NOTIFICATION_CATEGORIES: tuple[NotificationCategory, ...] = (
    "training_reminder",
    "task_deadline",
    "new_training",
    "new_match",
    "new_task",
)


class NotificationPreferenceOut(BaseModel):
    category: NotificationCategory
    enabled: bool


class NotificationPreferenceIn(BaseModel):
    category: NotificationCategory
    enabled: bool


class NotificationPreferencesUpdateIn(BaseModel):
    preferences: list[NotificationPreferenceIn]
