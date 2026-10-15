"""Complaints: any signed-in user can report a profile, a listing or a public photo/video.

What a user can learn from this API is limited to "your complaint was received": the complaint list, its status
and the administrators' decisions are visible to administrators only."""
from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, Request

from app.api.deps import get_current_user, get_db, get_settings_dep
from app.config import Settings
from app.core.exceptions import APIError, ConflictError, NotFoundError
from app.repositories import complaints as complaints_repo
from app.schemas.admin import ComplaintCreatedOut, ComplaintIn
from app.services import accounts as svc

router = APIRouter(prefix="/api/complaints", tags=["complaints"])

# 10 complaints per hour per person: plenty for honest use, useless for flooding the moderators.
_PER_HOUR = 10


@router.post("", response_model=ComplaintCreatedOut, status_code=201)
async def create_complaint(
    payload: ComplaintIn,
    request: Request,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> ComplaintCreatedOut:
    await svc.enforce_rate_limit(request, conn, settings, "complaint", str(user["id"]), limit=_PER_HOUR, window_seconds=3600)
    owner = await complaints_repo.resolve_target(conn, payload.target_type, payload.target_id)
    if owner is None:
        raise NotFoundError("Объект жалобы не найден.", code="target_not_found")
    if owner == user["id"]:
        raise APIError("Нельзя пожаловаться на себя или на своё.", code="cannot_report_self", status_code=400)
    if await complaints_repo.count_open(conn, user["id"]) >= complaints_repo.MAX_OPEN_PER_REPORTER:
        raise ConflictError("У вас слишком много нерассмотренных жалоб. Дождитесь решения по прежним.", code="too_many_open")
    try:
        created = await complaints_repo.create(
            conn,
            reporter_id=user["id"],
            target_type=payload.target_type,
            target_id=payload.target_id,
            target_user_id=owner,
            reason=payload.reason,
            comment=payload.comment,
        )
    except complaints_repo.Duplicate:
        raise ConflictError("Вы уже отправили жалобу на это — мы её рассматриваем.", code="already_reported") from None
    return ComplaintCreatedOut(id=created["id"], status=created["status"])
