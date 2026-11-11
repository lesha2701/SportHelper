"""Chats: who may read and write, and what sending a message does.

* A PERSONAL TRAINING chat belongs to a booking. It exists for the booking's athlete and coach, opens once the lesson is confirmed AND
  paid (or is free), and stays readable afterwards; sending closes if the payment is refunded or the booking is no longer confirmed.
* A TEAM chat belongs to a team: every current member may read and write; head and assistant coaches may also delete others' messages.

Nobody is stored in a chat: access is re-derived from the booking / the team on every request, so a person who leaves a team, or is
removed from it, loses access at once and an administrator never has to clean anything up."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import asyncpg

from app.config import Settings
from app.core.exceptions import APIError, ForbiddenError, NotFoundError
from app.repositories import bookings as bookings_repo
from app.repositories import chat as chat_repo
from app.repositories import payments as payments_repo
from app.repositories import rate_limits as rate_limits_repo
from app.repositories import teams as teams_repo
from app.services import payments as payments_service

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
COACH_ROLES = ("head_coach", "assistant_coach")
# Payment states in which the lesson is "paid" for the purpose of chatting (a refund in progress still counts).
_PAID_LIKE = ("paid", "refund_pending", "not_required")


@dataclass
class ChatAccess:
    conversation: dict[str, Any]
    title: str
    subtitle: str | None
    can_send: bool
    send_blocked_reason: str | None
    can_moderate: bool
    team_id: UUID | None = None
    booking: dict[str, Any] | None = None


def clean_body(text: str | None) -> str | None:
    """Plain text only (the page never renders HTML); control characters are dropped, surrounding blank space trimmed."""
    if text is None:
        return None
    cleaned = _CONTROL.sub("", text.replace("\r\n", "\n").replace("\r", "\n")).strip()
    return cleaned or None


def _booking_state(booking: dict[str, Any], summary: dict[str, Any] | None) -> tuple[bool, str | None]:
    """(chat open for sending, why not)."""
    if booking["status"] != "confirmed":
        return False, "Чат доступен только для подтверждённой тренировки."
    if payments_service.payment_status_of(booking, summary) not in _PAID_LIKE:
        return False, "Чат откроется после оплаты тренировки."
    return True, None


def _person(first: str | None, last: str | None) -> str:
    return " ".join(part for part in (first, last) if part) or "Пользователь"


async def _booking_access(conn: asyncpg.Connection, user: dict, booking: dict[str, Any], conversation: dict[str, Any] | None) -> ChatAccess:
    summary = await payments_repo.summary_for_booking(conn, booking["id"])
    open_now, why = _booking_state(booking, summary)
    other = booking["coach_full_name"] if user["id"] == booking["athlete_user_id"] else booking["athlete_full_name"]
    when = booking["starts_at"].strftime("%d.%m.%Y %H:%M")
    subtitle = f"{booking['listing_title'] or 'Индивидуальная тренировка'} · {when}"
    return ChatAccess(
        conversation=conversation or {}, title=other, subtitle=subtitle, can_send=open_now, send_blocked_reason=why, can_moderate=False, booking=booking
    )


async def open_for_booking(conn: asyncpg.Connection, user: dict, booking_id: UUID) -> ChatAccess:
    booking = await bookings_repo.get_booking(conn, booking_id)
    if booking is None or user["id"] not in (booking["athlete_user_id"], booking["coach_user_id"]):
        raise NotFoundError("booking not found")  # someone else's booking looks exactly like a missing one
    existing = await chat_repo.find_for_booking(conn, booking_id)
    access = await _booking_access(conn, user, booking, existing)
    if existing is None:
        if not access.can_send:
            raise APIError(access.send_blocked_reason or "Чат пока недоступен.", code="chat_not_available", status_code=409)
        existing = await chat_repo.ensure_for_booking(conn, booking_id)
        access.conversation = existing
    return access


async def open_for_team(conn: asyncpg.Connection, user: dict, team_id: UUID) -> ChatAccess:
    team = await teams_repo.get_team(conn, team_id)
    member = await teams_repo.get_member(conn, team_id, user["id"]) if team else None
    if team is None or member is None:
        raise NotFoundError("team not found")
    conversation = await chat_repo.ensure_for_team(conn, team_id)
    count = await teams_repo.count_members(conn, team_id)
    return ChatAccess(
        conversation=conversation, title=team["name"], subtitle=f"Участников: {count}", can_send=True, send_blocked_reason=None,
        can_moderate=member["role"] in COACH_ROLES, team_id=team_id,
    )


async def access_for(conn: asyncpg.Connection, user: dict, conversation_id: UUID) -> ChatAccess:
    """Everything every chat endpoint needs; a conversation the person may not see is reported as not found."""
    conversation = await chat_repo.get_conversation(conn, conversation_id)
    if conversation is None:
        raise NotFoundError("chat not found")
    if conversation["kind"] == "booking":
        booking = await bookings_repo.get_booking(conn, conversation["booking_id"])
        if booking is None or user["id"] not in (booking["athlete_user_id"], booking["coach_user_id"]):
            raise NotFoundError("chat not found")
        return await _booking_access(conn, user, booking, conversation)
    member = await teams_repo.get_member(conn, conversation["team_id"], user["id"])
    team = await teams_repo.get_team(conn, conversation["team_id"])
    if member is None or team is None:
        raise NotFoundError("chat not found")
    count = await teams_repo.count_members(conn, conversation["team_id"])
    return ChatAccess(
        conversation=conversation, title=team["name"], subtitle=f"Участников: {count}", can_send=True, send_blocked_reason=None,
        can_moderate=member["role"] in COACH_ROLES, team_id=conversation["team_id"],
    )


async def can_read_file(conn: asyncpg.Connection, user: dict, file_id: UUID) -> bool:
    """A chat photo or video is served to exactly the people who can read that chat, and only while its message exists."""
    message = await chat_repo.get_by_file(conn, file_id)
    if message is None:
        return False
    try:
        await access_for(conn, user, message["conversation_id"])
    except NotFoundError:
        return False
    return True


def require_can_send(access: ChatAccess) -> None:
    if not access.can_send:
        raise APIError(access.send_blocked_reason or "Сейчас писать в этот чат нельзя.", code="chat_closed", status_code=409)


async def check_rate(conn: asyncpg.Connection, settings: Settings, user_id: UUID, *, media: bool) -> None:
    if not settings.auth_rate_limit_enabled:
        return
    key, limit, window = (f"chat_media:{user_id}", 10, 300) if media else (f"chat_msg:{user_id}", 40, 60)
    allowed, retry_after = await rate_limits_repo.hit(conn, key, limit, window)
    if not allowed:
        raise APIError("Слишком много сообщений подряд. Подождите немного.", code="rate_limited", status_code=429, retry_after=retry_after)


async def notify_recipients(conn: asyncpg.Connection, access: ChatAccess, sender: dict, message: dict[str, Any]) -> None:
    """Tells the OTHER people in the chat (once per unread streak - see the repository). Never blocks or undoes the message."""
    conversation = access.conversation
    sender_name = _person(sender.get("first_name"), sender.get("last_name"))
    preview = (message["body"] or ("Фото" if message["attachment_kind"] == "photo" else "Видео"))[:120]
    if conversation["kind"] == "booking":
        booking = access.booking or {}
        recipients = [uid for uid in (booking.get("athlete_user_id"), booking.get("coach_user_id")) if uid and uid != sender["id"]]
        await chat_repo.queue_notifications(
            conn, conversation_id=conversation["id"], recipients=recipients, category="chat_booking",
            title=f"Сообщение от {sender_name}", body=preview, entity_type="booking", entity_id=conversation["booking_id"],
        )
    else:
        recipients = [uid for uid in await chat_repo.team_member_ids(conn, conversation["team_id"]) if uid != sender["id"]]
        await chat_repo.queue_notifications(
            conn, conversation_id=conversation["id"], recipients=recipients, category="chat_team",
            title=f"Чат команды «{access.title}»", body=f"{sender_name}: {preview}", entity_type="team", entity_id=conversation["team_id"],
        )


def message_out(row: dict[str, Any]) -> dict[str, Any]:
    deleted = row["deleted_at"] is not None
    attachment = None
    if row["file_id"] is not None and not deleted:
        attachment = {"kind": row["attachment_kind"], "file_id": row["file_id"], "filename": row["file_name"] or "file", "has_thumb": bool(row["has_thumb"])}
    return {
        "id": row["id"], "sender_id": row["sender_id"], "sender_name": _person(row["sender_first_name"], row["sender_last_name"]),
        "body": None if deleted else row["body"], "attachment": attachment, "created_at": row["created_at"], "deleted": deleted,
    }


async def delete_message(conn: asyncpg.Connection, user: dict, access: ChatAccess, message_id: int) -> None:
    message = await chat_repo.get_message(conn, message_id)
    if message is None or message["conversation_id"] != access.conversation["id"]:
        raise NotFoundError("message not found")
    if message["sender_id"] != user["id"] and not access.can_moderate:
        raise ForbiddenError("you can delete only your own messages")
    await chat_repo.soft_delete(conn, message_id, user["id"])
