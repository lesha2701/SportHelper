"""Support requests: what a person writes to the administrators, and what comes back."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.admin import PersonOut

SupportKind = Literal["question", "suggestion", "conflict", "bug", "payment", "other"]
SupportStatus = Literal["new", "in_progress", "answered", "closed"]


def _tidy_text(value: str) -> str:
    """Line breaks are kept (a request is prose), but runs of blank lines and of spaces are not."""
    lines = [" ".join(line.split()) for line in value.strip().splitlines()]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


class SupportRequestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: SupportKind
    subject: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=6000)

    @field_validator("subject")
    @classmethod
    def _subject(cls, value: str) -> str:
        text = " ".join(value.split())
        if not 3 <= len(text) <= 120:
            raise ValueError("Заголовок: от 3 до 120 символов.")
        return text

    @field_validator("body")
    @classmethod
    def _body(cls, value: str) -> str:
        text = _tidy_text(value)
        if not 10 <= len(text) <= 3000:
            raise ValueError("Текст обращения: от 10 до 3000 символов.")
        return text


class SupportCreatedOut(BaseModel):
    id: UUID
    status: SupportStatus


class SupportMessageOut(BaseModel):
    """One message after the first: the administrators' answer (from_staff) or the author's reply."""

    id: UUID
    from_staff: bool
    body: str
    created_at: datetime


class MySupportRequestOut(BaseModel):
    id: UUID
    kind: SupportKind
    subject: str
    body: str
    status: SupportStatus
    created_at: datetime
    messages: list[SupportMessageOut]
    can_reply: bool


class SupportRequestOut(BaseModel):
    """The administrators' view: the author and who is handling it."""

    id: UUID
    kind: SupportKind
    subject: str
    body: str
    status: SupportStatus
    created_at: datetime
    author: PersonOut
    messages: list[SupportMessageOut]
    handled_by: str | None
    handled_at: datetime | None


class SupportPageOut(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[SupportRequestOut]


class AnswerSupportIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answer: str = Field(min_length=1, max_length=6000)

    @field_validator("answer")
    @classmethod
    def _answer(cls, value: str) -> str:
        text = _tidy_text(value)
        if not 3 <= len(text) <= 3000:
            raise ValueError("Ответ: от 3 до 3000 символов.")
        return text


class SupportReplyIn(BaseModel):
    """The author's next message in an existing request."""

    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=6000)

    @field_validator("body")
    @classmethod
    def _body(cls, value: str) -> str:
        text = _tidy_text(value)
        if not 3 <= len(text) <= 3000:
            raise ValueError("Сообщение: от 3 до 3000 символов.")
        return text


class CloseSupportIn(BaseModel):
    """Closing without an answer (a duplicate, spam, nothing to add)."""

    model_config = ConfigDict(extra="forbid")

    note: str | None = Field(default=None, max_length=500)
