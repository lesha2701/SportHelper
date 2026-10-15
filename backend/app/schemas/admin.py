from __future__ import annotations

from datetime import date, datetime, time
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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


class DashboardModerationOut(BaseModel):
    new_complaints: int
    # open complaints about a public photo/video or a listing
    content_pending: int


class AdminDashboardOut(BaseModel):
    users: DashboardUsersOut
    activity: DashboardActivityOut
    trainings: DashboardTrainingsOut
    bookings: DashboardBookingsOut
    moderation: DashboardModerationOut
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


class AdminAuditPageOut(BaseModel):
    total: int
    limit: int
    offset: int
    items: list["AdminAuditEntryOut"]


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


# --- moderation ------------------------------------------------------------------------------------------------


class ReasonIn(BaseModel):
    """Every moderation action carries a written reason (it goes into the audit trail)."""

    model_config = ConfigDict(extra="forbid")

    reason: str = Field(max_length=1000)

    @field_validator("reason")
    @classmethod
    def _check_reason(cls, value: str) -> str:
        return _clean_reason(value)


class ConfirmedReasonIn(ReasonIn):
    """An irreversible action: the reason plus an explicit confirmation."""

    confirm: bool

    @field_validator("confirm")
    @classmethod
    def _must_confirm(cls, value: bool) -> bool:
        if value is not True:
            raise ValueError("confirmation required")
        return value


class MediaOwnerOut(BaseModel):
    id: UUID
    email: str | None
    name: str


class MediaRowOut(BaseModel):
    id: UUID
    kind: str  # avatar | logo | listing | gallery | exercise | training
    media_type: Literal["image", "video", "other"]
    filename: str
    mime_type: str
    size_bytes: int
    created_at: datetime
    owner: MediaOwnerOut
    hidden: bool
    hidden_at: datetime | None
    moderation_reason: str | None
    hidden_by: str | None
    has_thumb: bool


class RelatedObjectOut(BaseModel):
    type: str
    id: UUID
    label: str


class MediaDetailOut(MediaRowOut):
    related: RelatedObjectOut | None
    open_complaints: int


class MediaPageOut(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[MediaRowOut]


class MediaDeletedOut(BaseModel):
    deleted: bool
    # False when Yandex.Disk could not be reached: the file is already detached and gone from the site, and the
    # background clean-up removes the bytes later.
    storage_deleted: bool


# --- trainings and listings ---------------------------------------------------------------------------------------


class PersonOut(BaseModel):
    id: UUID
    name: str
    email: str | None = None


class TrainingRowOut(BaseModel):
    id: UUID
    type: Literal["team", "personal", "independent"]
    status: Literal["scheduled", "completed", "cancelled"]
    training_date: date
    start_time: time
    duration_minutes: int
    location: str | None
    description: str | None
    team: dict[str, Any] | None  # {"id", "name"}
    creator: PersonOut
    participants: int
    bookings: int
    created_at: datetime


class TrainingParticipantOut(BaseModel):
    id: UUID
    name: str
    attendance: str | None


class TrainingBookingOut(BaseModel):
    id: UUID
    status: str
    starts_at: datetime
    format: str
    coach: str
    athlete: str


class TrainingDetailOut(TrainingRowOut):
    plan_name: str | None
    reminder_minutes_before: int | None
    recurring: bool
    participant_list: list[TrainingParticipantOut]
    booking_list: list[TrainingBookingOut]


class TrainingsPageOut(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[TrainingRowOut]


class ListingRowOut(BaseModel):
    id: UUID
    title: str
    coach: PersonOut
    coach_blocked: bool
    price_per_session: float | None
    currency: str
    location: str | None
    # public | hidden (by a moderator) | unlisted (the coach switched it off) | deleted
    state: Literal["public", "hidden", "unlisted", "deleted"]
    moderation_reason: str | None
    hidden_by: str | None
    hidden_at: datetime | None
    active_bookings: int
    has_photo: bool
    has_video: bool
    created_at: datetime


class ListingDetailOut(ListingRowOut):
    description: str | None
    open_complaints: int


class ListingsPageOut(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[ListingRowOut]


# --- complaints -----------------------------------------------------------------------------------------------------

ComplaintStatus = Literal["new", "in_progress", "resolved", "rejected"]
ComplaintReason = Literal["inappropriate", "fraud", "spam", "false_info", "other"]
ComplaintTarget = Literal["user", "listing", "media"]


class ComplaintIn(BaseModel):
    """What a user sends to report a profile, a listing or a public photo/video."""

    model_config = ConfigDict(extra="forbid")

    target_type: ComplaintTarget
    target_id: UUID
    reason: ComplaintReason
    comment: str | None = Field(default=None, max_length=1000)

    @field_validator("comment")
    @classmethod
    def _tidy(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = " ".join(value.split())
        return text or None

    @model_validator(mode="after")
    def _other_needs_words(self) -> "ComplaintIn":
        if self.reason == "other" and len(self.comment or "") < 3:
            raise ValueError("опишите причину жалобы")
        return self


class ComplaintCreatedOut(BaseModel):
    id: UUID
    status: ComplaintStatus


class ComplaintTargetOut(BaseModel):
    type: ComplaintTarget
    id: UUID
    label: str | None
    state: str | None  # users: active|blocked|deleted; listings/media: visible|hidden|deleted
    owner: PersonOut | None


class ComplaintOut(BaseModel):
    id: UUID
    status: ComplaintStatus
    reason: ComplaintReason
    comment: str | None
    created_at: datetime
    reporter: PersonOut
    target: ComplaintTargetOut
    other_open_on_target: int
    handled_by: str | None
    handled_at: datetime | None
    resolution: str | None


class ComplaintsPageOut(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[ComplaintOut]


class ResolveComplaintIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["resolved", "rejected"]
    resolution: str = Field(max_length=1000)

    @field_validator("resolution")
    @classmethod
    def _check(cls, value: str) -> str:
        return _clean_reason(value)


AdminAuditPageOut.model_rebuild()
