from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db
from app.core.exceptions import NotFoundError
from app.repositories import coach_listings as listings_repo
from app.repositories import coach_reviews as coach_reviews_repo
from app.repositories import profiles as profiles_repo
from app.schemas.coach import CoachPublicProfileOut
from app.schemas.coach_listing import CoachListingCardOut, CoachReviewOut

router = APIRouter(prefix="/api/coaches", tags=["coaches"])


@router.get("/{coach_user_id}/profile", response_model=CoachPublicProfileOut)
async def get_coach_public_profile(
    coach_user_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> CoachPublicProfileOut:
    profile = await profiles_repo.get_public_coach_profile(conn, coach_user_id)
    if profile is None:
        raise NotFoundError("coach not found")
    rating = await coach_reviews_repo.get_rating_summary(conn, coach_user_id)
    return CoachPublicProfileOut(**profile, average_rating=rating["average"], review_count=rating["count"])


@router.get("/{coach_user_id}/listings", response_model=list[CoachListingCardOut])
async def list_coach_public_listings(
    coach_user_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[CoachListingCardOut]:
    listings = await listings_repo.list_listed_for_coach(conn, coach_user_id)
    return [CoachListingCardOut(**listing) for listing in listings]


@router.get("/{coach_user_id}/reviews", response_model=list[CoachReviewOut])
async def list_coach_public_reviews(
    coach_user_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[CoachReviewOut]:
    reviews = await coach_reviews_repo.list_recent_for_coach(conn, coach_user_id, limit=50)
    return [CoachReviewOut(**review) for review in reviews]
