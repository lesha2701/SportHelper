from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

MAX_MESSAGE_CHARS = 2000


class ChatConversationOut(BaseModel):
    id: UUID
    kind: Literal["booking", "team"]
    booking_id: UUID | None = None
    team_id: UUID | None = None
    title: str                      # the other person, or the team
    subtitle: str | None = None     # the lesson (title, date), or "N участников"
    can_send: bool
    send_blocked_reason: str | None = None
    # May delete OTHER people's messages (head or assistant coach in a team chat).
    can_moderate: bool = False


class ChatAttachmentOut(BaseModel):
    kind: Literal["photo", "video"]
    file_id: UUID
    filename: str
    has_thumb: bool = False


class ChatMessageOut(BaseModel):
    id: int
    sender_id: UUID
    sender_name: str
    body: str | None = None
    attachment: ChatAttachmentOut | None = None
    created_at: datetime
    deleted: bool = False


class ChatMessagesOut(BaseModel):
    items: list[ChatMessageOut]
    has_more_before: bool


class ChatMessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)
    # Generated once per message by the page: sending it again (double click, retry) can only ever create one message.
    client_key: UUID


class ChatReadIn(BaseModel):
    up_to_id: int = Field(ge=0)


class ChatUnreadOut(BaseModel):
    booking: dict[str, int]
    team: dict[str, int]
    total: int
