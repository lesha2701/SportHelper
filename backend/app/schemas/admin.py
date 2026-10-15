from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AdminSessionOut(BaseModel):
    """What the signed-in administrator may do right now - never the allowlist itself."""

    is_admin: bool
    mfa_enabled: bool
    # The second factor was entered in this session recently enough for ordinary admin operations...
    mfa_verified: bool
    # ...and recently enough for irreversible ones (see ADMIN_SENSITIVE_MFA_MINUTES).
    mfa_recent: bool


class DayCountOut(BaseModel):
    day: date
    count: int


class DashboardUsersOut(BaseModel):
    total: int
    new_today: int
    new_7d: int
    new_30d: int
    players: int
    coaches: int
    banned: int


class DashboardActivityOut(BaseModel):
    """Distinct signed-in people active in the window (UTC days; the last 7 / 30 days include today)."""

    dau: int
    wau: int
    mau: int
    # The first day anything was recorded: earlier days simply have no data.
    tracking_since: date | None


class DashboardTrainingsOut(BaseModel):
    total: int
    active: int  # scheduled: neither completed nor cancelled
    upcoming: int  # scheduled and dated today or later
    completed: int


class DashboardBookingsOut(BaseModel):
    total: int
    confirmed: int
    upcoming: int


class AdminDashboardOut(BaseModel):
    users: DashboardUsersOut
    activity: DashboardActivityOut
    trainings: DashboardTrainingsOut
    bookings: DashboardBookingsOut
    registrations: list[DayCountOut]
    active_users: list[DayCountOut]
    trainings_created: list[DayCountOut]
    bookings_created: list[DayCountOut]


class AdminUserRowOut(BaseModel):
    id: UUID
    email: str | None
    email_verified: bool
    first_name: str
    last_name: str | None
    is_player: bool
    is_coach: bool
    # True for the people listed in the server configuration; shown so the panel can explain why they cannot be blocked.
    is_admin: bool
    status: Literal["active", "banned", "unverified", "deleted"]
    deletion_requested: bool
    banned_until: datetime | None
    created_at: datetime
    last_active_at: datetime | None
    last_login_at: datetime | None


class AdminUsersPageOut(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[AdminUserRowOut]


class BanRecordOut(BaseModel):
    id: UUID
    reason: str
    banned_at: datetime
    expires_at: datetime | None
    lifted_at: datetime | None
    lift_kind: str | None
    lift_reason: str | None
    admin: str | None
    lifted_by: str | None


class ModerationEntryOut(BaseModel):
    id: UUID
    action: str
    reason: str | None
    result: str
    created_at: datetime
    admin: str | None


class AdminUserCardOut(AdminUserRowOut):
    ban_reason: str | None
    banned_at: datetime | None
    telegram_linked: bool
    trainings_created: int
    teams_count: int
    listings_count: int
    files_count: int
    bans: list[BanRecordOut]
    history: list[ModerationEntryOut]


def _clean_reason(value: str) -> str:
    text = " ".join(value.split())
    if len(text) < 3:
        raise ValueError("укажите причину (не короче 3 символов)")
    return text


class BlockIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(max_length=1000)
    # None = permanent; otherwise the block lifts itself after this many days.
    days: int | None = Field(default=None, ge=1, le=3650)

    @field_validator("reason")
    @classmethod
    def _check_reason(cls, value: str) -> str:
        return _clean_reason(value)


class UnblockIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(max_length=1000)

    @field_validator("reason")
    @classmethod
    def _check_reason(cls, value: str) -> str:
        return _clean_reason(value)


class AdminAuditEntryOut(BaseModel):
    id: UUID
    action: str
    target_type: str | None
    target_id: str | None
    details: dict[str, Any] | None
    reason: str | None = None
    result: str = "success"
    created_at: datetime
    admin: str  # who acted: email of a website admin, or "telegram:<id>"
