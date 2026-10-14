"""Shared helpers for the account endpoints: input normalisation, rate
limiting, and one-time-token issuing."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg
from email_validator import EmailNotValidError, validate_email
from fastapi import BackgroundTasks, Request

from app.config import Settings
from app.core.exceptions import APIError, RateLimitedError
from app.core.rate_limit import SlidingWindowLimiter
from app.repositories import auth_tokens as tokens_repo
from app.security import passwords
from app.security.client import client_ip
from app.security.tokens import generate_token, hash_token
from app.services import email as email_service
from app.services import email_templates as templates


def validation_error(message: str, field: str | None = None, code: str = "validation_error") -> APIError:
    return APIError(message, code=code, status_code=422, field=field)


def normalize_email(raw: str, *, field: str = "email") -> str:
    """Trims, validates the format and lower-cases (the whole address, so
    uniqueness is case-insensitive). Does not touch the network."""
    candidate = (raw or "").strip()
    if not candidate or len(candidate) > 254:
        raise validation_error("Введите корректный email.", field)
    try:
        result = validate_email(candidate, check_deliverability=False, allow_smtputf8=True)
    except EmailNotValidError as exc:
        raise validation_error("Введите корректный email.", field) from exc
    return result.normalized.lower()


def safe_next(raw: str | None) -> str | None:
    """A same-site path the visitor was heading for ("/?book=<id>"), carried
    through the email round trip so sign-up -> confirm -> sign-in lands where
    they started. Anything that isn't a plain absolute path is dropped, so a
    crafted value can never turn a confirmation link into an open redirect."""
    if not raw or len(raw) > 500 or not raw.startswith("/") or raw.startswith(("//", "/\\")):
        return None
    if any(ord(ch) < 0x20 or ch in "\\<>\"'" for ch in raw):
        return None
    return raw


def try_normalize_email(raw: str) -> str | None:
    try:
        return normalize_email(raw)
    except APIError:
        return None


def clean_name(raw: str | None, *, required: bool, field: str, label: str) -> str | None:
    value = passwords.clean_display_name(raw or "")
    if not value:
        if required:
            raise validation_error(f"Укажите {label}.", field)
        return None
    if len(value) > 100:
        raise validation_error(f"Слишком длинное значение: {label}.", field)
    return value


def get_limiter(request: Request) -> SlidingWindowLimiter:
    return request.app.state.auth_limiter


def enforce_rate_limit(
    request: Request, settings: Settings, bucket: str, key: str, *, limit: int, window_seconds: int
) -> None:
    if not settings.auth_rate_limit_enabled:
        return
    allowed, retry_after = get_limiter(request).hit(f"{bucket}:{key}", limit, window_seconds)
    if not allowed:
        raise RateLimitedError(
            "Слишком много попыток. Подождите немного и попробуйте снова.", retry_after=retry_after
        )


def ip_of(request: Request, settings: Settings) -> str:
    return client_ip(request, settings)


async def hash_in_thread(password: str, settings: Settings) -> str:
    # Argon2 is deliberately slow (tens of ms of CPU): keep it off the event loop.
    return await asyncio.to_thread(passwords.hash_password, password, settings)


async def verify_in_thread(password: str, password_hash: str, settings: Settings) -> bool:
    return await asyncio.to_thread(passwords.verify_password, password, password_hash, settings)


async def validate_new_password(
    password: str,
    confirm: str | None,
    settings: Settings,
    *,
    email: str | None,
    first_name: str | None,
    last_name: str | None,
    field: str = "password",
    confirm_field: str = "password_confirm",
) -> None:
    if confirm is not None and password != confirm:
        raise validation_error("Пароли не совпадают.", confirm_field)
    try:
        passwords.check_password_policy(
            password, settings, passwords.PolicyContext(email=email, first_name=first_name, last_name=last_name)
        )
        await passwords.check_breached(password, settings)
    except passwords.PasswordPolicyError as exc:
        raise validation_error(exc.message, field, code=exc.code) from exc


async def issue_token(
    conn: asyncpg.Connection,
    *,
    user_id: Any,
    purpose: str,
    ttl: timedelta,
    new_email: str | None = None,
    supersede: bool = True,
) -> str:
    token = generate_token()
    await tokens_repo.create(
        conn,
        user_id=user_id,
        purpose=purpose,
        token_hash=hash_token(token),
        expires_at=datetime.now(timezone.utc) + ttl,
        new_email=new_email,
        supersede=supersede,
    )
    return token


def queue_email(background: BackgroundTasks, mail: email_service.OutgoingEmail, settings: Settings) -> None:
    # Looked up through the module so tests can swap the sender.
    background.add_task(email_service.send_email, mail, settings)


async def send_verification(
    conn: asyncpg.Connection,
    background: BackgroundTasks,
    settings: Settings,
    user: dict[str, Any],
    email: str,
    next_path: str | None = None,
) -> None:
    token = await issue_token(
        conn,
        user_id=user["id"],
        purpose="email_verify",
        ttl=timedelta(hours=settings.email_verify_ttl_hours),
        new_email=email,
    )
    queue_email(
        background, templates.verification_email(settings, email, user["first_name"], token, next_path), settings
    )
