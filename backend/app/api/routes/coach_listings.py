from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db
from app.core.exceptions import APIError, NotFoundError
from app.repositories import coach_listings as listings_repo
from app.repositories import profiles as profiles_repo
from app.schemas.coach_listing import (
    AvailabilityWindowIn,
    AvailabilityWindowOut,
    CoachListingIn,
    CoachListingOut,
)

router = APIRouter(prefix="/api/coach-listings", tags=["coach-listings"])


def _require_coach_profile_error() -> APIError:
    return APIError(
        "create a coach profile before managing listings", code="coach_profile_required", status_code=409
    )


async def _get_owned_listing_or_404(conn: asyncpg.Connection, listing_id: UUID, coach_user_id: UUID) -> dict:
    listing = await listings_repo.get_listing(conn, listing_id)
    if listing is None or listing["coach_user_id"] != coach_user_id:
        raise NotFoundError("listing not found")
    return listing


@router.post("", response_model=CoachListingOut)
async def create_listing(
    payload: CoachListingIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> CoachListingOut:
    if await profiles_repo.get_coach_profile(conn, user["id"]) is None:
        raise _require_coach_profile_error()
    if payload.is_listed:
        # A brand-new listing has no availability windows yet (they can
        # only be added after it exists), so is_listed=true is never valid
        # on creation — same rule PUT enforces once windows can exist.
        raise APIError(
            "set availability before publishing a brand-new listing",
            code="availability_required",
            status_code=409,
        )
    listing = await listings_repo.create_listing(conn, user["id"], title=payload.title)
    updated = await listings_repo.update_listing(conn, listing["id"], user["id"], **payload.model_dump())
    assert updated is not None
    return CoachListingOut(**updated)


@router.get("/me", response_model=list[CoachListingOut])
async def list_my_listings(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[CoachListingOut]:
    listings = await listings_repo.list_for_coach(conn, user["id"])
    return [CoachListingOut(**listing) for listing in listings]


@router.put("/{listing_id}", response_model=CoachListingOut)
async def update_listing(
    listing_id: UUID,
    payload: CoachListingIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> CoachListingOut:
    await _get_owned_listing_or_404(conn, listing_id, user["id"])
    if payload.is_listed:
        availability = await listings_repo.list_availability(conn, listing_id)
        if not availability:
            raise APIError(
                "set at least one availability window before listing",
                code="availability_required",
                status_code=409,
            )
    updated = await listings_repo.update_listing(conn, listing_id, user["id"], **payload.model_dump())
    assert updated is not None
    return CoachListingOut(**updated)


@router.delete("/{listing_id}", status_code=204, response_model=None)
async def delete_listing(
    listing_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    await _get_owned_listing_or_404(conn, listing_id, user["id"])
    if await listings_repo.has_active_booking(conn, listing_id):
        raise APIError(
            "cannot delete a listing with a pending request or an upcoming confirmed booking",
            code="listing_has_active_booking",
            status_code=409,
        )
    deleted = await listings_repo.soft_delete_listing(conn, listing_id, user["id"])
    if not deleted:
        raise NotFoundError("listing not found")


@router.get("/{listing_id}/availability", response_model=list[AvailabilityWindowOut])
async def get_listing_availability(
    listing_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[AvailabilityWindowOut]:
    await _get_owned_listing_or_404(conn, listing_id, user["id"])
    windows = await listings_repo.list_availability(conn, listing_id)
    return [AvailabilityWindowOut(**w) for w in windows]


@router.put("/{listing_id}/availability", response_model=list[AvailabilityWindowOut])
async def replace_listing_availability(
    listing_id: UUID,
    payload: list[AvailabilityWindowIn],
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[AvailabilityWindowOut]:
    await _get_owned_listing_or_404(conn, listing_id, user["id"])
    windows = [w.model_dump() for w in payload]
    if listings_repo.has_overlap(windows):
        raise APIError("availability windows overlap", code="overlapping_availability", status_code=400)
    updated = await listings_repo.replace_availability(conn, listing_id, windows)
    return [AvailabilityWindowOut(**w) for w in updated]
