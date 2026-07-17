from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db, get_settings_dep
from app.config import Settings
from app.core.exceptions import APIError, ForbiddenError, NotFoundError
from app.repositories import profiles as profiles_repo
from app.repositories import teams as teams_repo
from app.repositories import users as users_repo
from app.schemas.profile import PlayerProfileOut
from app.schemas.team import (
    ApplyResultOut,
    InviteCreateIn,
    InviteOut,
    JoinRequestOut,
    MemberUpdateIn,
    TeamIn,
    TeamMemberOut,
    TeamOut,
    TransferOwnershipIn,
)

router = APIRouter(prefix="/api/teams", tags=["teams"])
invites_router = APIRouter(prefix="/api/invites", tags=["invites"])

_COACH_STAFF = {"head_coach", "assistant_coach"}


async def _get_team_or_404(conn: asyncpg.Connection, team_id: UUID) -> dict:
    team = await teams_repo.get_team(conn, team_id)
    if team is None:
        raise NotFoundError("team not found")
    return team


async def _get_membership_or_403(conn: asyncpg.Connection, team_id: UUID, user_id: UUID) -> dict:
    member = await teams_repo.get_member(conn, team_id, user_id)
    if member is None:
        raise ForbiddenError("you are not a member of this team")
    return member


def _team_out(team: dict, *, my_role: str | None = None, members_count: int = 0) -> TeamOut:
    base = {k: v for k, v in team.items() if k not in ("my_role", "members_count")}
    return TeamOut(
        **base,
        my_role=team.get("my_role", my_role),
        members_count=team.get("members_count", members_count),
    )


def _invite_link(settings: Settings, token: str) -> str:
    if not settings.telegram_bot_username:
        return f"{settings.mini_app_url}?invite={token}"
    return f"https://t.me/{settings.telegram_bot_username}?start=invite_{token}"


@router.post("", response_model=TeamOut)
async def create_team(
    payload: TeamIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> TeamOut:
    coach_profile = await profiles_repo.get_coach_profile(conn, user["id"])
    if coach_profile is None:
        raise APIError(
            "create a coach profile before creating a team",
            code="coach_profile_required",
            status_code=409,
        )
    team = await teams_repo.create_team(conn, user["id"], payload.model_dump())
    return _team_out(team, my_role="head_coach", members_count=1)


@router.get("/mine", response_model=list[TeamOut])
async def list_my_teams(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[TeamOut]:
    teams = await teams_repo.list_my_teams(conn, user["id"])
    return [_team_out(team) for team in teams]


@router.get("/{team_id}", response_model=TeamOut)
async def get_team(
    team_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> TeamOut:
    team = await _get_team_or_404(conn, team_id)
    member = await _get_membership_or_403(conn, team_id, user["id"])
    members_count = await teams_repo.count_members(conn, team_id)
    return _team_out(team, my_role=member["role"], members_count=members_count)


@router.put("/{team_id}", response_model=TeamOut)
async def update_team(
    team_id: UUID,
    payload: TeamIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> TeamOut:
    await _get_team_or_404(conn, team_id)
    member = await _get_membership_or_403(conn, team_id, user["id"])
    if member["role"] not in _COACH_STAFF:
        raise ForbiddenError("only the head coach or an assistant coach can edit the team")
    team = await teams_repo.update_team(conn, team_id, payload.model_dump())
    members_count = await teams_repo.count_members(conn, team_id)
    return _team_out(team, my_role=member["role"], members_count=members_count)


@router.get("/{team_id}/members", response_model=list[TeamMemberOut])
async def list_members(
    team_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[TeamMemberOut]:
    await _get_team_or_404(conn, team_id)
    await _get_membership_or_403(conn, team_id, user["id"])
    members = await teams_repo.list_members(conn, team_id)
    return [TeamMemberOut(**m) for m in members]


@router.get("/{team_id}/members/{target_user_id}/profile", response_model=PlayerProfileOut)
async def get_member_player_profile(
    team_id: UUID,
    target_user_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> PlayerProfileOut:
    actor = await _get_membership_or_403(conn, team_id, user["id"])
    if actor["role"] not in _COACH_STAFF:
        raise ForbiddenError("only the head coach or an assistant coach can view player profiles")
    target_member = await teams_repo.get_member(conn, team_id, target_user_id)
    if target_member is None:
        raise NotFoundError("member not found")
    profile = await profiles_repo.get_player_profile(conn, target_user_id)
    if profile is None:
        raise NotFoundError("this member has not filled in a player profile yet")
    return PlayerProfileOut(**profile)


@router.patch("/{team_id}/members/{target_user_id}", response_model=TeamMemberOut)
async def update_member(
    team_id: UUID,
    target_user_id: UUID,
    payload: MemberUpdateIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> TeamMemberOut:
    await _get_team_or_404(conn, team_id)
    actor = await _get_membership_or_403(conn, team_id, user["id"])
    target = await teams_repo.get_member(conn, team_id, target_user_id)
    if target is None:
        raise NotFoundError("this user is not a member of the team")

    if actor["role"] not in _COACH_STAFF:
        raise ForbiddenError("only the head coach or an assistant coach can manage the roster")

    role = payload.role
    if role == "assistant_coach" or target["role"] == "assistant_coach":
        # Promoting to, or demoting from, assistant coach is a head-coach-only decision.
        if actor["role"] != "head_coach":
            raise ForbiddenError("only the head coach can manage assistant coaches")

    position_set = "position" in payload.model_fields_set

    try:
        await teams_repo.update_member(
            conn, team_id, target_user_id, role=role, position=payload.position, position_set=position_set
        )
    except asyncpg.UniqueViolationError as exc:
        raise APIError(
            "the team already has a captain", code="captain_already_assigned", status_code=409
        ) from exc

    member = await teams_repo.get_member_detail(conn, team_id, target_user_id)
    return TeamMemberOut(**member)


@router.delete("/{team_id}/members/{target_user_id}", status_code=204, response_model=None)
async def remove_member(
    team_id: UUID,
    target_user_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    await _get_team_or_404(conn, team_id)
    actor = await _get_membership_or_403(conn, team_id, user["id"])
    target = await teams_repo.get_member(conn, team_id, target_user_id)
    if target is None:
        return

    if actor["role"] not in _COACH_STAFF:
        raise ForbiddenError("only the head coach or an assistant coach can manage the roster")
    if target["role"] == "head_coach":
        raise ForbiddenError("the head coach cannot be removed; use transfer ownership or leave instead")
    if target["role"] == "assistant_coach" and actor["role"] != "head_coach":
        raise ForbiddenError("only the head coach can remove an assistant coach")

    await teams_repo.remove_member(conn, team_id, target_user_id)


@router.post("/{team_id}/members/{target_user_id}/block", status_code=204, response_model=None)
async def block_member(
    team_id: UUID,
    target_user_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    await _get_team_or_404(conn, team_id)
    actor = await _get_membership_or_403(conn, team_id, user["id"])
    if actor["role"] != "head_coach":
        raise ForbiddenError("only the head coach can block a user from rejoining")
    if target_user_id == user["id"]:
        raise APIError("you cannot block yourself", code="bad_request", status_code=400)

    await teams_repo.block_member(conn, team_id, target_user_id, user["id"])


@router.post("/{team_id}/leave", status_code=204, response_model=None)
async def leave_team(
    team_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    await _get_team_or_404(conn, team_id)
    role = await teams_repo.leave_team(conn, team_id, user["id"])
    if role is None:
        raise ForbiddenError("you are not a member of this team")


@router.post("/{team_id}/transfer-ownership", status_code=204, response_model=None)
async def transfer_ownership(
    team_id: UUID,
    payload: TransferOwnershipIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    team = await _get_team_or_404(conn, team_id)
    actor = await _get_membership_or_403(conn, team_id, user["id"])
    if actor["role"] != "head_coach":
        raise ForbiddenError("only the head coach can transfer their role")

    target = await teams_repo.get_member(conn, team_id, payload.to_user_id)
    if target is None:
        raise NotFoundError("the chosen user is not a member of the team")

    target_user = await users_repo.get_by_id(conn, payload.to_user_id)
    target_last_name = target_user["last_name"] or ""
    expected_phrase = (
        f"Я передаю роль основного тренера команды «{team['name']}» "
        f"пользователю {target_user['first_name']} {target_last_name}".strip()
    )
    if payload.confirmation_phrase.strip() != expected_phrase:
        raise APIError(
            "confirmation phrase does not match",
            code="confirmation_mismatch",
            status_code=400,
        )

    await teams_repo.transfer_ownership(conn, team_id, user["id"], payload.to_user_id)


@router.post("/{team_id}/invites", response_model=InviteOut)
async def create_invite(
    team_id: UUID,
    payload: InviteCreateIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> InviteOut:
    team = await _get_team_or_404(conn, team_id)
    actor = await _get_membership_or_403(conn, team_id, user["id"])

    if payload.kind == "join":
        if actor["role"] not in _COACH_STAFF:
            raise ForbiddenError("only the head coach or an assistant coach can invite players")
    else:
        if actor["role"] != "captain":
            raise ForbiddenError("only the captain can invite a new head coach")
        if team["status"] != "without_coach":
            raise APIError(
                "the team already has a head coach", code="team_has_coach", status_code=409
            )

    invite = await teams_repo.create_invite(
        conn, team_id, user["id"], payload.kind, settings.invite_expiration_hours
    )
    return InviteOut(**invite, link=_invite_link(settings, invite["token"]))


@router.get("/{team_id}/invites", response_model=list[InviteOut])
async def list_invites(
    team_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> list[InviteOut]:
    await _get_team_or_404(conn, team_id)
    actor = await _get_membership_or_403(conn, team_id, user["id"])
    if actor["role"] not in _COACH_STAFF | {"captain"}:
        raise ForbiddenError("only coaching staff or the captain can view invites")

    invites = await teams_repo.list_invites(conn, team_id)
    return [InviteOut(**invite, link=_invite_link(settings, invite["token"])) for invite in invites]


@router.get("/{team_id}/applications", response_model=list[JoinRequestOut])
async def list_applications(
    team_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[JoinRequestOut]:
    await _get_team_or_404(conn, team_id)
    actor = await _get_membership_or_403(conn, team_id, user["id"])
    if actor["role"] not in _COACH_STAFF:
        raise ForbiddenError("only the head coach or an assistant coach can review applications")

    requests = await teams_repo.list_pending_requests(conn, team_id)
    return [JoinRequestOut(**r) for r in requests]


@router.post("/{team_id}/applications/{request_id}/accept", status_code=204, response_model=None)
async def accept_application(
    team_id: UUID,
    request_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    await _get_team_or_404(conn, team_id)
    actor = await _get_membership_or_403(conn, team_id, user["id"])
    if actor["role"] not in _COACH_STAFF:
        raise ForbiddenError("only the head coach or an assistant coach can review applications")

    request = await teams_repo.get_request(conn, team_id, request_id)
    if request is None or request["status"] != "pending":
        raise NotFoundError("no pending application with this id")

    try:
        await teams_repo.accept_request(conn, request_id, team_id, request["user_id"], user["id"])
    except asyncpg.CheckViolationError as exc:
        raise APIError("the team is full (50 members max)", code="team_full", status_code=409) from exc


@router.post("/{team_id}/applications/{request_id}/reject", status_code=204, response_model=None)
async def reject_application(
    team_id: UUID,
    request_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    await _get_team_or_404(conn, team_id)
    actor = await _get_membership_or_403(conn, team_id, user["id"])
    if actor["role"] not in _COACH_STAFF:
        raise ForbiddenError("only the head coach or an assistant coach can review applications")

    request = await teams_repo.get_request(conn, team_id, request_id)
    if request is None or request["status"] != "pending":
        raise NotFoundError("no pending application with this id")

    await teams_repo.reject_request(conn, request_id, user["id"])


@invites_router.get("/{token}", response_model=TeamOut)
async def preview_invite(
    token: str,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> TeamOut:
    invite = await teams_repo.get_invite_by_token(conn, token)
    if invite is None:
        raise NotFoundError("invite not found")
    if invite["expires_at"] < datetime.now(timezone.utc):
        raise APIError("this invite link has expired", code="invite_expired", status_code=410)

    team = await _get_team_or_404(conn, invite["team_id"])
    members_count = await teams_repo.count_members(conn, team["id"])
    member = await teams_repo.get_member(conn, team["id"], user["id"])
    return _team_out(team, my_role=member["role"] if member else None, members_count=members_count)


@invites_router.post("/{token}/apply", response_model=ApplyResultOut)
async def apply_via_invite(
    token: str,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> ApplyResultOut:
    invite = await teams_repo.get_invite_by_token(conn, token)
    if invite is None:
        raise NotFoundError("invite not found")
    if invite["expires_at"] < datetime.now(timezone.utc):
        raise APIError("this invite link has expired", code="invite_expired", status_code=410)

    team = await _get_team_or_404(conn, invite["team_id"])

    if invite["kind"] == "head_coach":
        if team["status"] != "without_coach":
            raise APIError(
                "the team already has a head coach", code="team_has_coach", status_code=409
            )
        await teams_repo.promote_to_head_coach(conn, team["id"], user["id"])
        team = await teams_repo.get_team(conn, team["id"])
        return ApplyResultOut(status="joined", team=_team_out(team, my_role="head_coach"))

    existing_member = await teams_repo.get_member(conn, team["id"], user["id"])
    if existing_member is not None:
        raise APIError("you are already a member of this team", code="already_member", status_code=409)

    if await teams_repo.is_blocked(conn, team["id"], user["id"]):
        raise ForbiddenError("you have been blocked from rejoining this team")

    pending = await teams_repo.get_pending_request(conn, team["id"], user["id"])
    if pending is None:
        await teams_repo.create_join_request(conn, team["id"], user["id"], invite["id"])

    return ApplyResultOut(status="pending", team=_team_out(team))
