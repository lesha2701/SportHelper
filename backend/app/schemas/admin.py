from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel


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
