from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.user import UserOut

Role = Literal["player", "coach"]


class RegisterIn(BaseModel):
    first_name: str = Field(max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    email: str = Field(max_length=320)
    password: str = Field(max_length=2048)
    password_confirm: str = Field(max_length=2048)
    accept_terms: bool
    role: Role | None = None
    # Where the visitor was heading (e.g. the listing they wanted to book);
    # carried through the confirmation email, validated server-side.
    next: str | None = Field(default=None, max_length=500)


class RegisterOut(BaseModel):
    email: str
    verification_sent: bool = True


class LoginIn(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=2048)


class AuthOut(UserOut):
    """Returned by /login and /me: the signed-in user plus `csrf_token`. The
    session itself travels in an HttpOnly cookie; the CSRF token must be
    echoed in the X-CSRF-Token header on every state-changing request (the
    page keeps it in memory only, never in storage)."""

    csrf_token: str


class TokenIn(BaseModel):
    token: str = Field(max_length=512)


class EmailIn(BaseModel):
    email: str = Field(max_length=320)
    next: str | None = Field(default=None, max_length=500)


class MessageOut(BaseModel):
    message: str


class VerifyEmailIn(BaseModel):
    token: str = Field(max_length=512)
    # The password the account was registered with: confirming the address must
    # also prove you are the person who registered it (see routes/auth.py).
    password: str = Field(max_length=2048)


class VerifyEmailSetPasswordIn(BaseModel):
    token: str = Field(max_length=512)
    password: str = Field(max_length=2048)
    password_confirm: str = Field(max_length=2048)


class VerifyInspectOut(BaseModel):
    valid: bool
    email: str | None = None  # masked, e.g. a***e@example.com
    first_name: str | None = None


class VerifyEmailOut(BaseModel):
    verified: bool
    email: str | None = None


class ResetPasswordIn(BaseModel):
    token: str = Field(max_length=512)
    password: str = Field(max_length=2048)
    password_confirm: str = Field(max_length=2048)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(max_length=2048)
    new_password: str = Field(max_length=2048)
    new_password_confirm: str = Field(max_length=2048)


class ChangeEmailIn(BaseModel):
    new_email: str = Field(max_length=320)
    password: str = Field(max_length=2048)


class PasswordIn(BaseModel):
    password: str = Field(max_length=2048)


class ClaimInspectOut(BaseModel):
    valid: bool
    first_name: str | None = None


class ClaimIn(BaseModel):
    token: str = Field(max_length=512)
    email: str = Field(max_length=320)
    password: str = Field(max_length=2048)
    password_confirm: str = Field(max_length=2048)
    accept_terms: bool


class SessionOut(BaseModel):
    id: UUID
    device: str
    ip_address: str | None
    created_at: datetime
    last_seen_at: datetime
    current: bool


class TelegramLinkOut(BaseModel):
    bot_url: str
    expires_in: int


class MfaStatusOut(BaseModel):
    is_admin: bool
    enabled: bool
    # True if this session has passed the second factor recently.
    session_verified: bool


class MfaSetupOut(BaseModel):
    secret: str
    otpauth_uri: str


class MfaCodeIn(BaseModel):
    code: str = Field(max_length=32)


class MfaEnableOut(BaseModel):
    recovery_codes: list[str]


class MfaDisableIn(BaseModel):
    password: str = Field(max_length=2048)
    code: str = Field(max_length=32)


class IdentityOut(BaseModel):
    provider: str
    display_name: str | None
    email: str | None
    linked_at: datetime
    last_login_at: datetime | None
