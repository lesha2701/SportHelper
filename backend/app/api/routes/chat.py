"""Chats of a personal training (a booking) and of a team. Text and photos/videos; the media follow exactly the rules of every other
photo and video on the site (types, sizes, optimisation, video length). New messages are fetched by the page every few seconds
(GET .../messages?after_id=N), there is no persistent connection to keep alive behind the proxy."""
from __future__ import annotations

import logging
from uuid import UUID, uuid4

import asyncpg
from fastapi import APIRouter, Depends, Form, Query, Response, UploadFile

from app.api.deps import get_current_user, get_db, get_settings_dep
from app.config import Settings
from app.core.exceptions import APIError
from app.integrations.paths import build_chat_file_path
from app.repositories import chat as chat_repo
from app.repositories import files as files_repo
from app.schemas.chat import (
    MAX_MESSAGE_CHARS, ChatConversationOut, ChatMessageIn, ChatMessageOut, ChatMessagesOut, ChatReadIn, ChatUnreadOut,
)
from app.services import chat as chat_service
from app.services.uploads import (
    IMAGE_MIME_EXTENSIONS, VIDEO_MIME_EXTENSIONS, discard_disk_path, discard_stored_image, safe_filename, store_image_or_raise,
    store_video_or_raise,
)

logger = logging.getLogger("teamflow.chat")

router = APIRouter(prefix="/api/chats", tags=["chat"])


def _conversation_out(access: chat_service.ChatAccess) -> ChatConversationOut:
    c = access.conversation
    return ChatConversationOut(
        id=c["id"], kind=c["kind"], booking_id=c["booking_id"], team_id=c["team_id"], title=access.title, subtitle=access.subtitle,
        can_send=access.can_send, send_blocked_reason=access.send_blocked_reason, can_moderate=access.can_moderate,
    )


@router.get("/unread", response_model=ChatUnreadOut)
async def unread(user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> ChatUnreadOut:
    counts = await chat_repo.unread_for_user(conn, user["id"])
    return ChatUnreadOut(booking=counts["booking"], team=counts["team"], total=sum(counts["booking"].values()) + sum(counts["team"].values()))


@router.get("/for-booking/{booking_id}", response_model=ChatConversationOut)
async def chat_for_booking(booking_id: UUID, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> ChatConversationOut:
    return _conversation_out(await chat_service.open_for_booking(conn, user, booking_id))


@router.get("/for-team/{team_id}", response_model=ChatConversationOut)
async def chat_for_team(team_id: UUID, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> ChatConversationOut:
    return _conversation_out(await chat_service.open_for_team(conn, user, team_id))


@router.get("/{conversation_id}", response_model=ChatConversationOut)
async def get_chat(conversation_id: UUID, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> ChatConversationOut:
    return _conversation_out(await chat_service.access_for(conn, user, conversation_id))


@router.get("/{conversation_id}/messages", response_model=ChatMessagesOut)
async def list_messages(
    conversation_id: UUID,
    before_id: int | None = Query(default=None, ge=1),
    after_id: int | None = Query(default=None, ge=0),
    limit: int = Query(default=30, ge=1, le=100),
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> ChatMessagesOut:
    await chat_service.access_for(conn, user, conversation_id)
    rows, more = await chat_repo.list_messages(conn, conversation_id, before_id=before_id, after_id=after_id, limit=limit)
    return ChatMessagesOut(items=[ChatMessageOut(**chat_service.message_out(r)) for r in rows], has_more_before=more)


@router.post("/{conversation_id}/messages", response_model=ChatMessageOut, status_code=201)
async def send_message(
    conversation_id: UUID, payload: ChatMessageIn, response: Response,
    user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db), settings: Settings = Depends(get_settings_dep),
) -> ChatMessageOut:
    access = await chat_service.access_for(conn, user, conversation_id)
    chat_service.require_can_send(access)
    body = chat_service.clean_body(payload.body)
    if body is None:
        raise APIError("Напишите сообщение.", code="message_empty", status_code=422, field="body")
    existing = await chat_repo.get_by_client_key(conn, conversation_id, user["id"], payload.client_key)
    if existing is not None:
        response.status_code = 200  # the same message sent again: nothing new is created
        return ChatMessageOut(**chat_service.message_out(existing))
    await chat_service.check_rate(conn, settings, user["id"], media=False)
    async with conn.transaction():
        message_id = await chat_repo.insert_message(
            conn, conversation_id=conversation_id, sender_id=user["id"], body=body, file_id=None, attachment_kind=None, client_key=payload.client_key
        )
    message = await chat_repo.get_message(conn, message_id) if message_id else await chat_repo.get_by_client_key(conn, conversation_id, user["id"], payload.client_key)
    assert message is not None
    if message_id is None:
        response.status_code = 200
    else:
        await _notify(conn, access, user, message)
    return ChatMessageOut(**chat_service.message_out(message))


@router.post("/{conversation_id}/messages/media", response_model=ChatMessageOut, status_code=201)
async def send_media(
    conversation_id: UUID, file: UploadFile, response: Response,
    client_key: UUID = Form(...), body: str | None = Form(default=None),
    user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db), settings: Settings = Depends(get_settings_dep),
) -> ChatMessageOut:
    access = await chat_service.access_for(conn, user, conversation_id)
    chat_service.require_can_send(access)
    text = chat_service.clean_body(body)
    if text is not None and len(text) > MAX_MESSAGE_CHARS:
        raise APIError(f"Подпись не длиннее {MAX_MESSAGE_CHARS} символов.", code="message_too_long", status_code=422, field="body")
    existing = await chat_repo.get_by_client_key(conn, conversation_id, user["id"], client_key)
    if existing is not None:  # a retry of an upload that already succeeded: do not store the file twice
        response.status_code = 200
        return ChatMessageOut(**chat_service.message_out(existing))
    await chat_service.check_rate(conn, settings, user["id"], media=True)

    if file.content_type in IMAGE_MIME_EXTENSIONS:
        kind = "photo"
    elif file.content_type in VIDEO_MIME_EXTENSIONS:
        kind = "video"
    else:
        raise APIError("Можно отправить фото (JPEG, PNG, WebP, GIF) или видео (MP4, MOV, WEBM).", code="unsupported_media_type", status_code=415)

    file_id = uuid4()
    stored = None
    if kind == "photo":
        stored = await store_image_or_raise(
            settings, file, "chat_photo",
            lambda extension: build_chat_file_path(settings.yandex_disk_root_folder, settings.app_mode, conversation_id, file_id, extension),
        )
        disk_path, mime_type, size_bytes, thumb = stored.disk_path, stored.mime_type, stored.size_bytes, stored.thumb_disk_path
        filename = safe_filename(file.filename, stored.extension, "photo")
    else:
        extension = VIDEO_MIME_EXTENSIONS[file.content_type]
        disk_path = build_chat_file_path(settings.yandex_disk_root_folder, settings.app_mode, conversation_id, file_id, extension)
        size_bytes = await store_video_or_raise(settings, file, disk_path)
        mime_type, thumb = file.content_type, None
        filename = safe_filename(file.filename, extension, "video")

    try:
        async with conn.transaction():
            record = await files_repo.create_file(
                conn, owner_id=user["id"], team_id=access.team_id, entity_type=f"chat_{kind}", entity_id=conversation_id, disk_path=disk_path,
                filename=filename, mime_type=mime_type, size_bytes=size_bytes, access_level="CHAT", thumb_disk_path=thumb,
            )
            message_id = await chat_repo.insert_message(
                conn, conversation_id=conversation_id, sender_id=user["id"], body=text, file_id=record["id"], attachment_kind=kind, client_key=client_key
            )
            if message_id is None:  # two identical uploads raced: keep the first, drop this copy
                raise _Duplicate()
    except _Duplicate:
        await _discard(settings, disk_path, stored)
        response.status_code = 200
        message = await chat_repo.get_by_client_key(conn, conversation_id, user["id"], client_key)
        assert message is not None
        return ChatMessageOut(**chat_service.message_out(message))
    except Exception:
        await _discard(settings, disk_path, stored)
        raise
    message = await chat_repo.get_message(conn, message_id)
    assert message is not None
    await _notify(conn, access, user, message)
    return ChatMessageOut(**chat_service.message_out(message))


class _Duplicate(Exception):
    pass


async def _discard(settings: Settings, disk_path: str, stored) -> None:
    if stored is not None:
        await discard_stored_image(settings, stored)
    else:
        await discard_disk_path(settings, disk_path)


async def _notify(conn: asyncpg.Connection, access: chat_service.ChatAccess, user: dict, message: dict) -> None:
    try:
        await chat_service.notify_recipients(conn, access, user, message)
    except Exception:  # noqa: BLE001 - a notification problem must never undo or fail a message that is already saved
        logger.exception("Could not queue chat notifications for message %s", message["id"])


@router.delete("/{conversation_id}/messages/{message_id}", status_code=204, response_model=None)
async def delete_message(
    conversation_id: UUID, message_id: int, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)
) -> None:
    access = await chat_service.access_for(conn, user, conversation_id)
    await chat_service.delete_message(conn, user, access, message_id)


@router.post("/{conversation_id}/read", status_code=204, response_model=None)
async def mark_read(
    conversation_id: UUID, payload: ChatReadIn, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)
) -> None:
    await chat_service.access_for(conn, user, conversation_id)
    await chat_repo.mark_read(conn, conversation_id, user["id"], payload.up_to_id)
