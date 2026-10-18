from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db, get_settings_dep, is_admin
from app.config import Settings
from app.core.exceptions import APIError
from app.repositories import profiles as profiles_repo
from app.repositories import users as users_repo
from app.schemas.profile import (
    ActiveModeIn,
    CoachProfileIn,
    CoachProfileOut,
    PlayerProfileIn,
    PlayerProfileOut,
    ProfileMeOut,
)

router = APIRouter(prefix="/api/profile", tags=["profile"])

_ROLE_LOCKED = "Роль выбирается при регистрации и не меняется."


async def _check_role(conn: asyncpg.Connection, user: dict, role: str, settings: Settings) -> None:
    """A user works in the one role chosen at registration; only administrators (the e-mails in ADMIN_EMAILS) can use both.
    An account that predates the rule and has no role yet takes the first one it uses."""
    if is_admin(user, settings):
        return
    current = user.get("preferred_role")
    if current is None:
        await users_repo.set_preferred_role(conn, user["id"], role)
    elif current != role:
        raise APIError(_ROLE_LOCKED, code="role_locked", status_code=403)


@router.get("/me", response_model=ProfileMeOut)
async def get_my_profiles(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> ProfileMeOut:
    player = await profiles_repo.get_player_profile(conn, user["id"])
    coach = await profiles_repo.get_coach_profile(conn, user["id"])
    return ProfileMeOut(
        active_mode=user["active_mode"],
        player=PlayerProfileOut(**player) if player else None,
        coach=CoachProfileOut(**coach) if coach else None,
    )


@router.put("/player", response_model=PlayerProfileOut)
async def upsert_player_profile(
    payload: PlayerProfileIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> PlayerProfileOut:
    await _check_role(conn, user, "player", settings)
    profile = await profiles_repo.upsert_player_profile(conn, user["id"], **payload.model_dump())

    if user["active_mode"] is None:
        await users_repo.set_active_mode(conn, user["id"], "player")

    return PlayerProfileOut(**profile)


@router.put("/coach", response_model=CoachProfileOut)
async def upsert_coach_profile(
    payload: CoachProfileIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> CoachProfileOut:
    await _check_role(conn, user, "coach", settings)
    profile = await profiles_repo.upsert_coach_profile(conn, user["id"], **payload.model_dump())

    if user["active_mode"] is None:
        await users_repo.set_active_mode(conn, user["id"], "coach")

    return CoachProfileOut(**profile)


@router.post("/active-mode", response_model=ProfileMeOut)
async def switch_active_mode(
    payload: ActiveModeIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> ProfileMeOut:
    role = user.get("preferred_role")
    if role is not None and role != payload.mode and not is_admin(user, settings):
        raise APIError(_ROLE_LOCKED, code="role_locked", status_code=403)
    player = await profiles_repo.get_player_profile(conn, user["id"])
    coach = await profiles_repo.get_coach_profile(conn, user["id"])

    if payload.mode == "player" and player is None:
        raise APIError(
            "player profile does not exist yet, create it before switching to it",
            code="profile_required",
            status_code=409,
        )
    if payload.mode == "coach" and coach is None:
        raise APIError(
            "coach profile does not exist yet, create it before switching to it",
            code="profile_required",
            status_code=409,
        )

    await users_repo.set_active_mode(conn, user["id"], payload.mode)

    return ProfileMeOut(
        active_mode=payload.mode,
        player=PlayerProfileOut(**player) if player else None,
        coach=CoachProfileOut(**coach) if coach else None,
    )
