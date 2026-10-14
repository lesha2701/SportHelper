"""Password hashing (Argon2id) and the password policy.

Policy follows NIST SP 800-63B: a minimum length and a blocklist of obviously
weak / breached passwords, but no arbitrary composition rules (no required
capital letter or symbol). Any Unicode is allowed and long passphrases are fine.
"""
from __future__ import annotations

import hashlib
import logging
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache

import httpx
from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.config import Settings
from app.security.common_passwords import COMMON_PASSWORDS

logger = logging.getLogger("teamflow.passwords")


class PasswordPolicyError(Exception):
    """The password is unacceptable; the message is safe to show to the user."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def normalize_password(password: str) -> str:
    # NFKC so the same visible password typed on different keyboards/devices
    # (composed vs decomposed accents, full-width characters) hashes the same.
    return unicodedata.normalize("NFKC", password)


@lru_cache(maxsize=4)
def _hasher(time_cost: int, memory_kib: int, parallelism: int) -> PasswordHasher:
    return PasswordHasher(
        time_cost=time_cost,
        memory_cost=memory_kib,
        parallelism=parallelism,
        type=Type.ID,
    )


def _hasher_for(settings: Settings) -> PasswordHasher:
    return _hasher(settings.argon2_time_cost, settings.argon2_memory_kib, settings.argon2_parallelism)


def hash_password(password: str, settings: Settings) -> str:
    return _hasher_for(settings).hash(normalize_password(password))


def verify_password(password: str, password_hash: str, settings: Settings) -> bool:
    try:
        return _hasher_for(settings).verify(password_hash, normalize_password(password))
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str, settings: Settings) -> bool:
    try:
        return _hasher_for(settings).check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def dummy_verify(password: str, settings: Settings) -> None:
    """Spends the same time as a real verification, so a login attempt for an
    unknown email isn't measurably faster than one for a known email."""
    verify_password(password, _dummy_hash(settings), settings)


@lru_cache(maxsize=4)
def _dummy_hash_cached(time_cost: int, memory_kib: int, parallelism: int) -> str:
    return _hasher(time_cost, memory_kib, parallelism).hash("dummy-password-for-timing-equalisation")


def _dummy_hash(settings: Settings) -> str:
    return _dummy_hash_cached(settings.argon2_time_cost, settings.argon2_memory_kib, settings.argon2_parallelism)


@dataclass(frozen=True)
class PolicyContext:
    """Personal data the password must not be built from."""

    email: str | None = None
    first_name: str | None = None
    last_name: str | None = None


def _is_trivial_pattern(password: str) -> bool:
    if len(set(password)) <= 2:
        return True  # "aaaaaaaaaaaa", "abababababab"
    lowered = password.lower()
    for sequence in ("0123456789", "abcdefghijklmnopqrstuvwxyz", "qwertyuiop", "asdfghjkl", "zxcvbnm",
                     "йцукенгшщзхъ", "фывапролджэ", "ячсмитьбю"):
        if len(lowered) >= 8 and lowered in (sequence, sequence[::-1]):
            return True
    return False


def check_password_policy(password: str, settings: Settings, context: PolicyContext | None = None) -> None:
    """Raises PasswordPolicyError if the password is not acceptable.

    The breached-password (HIBP) check is separate because it is async/network;
    see `check_breached`."""
    password = normalize_password(password)
    if len(password) < settings.password_min_length:
        raise PasswordPolicyError(
            "password_too_short", f"Пароль слишком короткий: минимум {settings.password_min_length} символов."
        )
    if len(password) > settings.password_max_length:
        raise PasswordPolicyError(
            "password_too_long", f"Пароль слишком длинный: максимум {settings.password_max_length} символов."
        )
    if password.strip() == "":
        raise PasswordPolicyError("password_blank", "Пароль не может состоять только из пробелов.")
    if password.lower() in COMMON_PASSWORDS or _is_trivial_pattern(password):
        raise PasswordPolicyError(
            "password_common", "Этот пароль слишком распространён. Придумайте другой — например, несколько слов подряд."
        )
    if context is not None:
        lowered = password.lower()
        parts: list[str] = []
        if context.email:
            if context.email.lower() in lowered:
                raise PasswordPolicyError(
                    "password_personal", "Пароль не должен совпадать с вашим именем или email."
                )
            parts.append(context.email.split("@", 1)[0].lower())
        for name in (context.first_name, context.last_name):
            if name:
                parts.append(name.strip().lower())
        for part in parts:
            # Short fragments ("ivan" inside a long passphrase) are fine; only
            # reject a password that is essentially the personal value.
            if len(part) >= 4 and part in lowered and len(lowered) - len(part) <= 4:
                raise PasswordPolicyError(
                    "password_personal", "Пароль не должен совпадать с вашим именем или email."
                )


_HIBP_URL = "https://api.pwnedpasswords.com/range/"


async def check_breached(password: str, settings: Settings) -> None:
    """k-anonymity lookup against Have I Been Pwned: only the first five hex
    characters of the SHA-1 are sent, the password itself never leaves the
    server. Fails open (the password is accepted) if the service is unreachable."""
    if not settings.password_breach_check:
        return
    digest = hashlib.sha1(normalize_password(password).encode("utf-8"), usedforsecurity=False).hexdigest().upper()
    prefix, suffix = digest[:5], digest[5:]
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(_HIBP_URL + prefix, headers={"Add-Padding": "true"})
            response.raise_for_status()
    except httpx.HTTPError:
        logger.warning("Breached-password check skipped: HIBP is unreachable")
        return
    for line in response.text.splitlines():
        candidate, _, count = line.partition(":")
        if candidate.strip() == suffix and count.strip() not in ("", "0"):
            raise PasswordPolicyError(
                "password_breached",
                "Этот пароль встречается в утечках данных. Пожалуйста, придумайте другой.",
            )


_WHITESPACE_RE = re.compile(r"\s+")


def clean_display_name(value: str) -> str:
    return _WHITESPACE_RE.sub(" ", value).strip()
