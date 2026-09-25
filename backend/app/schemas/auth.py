from __future__ import annotations

from pydantic import BaseModel

from app.schemas.user import UserOut


class TelegramAuthRequest(BaseModel):
    init_data: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class BrowserLoginStartOut(BaseModel):
    token: str
    bot_url: str
    expires_in: int


class BrowserLoginPollRequest(BaseModel):
    token: str


class BrowserLoginPollOut(BaseModel):
    # "pending" — not confirmed yet; "expired" — unknown/expired token;
    # "ok" — `auth` is set (the token is consumed and cannot be reused).
    status: str
    auth: AuthResponse | None = None
