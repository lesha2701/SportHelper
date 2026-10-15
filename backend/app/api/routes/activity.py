from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, Response

from app.api.deps import get_current_user, get_db
from app.services import activity as activity_service

router = APIRouter(prefix="/api/activity", tags=["activity"])


@router.post("", status_code=204, response_class=Response)
async def heartbeat(user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> Response:
    """The signed-in person is using the site. Only authenticated people are ever recorded (a guest has no
    session, so this answers 401), and a banned account is refused by the session check like any other call."""
    await activity_service.touch(conn, user["id"])
    return Response(status_code=204)
