"""Support: any signed-in person can write to the administrators and read the answer.

What the author learns from this API is their own requests and the answers to them; the queue, the other people's
requests and who handles what are the administrators' (see admin_support)."""
from __future__ import annotations

import asyncpg
from uuid import UUID

from fastapi import APIRouter, Depends, Request

from app.api.deps import get_current_user, get_db, get_settings_dep
from app.config import Settings
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.repositories import profiles as profiles_repo
from app.repositories import support as support_repo
from app.schemas.support import MySupportRequestOut, SupportCreatedOut, SupportReplyIn, SupportRequestIn
from app.services import accounts as svc

router = APIRouter(prefix="/api/support", tags=["support"])

# 5 requests per hour per person: plenty for honest use, useless for flooding the administrators.
_PER_HOUR = 5
# Replies are cheaper than new requests, but not free.
_REPLIES_PER_HOUR = 20


@router.post("", response_model=SupportCreatedOut, status_code=201)
async def create_request(
    payload: SupportRequestIn,
    request: Request,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> SupportCreatedOut:
    if payload.kind == "venue_search" and not await profiles_repo.get_coach_profile(conn, user["id"]):
        raise ForbiddenError("Заявку на подбор зала может отправить только тренер.", code="coach_required")
    await svc.enforce_rate_limit(request, conn, settings, "support", str(user["id"]), limit=_PER_HOUR, window_seconds=3600)
    if await support_repo.count_open(conn, user["id"]) >= support_repo.MAX_OPEN_PER_USER:
        raise ConflictError("У вас слишком много обращений без ответа. Дождитесь ответа на прежние.", code="too_many_open")
    created = await support_repo.create(conn, user_id=user["id"], kind=payload.kind, subject=payload.subject, body=payload.body)
    return SupportCreatedOut(id=created["id"], status=created["status"])


@router.get("/mine", response_model=list[MySupportRequestOut])
async def my_requests(user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> list[MySupportRequestOut]:
    return [MySupportRequestOut(**row) for row in await support_repo.list_for_user(conn, user["id"])]


@router.post("/{request_id}/messages", response_model=MySupportRequestOut, status_code=201)
async def reply_to_request(
    request_id: UUID,
    payload: SupportReplyIn,
    request: Request,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> MySupportRequestOut:
    """The author's next message in their own request (also after the administrators' answer)."""
    await svc.enforce_rate_limit(request, conn, settings, "support_reply", str(user["id"]), limit=_REPLIES_PER_HOUR, window_seconds=3600)
    try:
        if not await support_repo.reply(conn, request_id, user["id"], payload.body):
            raise NotFoundError("support request not found")
    except support_repo.BadTransition:
        raise ConflictError("Обращение закрыто. Если нужна помощь, создайте новое.", code="closed") from None
    except support_repo.TooManyReplies:
        raise ConflictError("В этом обращении слишком много сообщений. Дождитесь ответа или создайте новое обращение.", code="too_many_replies") from None
    mine = {r["id"]: r for r in await support_repo.list_for_user(conn, user["id"])}
    return MySupportRequestOut(**mine[request_id])
