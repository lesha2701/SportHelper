"""Application JWT issuance/verification (separate from Telegram's own signing)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt

from app.config import Settings


class InvalidToken(Exception):
    """Raised when a JWT is missing, malformed, expired, or has a bad signature."""


def create_access_token(user_id: UUID, settings: Settings) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_expires_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str, settings: Settings) -> UUID:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise InvalidToken(str(exc)) from exc

    sub = payload.get("sub")
    if not sub:
        raise InvalidToken("token missing subject")
    try:
        return UUID(sub)
    except ValueError as exc:
        raise InvalidToken("token subject is not a valid UUID") from exc
