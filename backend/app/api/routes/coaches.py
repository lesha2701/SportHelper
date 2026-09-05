from __future__ import annotations

from datetime import date
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db
from app.core.exceptions import APIError, NotFoundError
from app.repositories import coach_marketplace as marketplace_repo
from app.repositories import profiles as profiles_repo
from app.schemas.coach_marketplace import (
    AvailabilityWindowIn,
    AvailabilityWindowOut,
    CoachMarketplaceSettingsIn,
    CoachMarketplaceSettingsOut,
)
from app.schemas.coach_search import CoachCardOut, CoachPublicProfileOut, OpenSlotOut

router = APIRouter(prefix="/api/coaches", tags=["coach-marketplace"])


def _require_coach_profile_error() -> APIError:
    return APIError(
        "create a coach profile before configuring marketplace settings",
        code="coach_profile_required",
        status_code=409,
    )


@router.get("/me/marketplace-settings", response_model=CoachMarketplaceSettingsOut)
async def get_my_marketplace_settings(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> CoachMarketplaceSettingsOut:
    if await profiles_repo.get_coach_profile(conn, user["id"]) is None:
        raise _require_coach_profile_error()
    settings = await marketplace_repo.get_settings(conn, user["id"])
    return CoachMarketplaceSettingsOut(**settings)


@router.put("/me/marketplace-settings", response_model=CoachMarketplaceSettingsOut)
async def update_my_marketplace_settings(
    payload: CoachMarketplaceSettingsIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> CoachMarketplaceSettingsOut:
    if await profiles_repo.get_coach_profile(conn, user["id"]) is None:
        raise _require_coach_profile_error()
    updated = await marketplace_repo.upsert_settings(conn, user["id"], **payload.model_dump())
    if updated is None:
        raise _require_coach_profile_error()
    return CoachMarketplaceSettingsOut(**updated)


@router.get("/me/availability", response_model=list[AvailabilityWindowOut])
async def get_my_availability(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[AvailabilityWindowOut]:
    if await profiles_repo.get_coach_profile(conn, user["id"]) is None:
        raise _require_coach_profile_error()
    windows = await marketplace_repo.list_availability(conn, user["id"])
    return [AvailabilityWindowOut(**w) for w in windows]


@router.put("/me/availability", response_model=list[AvailabilityWindowOut])
async def replace_my_availability(
    payload: list[AvailabilityWindowIn],
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[AvailabilityWindowOut]:
    if await profiles_repo.get_coach_profile(conn, user["id"]) is None:
        raise _require_coach_profile_error()
    windows = [w.model_dump() for w in payload]
    if marketplace_repo.has_overlap(windows):
        raise APIError("availability windows overlap", code="overlapping_availability", status_code=400)
    updated = await marketplace_repo.replace_availability(conn, user["id"], windows)
    return [AvailabilityWindowOut(**w) for w in updated]


@router.get("", response_model=list[CoachCardOut])
async def list_coaches(
    sport: str | None = None,
    location: str | None = None,
    max_price=None,
    min_rating: float | None = None,
    format: str | None = None,
    min_experience_years: int | None = None,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[CoachCardOut]:
    cards = await marketplace_repo.list_listed_coaches(
        conn,
        sport=sport,
        location=location,
        max_price=max_price,
        min_rating=min_rating,
        training_format=format,
        min_experience_years=min_experience_years,
    )
    return [CoachCardOut(**c) for c in cards]


@router.get("/{coach_user_id}", response_model=CoachPublicProfileOut)
async def get_coach_public_profile(
    coach_user_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> CoachPublicProfileOut:
    profile = await marketplace_repo.get_public_profile(conn, coach_user_id)
    if profile is None:
        raise NotFoundError("coach not found or not listed")
    return CoachPublicProfileOut(**profile)


@router.get("/{coach_user_id}/slots", response_model=list[OpenSlotOut])
async def get_coach_open_slots(
    coach_user_id: UUID,
    from_date: date,
    to_date: date,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[OpenSlotOut]:
    slots = await marketplace_repo.compute_open_slots(conn, coach_user_id, from_date, to_date)
    return [OpenSlotOut(**s) for s in slots]
