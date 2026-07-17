from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db
from app.repositories import notifications as notifications_repo
from app.schemas.notification import (
    NOTIFICATION_CATEGORIES,
    NotificationPreferenceOut,
    NotificationPreferencesUpdateIn,
)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


async def _current_preferences(conn: asyncpg.Connection, user_id: UUID) -> list[NotificationPreferenceOut]:
    rows = await notifications_repo.list_preferences(conn, user_id)
    overrides = {row["category"]: row["enabled"] for row in rows}
    return [
        NotificationPreferenceOut(category=category, enabled=overrides.get(category, True))
        for category in NOTIFICATION_CATEGORIES
    ]


@router.get("/preferences", response_model=list[NotificationPreferenceOut])
async def get_preferences(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[NotificationPreferenceOut]:
    return await _current_preferences(conn, user["id"])


@router.put("/preferences", response_model=list[NotificationPreferenceOut])
async def set_preferences(
    payload: NotificationPreferencesUpdateIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[NotificationPreferenceOut]:
    for pref in payload.preferences:
        await notifications_repo.set_preference(conn, user["id"], pref.category, pref.enabled)
    return await _current_preferences(conn, user["id"])
