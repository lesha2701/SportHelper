"""Opaque random tokens (sessions, email links, Telegram handshakes).

Tokens are 256 random bits, so a plain SHA-256 is enough to store them: there
is nothing to brute-force. Only the hash is ever written to the database, so a
leaked table can't be replayed.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def csrf_token_for(session_token: str, secret: str) -> str:
    """CSRF token bound to one session: an attacker's page can neither read it
    (it is only handed to our own origin via /api/auth/me) nor derive it."""
    return hmac.new(secret.encode("utf-8"), f"csrf:{session_token}".encode("utf-8"), hashlib.sha256).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))
