from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db
from app.core.exceptions import APIError
from app.repositories import coach_marketplace as marketplace_repo
from app.repositories import profiles as profiles_repo
from app.schemas.coach_marketplace import (
    AvailabilityWindowIn,
    AvailabilityWindowOut,
    CoachMarketplaceSettingsIn,
    CoachMarketplaceSettingsOut,
)

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
