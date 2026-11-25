from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, Field, field_validator

Status = Literal['pending', 'needs_info', 'approved', 'rejected']

class ApplicationDetails(BaseModel):
    sport: str = Field(min_length=2, max_length=100)
    qualification: str = Field(min_length=2, max_length=1000)
    experience: str = Field(min_length=2, max_length=2000)
    about: str = Field(default='', max_length=2000)
    links: list[str] = Field(default_factory=list, max_length=5)

    @field_validator('sport', 'qualification', 'experience')
    @classmethod
    def nonblank(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError('Enter at least two visible characters')
        return value

    @field_validator('about')
    @classmethod
    def clean_about(cls, value: str) -> str:
        return value.strip()

    @field_validator('links')
    @classmethod
    def safe_links(cls, values: list[str]) -> list[str]:
        from urllib.parse import urlsplit
        result = []
        for value in values:
            value = value.strip()
            parsed = urlsplit(value)
            if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or len(value) > 500:
                raise ValueError('Only public HTTPS links without credentials are allowed')
            result.append(value)
        return result

class DecisionIn(BaseModel):
    action: Literal['approve', 'needs_info', 'reject']
    note: str = Field(default='', max_length=2000)

class DocumentOut(BaseModel):
    id: UUID
    filename: str
    mime_type: str
    created_at: datetime

class ApplicationOut(ApplicationDetails):
    id: UUID
    user_id: UUID
    status: Status
    admin_note: str | None = None
    resubmit_after: datetime | None = None
    created_at: datetime
    updated_at: datetime
    documents: list[DocumentOut] = []
    email: str | None = None
    first_name: str | None = None
    last_name: str | None = None
