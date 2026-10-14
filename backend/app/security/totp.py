"""TOTP (RFC 6238) second factor, plus encryption of the stored secret."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

from cryptography.fernet import Fernet, InvalidToken

_STEP_SECONDS = 30
_DIGITS = 6


def generate_secret() -> str:
    # 160 bits, base32 (the format authenticator apps expect).
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _hotp(secret: str, counter: int) -> str:
    padded = secret + "=" * (-len(secret) % 8)
    key = base64.b32decode(padded, casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF) % (10**_DIGITS)
    return str(code).zfill(_DIGITS)


def current_step(now: float | None = None) -> int:
    return int((now if now is not None else time.time()) // _STEP_SECONDS)


def verify_code(secret: str, code: str, *, now: float | None = None, last_used_step: int | None = None) -> int | None:
    """Returns the matched time-step (so the caller can store it and refuse
    a replay of the same code), or None if the code is wrong. Allows one step
    of clock drift either way."""
    code = code.strip().replace(" ", "")
    if len(code) != _DIGITS or not code.isdigit():
        return None
    step_now = current_step(now)
    for step in (step_now, step_now - 1, step_now + 1):
        if last_used_step is not None and step <= last_used_step:
            continue
        if hmac.compare_digest(_hotp(secret, step), code):
            return step
    return None


def provisioning_uri(secret: str, account: str, issuer: str = "SportArena Global") -> str:
    return (
        f"otpauth://totp/{quote(issuer)}:{quote(account)}"
        f"?secret={secret}&issuer={quote(issuer)}&algorithm=SHA1&digits={_DIGITS}&period={_STEP_SECONDS}"
    )


def _fernet(server_secret: str) -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(f"mfa-secret-key:{server_secret}".encode("utf-8")).digest())
    return Fernet(key)


def encrypt_secret(secret: str, server_secret: str) -> str:
    return _fernet(server_secret).encrypt(secret.encode("ascii")).decode("ascii")


def decrypt_secret(token: str, server_secret: str) -> str | None:
    try:
        return _fernet(server_secret).decrypt(token.encode("ascii")).decode("ascii")
    except InvalidToken:
        return None


def generate_recovery_codes(count: int = 8) -> list[str]:
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
    return ["".join(secrets.choice(alphabet) for _ in range(10)) for _ in range(count)]
