from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class AdminOverviewOut(BaseModel):
    total_users: int
    banned_users: int
    total_teams: int
    total_trainings: int
    total_matches: int
    total_tasks: int
    pending_notifications: int


class AdminUserOut(BaseModel):
    id: UUID
    email: str | None
    email_verified: bool
    first_name: str
    last_name: str | None
    is_banned: bool
    banned_at: datetime | None
    last_login_at: datetime | None
    created_at: datetime
    telegram_linked: bool
    is_deleted: bool


class AdminUsersPageOut(BaseModel):
    total: int
    items: list[AdminUserOut]


class AdminAuditEntryOut(BaseModel):
    id: UUID
    action: str
    target_type: str | None
    target_id: str | None
    details: dict[str, Any] | None
    created_at: datetime
    admin: str  # who acted: email of a website admin, or "telegram:<id>"
