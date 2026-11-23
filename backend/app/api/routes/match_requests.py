"""«Подобрать тренера»: a signed-in person describes what they are looking for; the administrators pick trainers for them.

The author learns from this API only their own requests (the queue and the people behind other requests are the administrators')."""
from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, Request

from app.api.deps import get_current_user, get_db, get_settings_dep
from app.config import Settings
from app.core.exceptions import ConflictError, NotFoundError
from app.repositories import match_requests as repo
from app.schemas.match_requests import MatchRequestIn, MatchRequestOut
from app.services import accounts as svc

router = APIRouter(prefix="/api/match-requests", tags=["match-requests"])

# A few honest forms per hour; more is a flood.
_PER_HOUR = 5


@router.post("", response_model=MatchRequestOut, status_code=201)
async def create_request(
    payload: MatchRequestIn,
    request: Request,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> MatchRequestOut:
    await svc.enforce_rate_limit(request, conn, settings, "match_request", str(user["id"]), limit=_PER_HOUR, window_seconds=3600)
    if await repo.count_open(conn, user["id"]) >= repo.MAX_OPEN_PER_USER:
        raise ConflictError(
            "У вас уже есть заявки на подбор, которые мы ещё не обработали. Дождитесь ответа или отзовите лишнюю заявку.", code="too_many_open"
        )
    return MatchRequestOut(**await repo.create(conn, user["id"], payload.model_dump()))


@router.get("/mine", response_model=list[MatchRequestOut])
async def my_requests(user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> list[MatchRequestOut]:
    return [MatchRequestOut(**row) for row in await repo.list_for_user(conn, user["id"])]


@router.post("/{request_id}/cancel", response_model=MatchRequestOut)
async def cancel_request(
    request_id: UUID, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)
) -> MatchRequestOut:
    try:
        row = await repo.cancel(conn, request_id, user["id"])
    except repo.BadTransition:
        raise ConflictError("Эта заявка уже обработана.", code="bad_transition") from None
    if row is None:
        raise NotFoundError("match request not found")
    return MatchRequestOut(**row)
