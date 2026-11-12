from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db
from app.repositories import push_devices as push_devices_repo
from app.schemas.push import PushDeviceIn, PushDeviceRemoveIn

router = APIRouter(prefix="/api/devices", tags=["devices"])


@router.put("", status_code=204, response_model=None)
async def register_device(
    payload: PushDeviceIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    """The app calls this after sign-in and whenever the system gives it a new token (idempotent)."""
    await push_devices_repo.register(
        conn, user_id=user["id"], platform=payload.platform, token=payload.token, app_version=payload.app_version
    )


@router.post("/remove", status_code=204, response_model=None)
async def remove_device(
    payload: PushDeviceRemoveIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    """The app calls this on sign-out, before the session ends, so that a person who left does not keep getting pushes on this phone."""
    await push_devices_repo.unregister(conn, user_id=user["id"], token=payload.token)
