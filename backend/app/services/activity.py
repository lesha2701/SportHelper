"""Lightweight activity tracking.

The browser sends a heartbeat (POST /api/activity) when a signed-in person opens the site and then only
while they keep interacting with it - not for background polling and not for an idle open tab. Here the
heartbeats are thinned further: a user is written to the database at most once per ACTIVITY_WRITE_INTERVAL
per backend process, so a busy site costs a handful of tiny writes per active person per day, not one per
request. Several tabs or devices simply collapse into the same (user, day) row.
"""
from __future__ import annotations

import time
from uuid import UUID

import asyncpg

from app.repositories import activity as activity_repo

ACTIVITY_WRITE_INTERVAL_SECONDS = 600
_MAX_REMEMBERED_USERS = 20_000

_last_write: dict[UUID, float] = {}


async def touch(conn: asyncpg.Connection, user_id: UUID, *, now: float | None = None) -> bool:
    """Records activity unless this user was already recorded very recently. Returns whether it wrote."""
    moment = time.monotonic() if now is None else now
    previous = _last_write.get(user_id)
    if previous is not None and moment - previous < ACTIVITY_WRITE_INTERVAL_SECONDS:
        return False
    await activity_repo.record(conn, user_id)
    _remember(user_id, moment)
    return True


def _remember(user_id: UUID, moment: float) -> None:
    if len(_last_write) >= _MAX_REMEMBERED_USERS:
        cutoff = moment - ACTIVITY_WRITE_INTERVAL_SECONDS
        for key in [k for k, v in _last_write.items() if v < cutoff]:
            del _last_write[key]
        if len(_last_write) >= _MAX_REMEMBERED_USERS:  # everyone is recent: start over rather than grow without bound
            _last_write.clear()
    _last_write[user_id] = moment


def forget_all() -> None:
    """Test hook / settings reload."""
    _last_write.clear()
