"""Delivers a notification as a push to every phone its recipient has signed in on (docs/push.md)."""
from __future__ import annotations

import logging
from typing import Any

import asyncpg

from app.config import Settings
from app.integrations.push import PushMessage, PushSender
from app.repositories import push_devices as push_devices_repo

logger = logging.getLogger("teamflow.push")

_cached: tuple[Settings, PushSender] | None = None


def get_sender(settings: Settings) -> PushSender:
    """One sender per settings object, so the signed tokens are reused instead of re-signed for every notification."""
    global _cached
    if _cached is None or _cached[0] is not settings:
        _cached = (settings, PushSender(settings))
    return _cached[1]


def message_for(notification: dict[str, Any]) -> PushMessage:
    """What the app needs to open the right screen: the same pair the Telegram button and the site's deep link carry."""
    return PushMessage(
        title=notification["title"],
        body=notification["body"],
        data={
            "notification_id": str(notification["id"]),
            "category": str(notification["category"]),
            "entity_type": str(notification["entity_type"]),
            "entity_id": str(notification["entity_id"]),
        },
    )


async def push_notification(
    conn: asyncpg.Connection, notification: dict[str, Any], settings: Settings, sender: PushSender | None = None
) -> int:
    """Best effort, never raises. Returns how many phones were reached."""
    sender = sender or get_sender(settings)
    if not sender.any_configured:
        return 0
    try:
        devices = await push_devices_repo.list_for_user(conn, notification["user_id"])
    except Exception:  # noqa: BLE001 - the notification is already safe in the bell
        logger.exception("Could not list the devices of user %s", notification["user_id"])
        return 0
    message = message_for(notification)
    reached = 0
    for device in devices:
        if not sender.configured_for(device["platform"]):
            continue
        outcome = await sender.send(device["platform"], device["token"], message)
        if outcome == "sent":
            reached += 1
        elif outcome == "dead":
            try:
                await push_devices_repo.delete_by_token(conn, device["token"])
            except Exception:  # noqa: BLE001
                logger.exception("Could not forget a dead push token")
    return reached
