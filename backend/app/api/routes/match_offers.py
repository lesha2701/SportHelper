"""«Подобрать тренера», the trainer's side: consent to be recommended and answers to the offers the administrators make.

A trainer sees the request without the athlete's name or contacts; those open after the athlete chose and paid (stage 3)."""
from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db, get_settings_dep
from app.config import Settings
from app.core.exceptions import APIError, ConflictError, NotFoundError
from app.repositories import match_offers as repo
from app.repositories import profiles as profiles_repo
from app.schemas.match_offers import CoachOfferOut, DeclineOfferIn, MatchOfferSettingsIn, MatchOfferSettingsOut
from app.services import commission as commission_service
from app.services import match_offers as svc
from app.services import notifications as notifications_service

router = APIRouter(prefix="/api/match-offers", tags=["match-offers"])


async def _coach(conn: asyncpg.Connection, user: dict) -> dict:
    settings = await repo.get_settings(conn, user["id"])
    if settings is None:
        raise APIError("create a coach profile first", code="coach_profile_required", status_code=409)
    return settings


async def _settings_out(conn: asyncpg.Connection, row: dict, config: Settings) -> MatchOfferSettingsOut:
    percent = await commission_service.first_session_percent(conn, config)  # what a new offer would carry
    accepted = row["match_terms_version"] == svc.TERMS_VERSION
    return MatchOfferSettingsOut(
        enabled=bool(row["accepts_match_offers"] and accepted),
        accepted_version=row["match_terms_version"],
        current_version=svc.TERMS_VERSION,
        terms_accepted=accepted,
        first_session_percent=float(percent),
        terms_title=svc.TERMS_TITLE,
        terms=svc.terms_paragraphs(percent, config.match_attribution_days),
    )


@router.get("/settings", response_model=MatchOfferSettingsOut)
async def get_settings(
    user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db), config: Settings = Depends(get_settings_dep)
) -> MatchOfferSettingsOut:
    return await _settings_out(conn, await _coach(conn, user), config)


@router.put("/settings", response_model=MatchOfferSettingsOut)
async def put_settings(
    payload: MatchOfferSettingsIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    config: Settings = Depends(get_settings_dep),
) -> MatchOfferSettingsOut:
    await _coach(conn, user)
    if payload.enabled and payload.accept_terms_version != svc.TERMS_VERSION:
        raise ConflictError("Условия подбора обновились. Прочитайте их и примите заново.", code="terms_required")
    await repo.set_settings(conn, user["id"], enabled=payload.enabled, terms_version=payload.accept_terms_version if payload.enabled else None)
    return await _settings_out(conn, await _coach(conn, user), config)


@router.get("/incoming", response_model=list[CoachOfferOut])
async def incoming(user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> list[CoachOfferOut]:
    await _coach(conn, user)
    return [svc.coach_offer_out(r) for r in await repo.list_for_coach(conn, user["id"])]


def _closed(exc: repo.OfferClosed) -> ConflictError:
    text = {
        "expired": "Время ответа вышло.",
        "withdrawn": "Это предложение уже закрыто: клиента взял другой тренер или заявка закрыта.",
    }.get(exc.status, "Вы уже ответили на это предложение.")
    return ConflictError(text, code="offer_closed")


async def _answer(conn: asyncpg.Connection, user: dict, offer_id: UUID, config: Settings, *, accept: bool, reason: str | None) -> CoachOfferOut:
    await _coach(conn, user)
    try:
        offer = await repo.coach_answer(
            conn, offer_id, user["id"], accept=accept, reason=reason, athlete_hours=config.match_athlete_reply_hours, terms_version=svc.TERMS_VERSION
        )
    except repo.OfferClosed as exc:
        raise _closed(exc) from None
    except repo.NotEligible:
        raise ConflictError(
            "Принять сейчас нельзя: включите подбор и примите условия или спортсмен стал недоступен.", code="not_available"
        ) from None
    if offer is None:
        raise NotFoundError("offer not found")
    if accept:
        profile = await profiles_repo.get_coach_profile(conn, user["id"])
        await notifications_service.schedule_match_offer_reply_notification(conn, offer, (profile or {}).get("full_name") or user["first_name"])
    row = next((r for r in await repo.list_for_coach(conn, user["id"]) if r["id"] == offer_id), None)
    return svc.coach_offer_out(row)


@router.post("/{offer_id}/accept", response_model=CoachOfferOut)
async def accept_offer(
    offer_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    config: Settings = Depends(get_settings_dep),
) -> CoachOfferOut:
    return await _answer(conn, user, offer_id, config, accept=True, reason=None)


@router.post("/{offer_id}/decline", response_model=CoachOfferOut)
async def decline_offer(
    offer_id: UUID,
    payload: DeclineOfferIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    config: Settings = Depends(get_settings_dep),
) -> CoachOfferOut:
    return await _answer(conn, user, offer_id, config, accept=False, reason=payload.reason)
