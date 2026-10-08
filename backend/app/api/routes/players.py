from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db
from app.core.exceptions import ForbiddenError, NotFoundError
from app.repositories import bookings as bookings_repo
from app.repositories import player_reviews as player_reviews_repo
from app.repositories import profiles as profiles_repo
from app.repositories import teams as teams_repo
from app.schemas.booking import PlayerReviewOut, PlayerReviewsOut
from app.schemas.player import PlayerPublicProfileOut

router = APIRouter(prefix="/api/players", tags=["players"])


@router.get("/{player_user_id}/profile", response_model=PlayerPublicProfileOut)
async def get_player_public_profile(
    player_user_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> PlayerPublicProfileOut:
    if user["id"] != player_user_id:
        # Either a coach who shares a team with this player (same rule as
        # player stats), or a coach who has ever had a marketplace booking
        # with them — reviewing a pending request, or looking back at one
        # already accepted in "Записи", both need this.
        allowed = await teams_repo.shares_team_as_coach(conn, user["id"], player_user_id)
        if not allowed:
            allowed = await bookings_repo.has_booking_between(conn, user["id"], player_user_id)
        if not allowed:
            raise ForbiddenError("you do not have access to this player's profile")

    profile = await profiles_repo.get_public_player_profile(conn, player_user_id)
    if profile is None:
        raise NotFoundError("player not found")
    return PlayerPublicProfileOut(**profile)


@router.get("/{player_user_id}/reviews", response_model=PlayerReviewsOut)
async def get_player_reviews(
    player_user_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> PlayerReviewsOut:
    """What coaches wrote about this player after training them — for other
    coaches deciding on a request. Only a coach who has a booking with this
    player (any status, same as their public profile) may read it; teammates,
    other players and the player themself get 403."""
    if user["id"] == player_user_id or not await bookings_repo.has_booking_between(conn, user["id"], player_user_id):
        raise ForbiddenError("only coaches with a booking with this player can see their reviews")
    summary = await player_reviews_repo.get_rating_summary(conn, player_user_id)
    rows = await player_reviews_repo.list_recent_for_player(conn, player_user_id)
    return PlayerReviewsOut(
        average=summary["average"],
        count=summary["count"],
        reviews=[PlayerReviewOut(**row) for row in rows],
    )
