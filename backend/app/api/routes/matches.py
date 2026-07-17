from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db
from app.core.exceptions import ForbiddenError, NotFoundError
from app.repositories import matches as matches_repo
from app.repositories import teams as teams_repo
from app.schemas.match import MatchCreateIn, MatchOut, MatchResultIn, MatchRosterIn, MatchUpdateIn, RosterMemberOut
from app.services.notifications import schedule_new_match_notification

router = APIRouter(prefix="/api/matches", tags=["matches"])
team_matches_router = APIRouter(prefix="/api/teams", tags=["matches"])

_COACH_STAFF = {"head_coach", "assistant_coach"}


def _compute_result(match: dict) -> str | None:
    if match["our_score"] is None or match["opponent_score"] is None:
        return None
    if match["our_score"] > match["opponent_score"]:
        return "win"
    if match["our_score"] < match["opponent_score"]:
        return "loss"
    return "draw"


async def _match_out(conn: asyncpg.Connection, match: dict, *, with_roster: bool = True) -> MatchOut:
    roster = await matches_repo.list_roster(conn, match["id"]) if with_roster else []
    return MatchOut(**match, result=_compute_result(match), roster=[RosterMemberOut(**r) for r in roster])


async def _get_match_or_404(conn: asyncpg.Connection, match_id: UUID) -> dict:
    match = await matches_repo.get_match(conn, match_id)
    if match is None:
        raise NotFoundError("match not found")
    return match


async def _check_manage_access(conn: asyncpg.Connection, match: dict, user_id: UUID) -> None:
    member = await teams_repo.get_member(conn, match["team_id"], user_id)
    if member is None or member["role"] not in _COACH_STAFF:
        raise ForbiddenError("only the head coach or an assistant coach can manage matches")


@team_matches_router.post("/{team_id}/matches", response_model=MatchOut)
async def create_match(
    team_id: UUID,
    payload: MatchCreateIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> MatchOut:
    member = await teams_repo.get_member(conn, team_id, user["id"])
    if member is None or member["role"] not in _COACH_STAFF:
        raise ForbiddenError("only the head coach or an assistant coach can create matches")
    match = await matches_repo.create_match(conn, team_id, user["id"], **payload.model_dump())
    await schedule_new_match_notification(conn, match)
    return await _match_out(conn, match)


@team_matches_router.get("/{team_id}/matches", response_model=list[MatchOut])
async def list_team_matches(
    team_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[MatchOut]:
    member = await teams_repo.get_member(conn, team_id, user["id"])
    if member is None:
        raise ForbiddenError("you are not a member of this team")
    matches = await matches_repo.list_team_matches(conn, team_id)
    return [await _match_out(conn, match, with_roster=False) for match in matches]


@router.get("/{match_id}", response_model=MatchOut)
async def get_match(
    match_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> MatchOut:
    match = await _get_match_or_404(conn, match_id)
    member = await teams_repo.get_member(conn, match["team_id"], user["id"])
    if member is None:
        raise ForbiddenError("you do not have access to this match")
    return await _match_out(conn, match)


@router.put("/{match_id}", response_model=MatchOut)
async def update_match(
    match_id: UUID,
    payload: MatchUpdateIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> MatchOut:
    match = await _get_match_or_404(conn, match_id)
    await _check_manage_access(conn, match, user["id"])
    updated = await matches_repo.update_match(conn, match_id, **payload.model_dump())
    if updated is None:
        raise NotFoundError("match not found")
    return await _match_out(conn, updated)


@router.delete("/{match_id}", status_code=204, response_model=None)
async def delete_match(
    match_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    match = await _get_match_or_404(conn, match_id)
    await _check_manage_access(conn, match, user["id"])
    await matches_repo.soft_delete(conn, match_id)


@router.put("/{match_id}/roster", response_model=MatchOut)
async def set_roster(
    match_id: UUID,
    payload: MatchRosterIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> MatchOut:
    match = await _get_match_or_404(conn, match_id)
    await _check_manage_access(conn, match, user["id"])
    for target_user_id in payload.user_ids:
        target_member = await teams_repo.get_member(conn, match["team_id"], target_user_id)
        if target_member is None:
            raise NotFoundError("one of the selected players is not a member of this team")
    await matches_repo.set_roster(conn, match_id, payload.user_ids)
    return await _match_out(conn, match)


@router.post("/{match_id}/result", response_model=MatchOut)
async def set_result(
    match_id: UUID,
    payload: MatchResultIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> MatchOut:
    match = await _get_match_or_404(conn, match_id)
    await _check_manage_access(conn, match, user["id"])
    updated = await matches_repo.set_result(conn, match_id, payload.our_score, payload.opponent_score, payload.comment)
    if updated is None:
        raise NotFoundError("match not found")
    return await _match_out(conn, updated)
