"""«Подобрать тренера»: a signed-in person describes what they are looking for; the administrators pick trainers for them.

The author learns from this API only their own requests (the queue and the people behind other requests are the administrators')."""
from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, Request

from app.api.deps import get_current_user, get_db, get_settings_dep
from app.config import Settings
from app.core.exceptions import ConflictError, NotFoundError
from app.repositories import match_offers as offers_repo
from app.repositories import match_requests as repo
from app.schemas.match_requests import MatchRequestIn, MatchRequestOut
from app.services import accounts as svc
from app.services import match_offers as offers_svc

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
    return MatchRequestOut(**await repo.create(conn, user["id"], payload.model_dump()), offers=[])


@router.get("/mine", response_model=list[MatchRequestOut])
async def my_requests(user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> list[MatchRequestOut]:
    return await offers_svc.athlete_requests_out(conn, await repo.list_for_user(conn, user["id"]))


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
    return MatchRequestOut(**row, offers=[])


async def _own_request(conn: asyncpg.Connection, request_id: UUID, user_id: UUID) -> MatchRequestOut:
    rows = [r for r in await repo.list_for_user(conn, user_id) if r["id"] == request_id]
    return (await offers_svc.athlete_requests_out(conn, rows))[0]


async def _athlete_answer(conn: asyncpg.Connection, user: dict, offer_id: UUID, *, accept: bool, settings: Settings) -> MatchRequestOut:
    try:
        offer = await offers_repo.athlete_answer(conn, offer_id, user["id"], accept=accept, attribution_days=settings.match_attribution_days)
    except offers_repo.OfferClosed as exc:
        text = "Время выбора вышло." if exc.status == "expired" else "Этот тренер уже недоступен или вы уже ответили."
        raise ConflictError(text, code="offer_closed") from None
    if offer is None:
        raise NotFoundError("offer not found")
    return await _own_request(conn, offer["request_id"], user["id"])


@router.post("/offers/{offer_id}/accept", response_model=MatchRequestOut)
async def accept_offer(
    offer_id: UUID, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db), settings: Settings = Depends(get_settings_dep)
) -> MatchRequestOut:
    """The athlete chooses this trainer; the request becomes «matched» and the other offers are taken back."""
    return await _athlete_answer(conn, user, offer_id, accept=True, settings=settings)


@router.post("/offers/{offer_id}/decline", response_model=MatchRequestOut)
async def decline_offer(
    offer_id: UUID, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db), settings: Settings = Depends(get_settings_dep)
) -> MatchRequestOut:
    """The athlete does not want this trainer; the request stays with the administrators."""
    return await _athlete_answer(conn, user, offer_id, accept=False, settings=settings)
