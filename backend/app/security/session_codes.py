"""The athlete's one-time code for an in-person session: six digits the athlete shows and the coach enters.

The code is random (secrets), stored only as an HMAC keyed by the server secret and bound to the booking, so a leaked table reveals nothing
and a code of one booking is worthless for another. Guessing is bounded by the attempts and issue limits in services/session_confirmation.py."""
from __future__ import annotations

import hashlib
import hmac
import secrets
from uuid import UUID

DIGITS = 6


def generate() -> str:
    return f"{secrets.randbelow(10 ** DIGITS):0{DIGITS}d}"


def digest(code: str, *, booking_id: UUID, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), f"session-code:{booking_id}:{code}".encode("utf-8"), hashlib.sha256).hexdigest()


def matches(code: str, stored_hash: str, *, booking_id: UUID, secret: str) -> bool:
    return hmac.compare_digest(digest(code, booking_id=booking_id, secret=secret), stored_hash)


def normalize(raw: str) -> str | None:
    """What the coach typed, without spaces and dashes; None if it cannot be a code at all."""
    code = "".join(ch for ch in raw if not ch.isspace() and ch != "-")
    return code if len(code) == DIGITS and code.isdigit() else None
