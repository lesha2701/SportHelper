"""Account endpoints: registration, login/sessions, email verification,
password recovery, account security and the Telegram bridge.

Design notes (see docs/auth.md):
  * the session is an opaque random id in an HttpOnly cookie; only its hash is
    stored server-side, so sessions can be listed and revoked individually;
  * cookie-authenticated, state-changing requests must carry the session-bound
    CSRF token (checked in deps.py);
  * responses never reveal whether an email is registered, except on sign-up
    where a duplicate is reported (and is rate limited);
  * one-time links are random, stored hashed, expire and can be used once.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

import asyncpg
from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response

from app.api.deps import (
    AuthContext,
    get_auth_context,
    get_db,
    get_optional_context,
    get_settings_dep,
    is_admin,
)
from app.config import Settings
from app.core.exceptions import APIError, ConflictError, ForbiddenError, NotFoundError, RateLimitedError, UnauthorizedError
from app.repositories import accounts as accounts_repo
from app.repositories import auth_tokens as tokens_repo
from app.repositories import identities as identities_repo
from app.repositories import legal as legal_repo
from app.repositories import mfa as mfa_repo
from app.repositories import sessions as sessions_repo
from app.repositories import users as users_repo
from app.schemas.auth import (
    AuthOut,
    ChangeEmailIn,
    ChangePasswordIn,
    ClaimIn,
    ClaimInspectOut,
    EmailIn,
    IdentityOut,
    LoginIn,
    MessageOut,
    MfaCodeIn,
    MfaDisableIn,
    MfaEnableOut,
    MfaSetupIn,
    MfaSetupOut,
    MfaStatusOut,
    PasswordIn,
    RegisterIn,
    RegisterOut,
    ResetPasswordIn,
    SessionOut,
    TelegramLinkOut,
    TokenIn,
    VerifyEmailIn,
    VerifyEmailOut,
    VerifyEmailSetPasswordIn,
    VerifyInspectOut,
)
from app.schemas.user import UserOut
from app.security import passwords, totp
from app.security.client import describe_device
from app.security.sessions import clear_session_cookie, set_session_cookie, start_session
from app.security.tokens import csrf_token_for, generate_token, hash_token
from app.services import accounts as svc
from app.services import admin_audit
from app.services import claim as claim_service
from app.services import identities as identities_service
from app.services import legal as legal_service
from app.services import email_templates as templates

logger = logging.getLogger("teamflow.auth")

router = APIRouter(prefix="/api/auth", tags=["auth"])

_BAD_CREDENTIALS = "Неверный email или пароль."
_NEUTRAL_RECOVERY = "Если аккаунт с таким адресом существует, мы отправили письмо."
_NEUTRAL_RESEND = "Если этот адрес ожидает подтверждения, мы отправили письмо."
_INVALID_LINK = "Ссылка недействительна или устарела. Запросите новую."


def _auth_out(user: dict, token: str, settings: Settings) -> AuthOut:
    return AuthOut(**user, csrf_token=csrf_token_for(token, settings.jwt_secret))


async def _require_password(conn: asyncpg.Connection, user_id: UUID, password: str, settings: Settings) -> None:
    """Re-authentication for sensitive changes."""
    stored = await users_repo.get_password_hash(conn, user_id)
    if not stored or not await svc.verify_in_thread(password, stored, settings):
        raise APIError("Неверный текущий пароль.", code="invalid_password", status_code=403, field="password")


# ---------------------------------------------------------------------------
# Registration & email verification
# ---------------------------------------------------------------------------


@router.post("/register", response_model=RegisterOut, status_code=201)
async def register(
    payload: RegisterIn,
    request: Request,
    background: BackgroundTasks,
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> RegisterOut:
    await svc.enforce_rate_limit(request, conn, settings, "register-ip", svc.ip_of(request, settings), limit=10, window_seconds=3600)

    first_name = svc.clean_name(payload.first_name, required=True, field="first_name", label="имя")
    last_name = svc.clean_name(payload.last_name, required=False, field="last_name", label="фамилию")
    assert first_name is not None
    email = svc.normalize_email(payload.email)
    accepted = legal_service.check_consents(payload.role, payload.consents)
    terms_version = accepted[0][1][0]["version"]  # the edition of the first document accepted (the agreement / the offer)
    await svc.validate_new_password(
        payload.password, payload.password_confirm, settings, email=email, first_name=first_name, last_name=last_name
    )
    password_hash = await svc.hash_in_thread(payload.password, settings)

    taken = ConflictError(
        "Аккаунт с таким email уже есть. Войдите или восстановите пароль.", code="email_taken", field="email"
    )
    existing = await users_repo.get_by_email(conn, email)
    if existing is not None and existing["email_verified_at"] is not None:
        raise taken
    full_name = " ".join(part for part in (first_name, last_name) if part)
    ip = svc.ip_of(request, settings)
    # The account and the record of what its owner ticked appear together or not at all.
    async with legal_repo.atomic(conn):
        if existing is not None:
            user = await users_repo.restart_unverified_registration(
                conn,
                existing["id"],
                password_hash=password_hash,
                first_name=first_name,
                last_name=last_name,
                preferred_role=payload.role,
                terms_version=terms_version,
            )
            if user is None:
                raise taken
        else:
            try:
                user = await users_repo.create_with_password(
                    conn,
                    email=email,
                    password_hash=password_hash,
                    first_name=first_name,
                    last_name=last_name,
                    preferred_role=payload.role,
                    terms_version=terms_version,
                )
            except asyncpg.UniqueViolationError as exc:  # lost a race with a concurrent sign-up
                raise taken from exc
        for consent, documents in accepted:
            await legal_repo.record(
                conn,
                user_id=user["id"],
                role=payload.role,
                full_name=full_name,
                phone=None,  # not collected yet
                email=email,
                consent_key=consent.key,
                documents=documents,
                ip_address=ip,
            )

    await svc.send_verification(conn, background, settings, user, email, svc.safe_next(payload.next))
    return RegisterOut(email=email)


# Why confirming an address asks for a password
# ---------------------------------------------
# Anyone can type someone else's email into the sign-up form together with a
# password of their own. If the real owner then clicked "confirm" (they may well
# think it is their own sign-up), the account would go live with the ATTACKER's
# password. So a click alone never activates a password: the confirming person
# must either enter the password the account was registered with (the normal
# case - they just typed it), or, if they don't know it / didn't register, set a
# new one - proving mailbox control is enough for that, and it kills the
# pre-chosen password. The attacker never learns anything and gains no access.


@router.post("/verify-email/inspect", response_model=VerifyInspectOut)
async def inspect_verification(
    payload: TokenIn,
    request: Request,
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> VerifyInspectOut:
    await svc.enforce_rate_limit(request, conn, settings, "verify-ip", svc.ip_of(request, settings), limit=60, window_seconds=3600)
    token = await tokens_repo.peek(conn, hash_token(payload.token), "email_verify")
    if token is None:
        return VerifyInspectOut(valid=False)
    user = await users_repo.get_by_id(conn, token["user_id"])
    if user is None or user.get("deleted_at") is not None:
        return VerifyInspectOut(valid=False)
    return VerifyInspectOut(valid=True, email=claim_service.mask_email(token["new_email"] or ""), first_name=user["first_name"])


@router.post("/verify-email", response_model=VerifyEmailOut)
async def verify_email(
    payload: VerifyEmailIn,
    request: Request,
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> VerifyEmailOut:
    token_hash = hash_token(payload.token)
    await svc.enforce_rate_limit(request, conn, settings, "verify-ip", svc.ip_of(request, settings), limit=30, window_seconds=3600)
    # Guessing the registration password for a link you hold buys nothing, but cap it anyway.
    await svc.enforce_rate_limit(request, conn, settings, "verify-token", token_hash[:24], limit=8, window_seconds=3600)
    pending = await tokens_repo.peek(conn, token_hash, "email_verify")
    if pending is None:
        raise APIError(_INVALID_LINK, code="invalid_token", status_code=400)
    stored = await users_repo.get_password_hash(conn, pending["user_id"])
    if not stored or not await svc.verify_in_thread(payload.password, stored, settings):
        raise APIError(
            "Пароль не совпадает с тем, что указан при регистрации. Если это были не вы или вы его не помните, "
            "задайте новый пароль.",
            code="password_mismatch",
            status_code=403,
            field="password",
        )
    status, user = await accounts_repo.verify_email(conn, token_hash)
    if status == "email_taken":
        raise ConflictError("Этот email уже привязан к другому аккаунту.", code="email_taken")
    if status != "ok" or user is None:
        raise APIError(_INVALID_LINK, code="invalid_token", status_code=400)
    return VerifyEmailOut(verified=True, email=user["email"])


@router.post("/verify-email/set-password", response_model=VerifyEmailOut)
async def verify_email_with_new_password(
    payload: VerifyEmailSetPasswordIn,
    request: Request,
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> VerifyEmailOut:
    """Confirms the address AND replaces the password: for whoever controls the
    mailbox but is not the person who registered (or forgot that password)."""
    token_hash = hash_token(payload.token)
    await svc.enforce_rate_limit(request, conn, settings, "verify-ip", svc.ip_of(request, settings), limit=30, window_seconds=3600)
    pending = await tokens_repo.peek(conn, token_hash, "email_verify")
    owner = await users_repo.get_by_id(conn, pending["user_id"]) if pending else None
    if owner is None or owner.get("deleted_at") is not None:
        raise APIError(_INVALID_LINK, code="invalid_token", status_code=400)
    await svc.validate_new_password(
        payload.password,
        payload.password_confirm,
        settings,
        email=pending["new_email"],
        first_name=owner["first_name"],
        last_name=owner.get("last_name"),
    )
    status, user = await accounts_repo.verify_email(conn, token_hash, await svc.hash_in_thread(payload.password, settings))
    if status == "email_taken":
        raise ConflictError("Этот email уже привязан к другому аккаунту.", code="email_taken")
    if status != "ok" or user is None:
        raise APIError(_INVALID_LINK, code="invalid_token", status_code=400)
    # Anything signed in with the previous password is gone (there should be nothing, but be sure).
    await sessions_repo.revoke_all(conn, user["id"])
    return VerifyEmailOut(verified=True, email=user["email"])


@router.post("/resend-verification", response_model=MessageOut)
async def resend_verification(
    payload: EmailIn,
    request: Request,
    background: BackgroundTasks,
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> MessageOut:
    ip = svc.ip_of(request, settings)
    await svc.enforce_rate_limit(request, conn, settings, "resend-ip", ip, limit=10, window_seconds=3600)
    email = svc.try_normalize_email(payload.email)
    if email is not None:
        # Per-address limit so the endpoint can't be used to mail-bomb someone.
        await svc.enforce_rate_limit(request, conn, settings, "resend-email", email, limit=3, window_seconds=3600)
        user = await users_repo.get_by_email(conn, email)
        if user is not None and user["email_verified_at"] is None and user.get("has_password"):
            await svc.send_verification(conn, background, settings, user, email, svc.safe_next(payload.next))
    return MessageOut(message=_NEUTRAL_RESEND)


# ---------------------------------------------------------------------------
# Login, session, logout
# ---------------------------------------------------------------------------


@router.post("/login", response_model=AuthOut)
async def login(
    payload: LoginIn,
    request: Request,
    response: Response,
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> AuthOut:
    ip = svc.ip_of(request, settings)
    await svc.enforce_rate_limit(request, conn, settings, "login-ip", ip, limit=30, window_seconds=600)
    email = svc.try_normalize_email(payload.email)
    if email is not None:
        # Also keyed by address (existing or not) so guessing is capped per
        # target regardless of how many IPs the attacker uses.
        await svc.enforce_rate_limit(request, conn, settings, "login-email", email, limit=10, window_seconds=900)

    bad_credentials = UnauthorizedError(_BAD_CREDENTIALS, code="invalid_credentials")
    creds = await users_repo.get_credentials_by_email(conn, email) if email else None
    if creds is None or not creds.get("password_hash") or creds.get("deleted_at") is not None:
        # Burn the same time a real check would, so response time doesn't tell
        # an attacker which emails exist.
        await _burn_time(payload.password, settings)
        raise bad_credentials

    now = datetime.now(timezone.utc)
    locked_until = creds.get("locked_until")
    if locked_until is not None and locked_until > now:
        retry = max(1, int((locked_until - now).total_seconds()))
        raise RateLimitedError(
            "Слишком много неудачных попыток входа. Попробуйте позже или восстановите пароль.",
            code="account_locked",
            retry_after=retry,
        )

    if not await svc.verify_in_thread(payload.password, creds["password_hash"], settings):
        newly_locked = await users_repo.register_login_failure(
            conn, creds["id"], max_failures=settings.login_max_failures, lockout_minutes=settings.login_lockout_minutes
        )
        if newly_locked is not None:
            raise RateLimitedError(
                "Слишком много неудачных попыток входа. Попробуйте позже или восстановите пароль.",
                code="account_locked",
                retry_after=settings.login_lockout_minutes * 60,
            )
        raise bad_credentials

    # The password is right from here on, so it is safe to say what is wrong with the account.
    if creds["is_banned"]:
        raise ForbiddenError("Аккаунт заблокирован.", code="banned")
    if creds["email_verified_at"] is None:
        raise APIError(
            "Подтвердите email: мы отправили письмо со ссылкой при регистрации.",
            code="email_not_verified",
            status_code=403,
        )

    if passwords.needs_rehash(creds["password_hash"], settings):
        await users_repo.set_password(conn, creds["id"], await svc.hash_in_thread(payload.password, settings))
    await users_repo.clear_login_failures(conn, creds["id"])

    token, _session = await start_session(conn, request, creds["id"], settings)
    set_session_cookie(response, token, settings)
    user = await users_repo.get_by_id(conn, creds["id"])
    assert user is not None
    return _auth_out(user, token, settings)


async def _burn_time(password: str, settings: Settings) -> None:
    await asyncio.to_thread(passwords.dummy_verify, password, settings)


@router.get("/me", response_model=AuthOut)
async def get_me(ctx: AuthContext = Depends(get_auth_context), settings: Settings = Depends(get_settings_dep)) -> AuthOut:
    return _auth_out(ctx.user, ctx.token, settings)


@router.post("/logout", response_model=MessageOut)
async def logout(
    response: Response,
    ctx: AuthContext | None = Depends(get_optional_context),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> MessageOut:
    if ctx is not None:
        await sessions_repo.revoke(conn, ctx.user["id"], ctx.session["id"])
    clear_session_cookie(response, settings)
    return MessageOut(message="Вы вышли из аккаунта.")


@router.post("/logout-all", response_model=MessageOut)
async def logout_all(
    response: Response,
    ctx: AuthContext = Depends(get_auth_context),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> MessageOut:
    await sessions_repo.revoke_all(conn, ctx.user["id"])
    clear_session_cookie(response, settings)
    return MessageOut(message="Вы вышли на всех устройствах.")


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(
    ctx: AuthContext = Depends(get_auth_context), conn: asyncpg.Connection = Depends(get_db)
) -> list[SessionOut]:
    rows = await sessions_repo.list_for_user(conn, ctx.user["id"])
    return [
        SessionOut(
            id=row["id"],
            device=describe_device(row["user_agent"]),
            ip_address=row["ip_address"],
            created_at=row["created_at"],
            last_seen_at=row["last_seen_at"],
            current=row["id"] == ctx.session["id"],
        )
        for row in rows
    ]


@router.delete("/sessions/{session_id}", response_model=MessageOut)
async def revoke_session(
    session_id: UUID,
    response: Response,
    ctx: AuthContext = Depends(get_auth_context),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> MessageOut:
    # Scoped by user id in SQL: another user's session id is simply "not found".
    if not await sessions_repo.revoke(conn, ctx.user["id"], session_id):
        raise NotFoundError("session not found")
    if session_id == ctx.session["id"]:
        clear_session_cookie(response, settings)
    return MessageOut(message="Сессия завершена.")


# ---------------------------------------------------------------------------
# Password recovery & change
# ---------------------------------------------------------------------------


@router.post("/forgot-password", response_model=MessageOut)
async def forgot_password(
    payload: EmailIn,
    request: Request,
    background: BackgroundTasks,
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> MessageOut:
    ip = svc.ip_of(request, settings)
    await svc.enforce_rate_limit(request, conn, settings, "forgot-ip", ip, limit=10, window_seconds=3600)
    email = svc.try_normalize_email(payload.email)
    if email is not None:
        await svc.enforce_rate_limit(request, conn, settings, "forgot-email", email, limit=3, window_seconds=3600)
        user = await users_repo.get_by_email(conn, email)
        if user is not None and user.get("deleted_at") is None and (user.get("has_password") or user["email_verified_at"]):
            if user["email_verified_at"] is None:
                # Recovering a never-confirmed account = confirming it first.
                await svc.send_verification(conn, background, settings, user, email)
            else:
                token = await svc.issue_token(
                    conn,
                    user_id=user["id"],
                    purpose="password_reset",
                    ttl=timedelta(minutes=settings.password_reset_ttl_minutes),
                )
                svc.queue_email(
                    background, templates.password_reset_email(settings, email, user["first_name"], token), settings
                )
    # Identical answer whether or not the account exists.
    return MessageOut(message=_NEUTRAL_RECOVERY)


@router.post("/reset-password", response_model=MessageOut)
async def reset_password(
    payload: ResetPasswordIn,
    request: Request,
    background: BackgroundTasks,
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> MessageOut:
    await svc.enforce_rate_limit(request, conn, settings, "reset-ip", svc.ip_of(request, settings), limit=20, window_seconds=3600)
    token_hash = hash_token(payload.token)
    pending = await tokens_repo.peek(conn, token_hash, "password_reset")
    if pending is None:
        raise APIError(_INVALID_LINK, code="invalid_token", status_code=400)
    owner = await users_repo.get_by_id(conn, pending["user_id"])
    if owner is None or owner.get("deleted_at") is not None:
        raise APIError(_INVALID_LINK, code="invalid_token", status_code=400)

    await svc.validate_new_password(
        payload.password,
        payload.password_confirm,
        settings,
        email=owner.get("email"),
        first_name=owner["first_name"],
        last_name=owner.get("last_name"),
    )
    password_hash = await svc.hash_in_thread(payload.password, settings)
    user = await accounts_repo.reset_password(conn, token_hash, password_hash)
    if user is None:
        raise APIError(_INVALID_LINK, code="invalid_token", status_code=400)
    if user.get("email"):
        svc.queue_email(background, templates.password_changed_email(settings, user["email"], user["first_name"]), settings)
    return MessageOut(message="Пароль изменён. Теперь можно войти.")


@router.post("/change-password", response_model=MessageOut)
async def change_password(
    payload: ChangePasswordIn,
    request: Request,
    background: BackgroundTasks,
    ctx: AuthContext = Depends(get_auth_context),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> MessageOut:
    user = ctx.user
    await svc.enforce_rate_limit(request, conn, settings, "change-password", str(user["id"]), limit=10, window_seconds=3600)
    await _require_password(conn, user["id"], payload.current_password, settings)
    if payload.new_password == payload.current_password:
        raise svc.validation_error("Новый пароль должен отличаться от текущего.", "new_password")
    await svc.validate_new_password(
        payload.new_password,
        payload.new_password_confirm,
        settings,
        email=user.get("email"),
        first_name=user["first_name"],
        last_name=user.get("last_name"),
        field="new_password",
        confirm_field="new_password_confirm",
    )
    await users_repo.set_password(conn, user["id"], await svc.hash_in_thread(payload.new_password, settings))
    # Everyone else is signed out; this device stays signed in.
    await sessions_repo.revoke_all(conn, user["id"], except_session_id=ctx.session["id"])
    if user.get("email"):
        svc.queue_email(background, templates.password_changed_email(settings, user["email"], user["first_name"]), settings)
    return MessageOut(message="Пароль изменён. На других устройствах вы вышли из аккаунта.")


# ---------------------------------------------------------------------------
# Email change
# ---------------------------------------------------------------------------


@router.post("/change-email", response_model=MessageOut)
async def change_email(
    payload: ChangeEmailIn,
    request: Request,
    background: BackgroundTasks,
    ctx: AuthContext = Depends(get_auth_context),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> MessageOut:
    user = ctx.user
    await svc.enforce_rate_limit(request, conn, settings, "change-email", str(user["id"]), limit=5, window_seconds=3600)
    await _require_password(conn, user["id"], payload.password, settings)
    new_email = svc.normalize_email(payload.new_email, field="new_email")
    if user.get("email") and new_email == user["email"].lower():
        raise svc.validation_error("Это уже ваш текущий адрес.", "new_email")
    if await users_repo.get_by_email(conn, new_email) is not None:
        raise ConflictError("Этот email уже используется другим аккаунтом.", code="email_taken", field="new_email")

    token = await svc.issue_token(
        conn,
        user_id=user["id"],
        purpose="email_change",
        ttl=timedelta(hours=settings.email_change_ttl_hours),
        new_email=new_email,
    )
    # New address gets the confirmation link; the old one is warned so a
    # hijacked session can't silently redirect the account.
    svc.queue_email(background, templates.email_change_confirm_email(settings, new_email, user["first_name"], token), settings)
    if user.get("email"):
        svc.queue_email(
            background, templates.email_change_notice_email(settings, user["email"], user["first_name"], new_email), settings
        )
    return MessageOut(message=f"Мы отправили письмо на {new_email}. Email изменится после подтверждения.")


@router.post("/confirm-email-change", response_model=VerifyEmailOut)
async def confirm_email_change(
    payload: TokenIn,
    request: Request,
    background: BackgroundTasks,
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> VerifyEmailOut:
    await svc.enforce_rate_limit(request, conn, settings, "confirm-email-ip", svc.ip_of(request, settings), limit=30, window_seconds=3600)
    status, user, old_email = await accounts_repo.confirm_email_change(conn, hash_token(payload.token))
    if status == "email_taken":
        raise ConflictError("Этот email уже привязан к другому аккаунту.", code="email_taken")
    if status != "ok" or user is None:
        raise APIError(_INVALID_LINK, code="invalid_token", status_code=400)
    if old_email and old_email != user["email"]:
        svc.queue_email(
            background, templates.email_changed_notice_email(settings, old_email, user["first_name"], user["email"]), settings
        )
    return VerifyEmailOut(verified=True, email=user["email"])


# ---------------------------------------------------------------------------
# Moving a legacy Telegram account to email + password
# ---------------------------------------------------------------------------


@router.post("/claim/inspect", response_model=ClaimInspectOut)
async def inspect_claim(
    payload: TokenIn,
    request: Request,
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> ClaimInspectOut:
    await svc.enforce_rate_limit(request, conn, settings, "claim-ip", svc.ip_of(request, settings), limit=30, window_seconds=3600)
    token = await tokens_repo.peek(conn, hash_token(payload.token), "telegram_claim")
    if token is None:
        return ClaimInspectOut(valid=False)
    user = await users_repo.get_by_id(conn, token["user_id"])
    if user is None or user["email_verified_at"] is not None:
        return ClaimInspectOut(valid=False)
    return ClaimInspectOut(valid=True, first_name=user["first_name"])


@router.post("/claim", response_model=RegisterOut)
async def claim_account(
    payload: ClaimIn,
    request: Request,
    background: BackgroundTasks,
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> RegisterOut:
    """Finishes the bot-started migration: the Telegram owner picks an email and
    a password for their EXISTING account (same id, same data)."""
    await svc.enforce_rate_limit(request, conn, settings, "claim-ip", svc.ip_of(request, settings), limit=30, window_seconds=3600)
    email = svc.normalize_email(payload.email)
    if not payload.accept_terms:
        raise svc.validation_error(
            "Для продолжения нужно принять пользовательское соглашение и политику конфиденциальности.", "accept_terms"
        )
    claim_hash = hash_token(payload.token)
    pending = await tokens_repo.peek(conn, claim_hash, "telegram_claim")
    owner = await users_repo.get_by_id(conn, pending["user_id"]) if pending else None
    if owner is None or owner["email_verified_at"] is not None:
        raise APIError(_INVALID_LINK, code="invalid_token", status_code=400)
    await svc.validate_new_password(
        payload.password,
        payload.password_confirm,
        settings,
        email=email,
        first_name=owner["first_name"],
        last_name=owner.get("last_name"),
    )

    verify_token = generate_token()
    status, user = await accounts_repo.claim_account(
        conn,
        claim_token_hash=claim_hash,
        email=email,
        password_hash=await svc.hash_in_thread(payload.password, settings),
        terms_version=settings.terms_version,
        verify_token_hash=hash_token(verify_token),
        verify_expires_at=datetime.now(timezone.utc) + timedelta(hours=settings.email_verify_ttl_hours),
    )
    if status == "email_taken":
        raise ConflictError("Аккаунт с таким email уже есть. Укажите другой адрес.", code="email_taken", field="email")
    if status != "ok" or user is None:
        raise APIError(_INVALID_LINK, code="invalid_token", status_code=400)
    svc.queue_email(background, templates.verification_email(settings, email, user["first_name"], verify_token), settings)
    return RegisterOut(email=email)


# ---------------------------------------------------------------------------
# Telegram as an optional notification channel
# ---------------------------------------------------------------------------


@router.post("/telegram/link", response_model=TelegramLinkOut)
async def start_telegram_link(
    ctx: AuthContext = Depends(get_auth_context),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> TelegramLinkOut:
    if not settings.telegram_active or not settings.telegram_bot_username:
        raise APIError("Telegram-уведомления не настроены.", code="telegram_unavailable", status_code=503)
    ttl = timedelta(minutes=settings.telegram_token_ttl_minutes)
    token = await svc.issue_token(conn, user_id=ctx.user["id"], purpose="telegram_link", ttl=ttl)
    return TelegramLinkOut(
        bot_url=f"https://t.me/{settings.telegram_bot_username}?start=link_{token}",
        expires_in=int(ttl.total_seconds()),
    )


@router.post("/telegram/unlink", response_model=MessageOut)
async def unlink_telegram(
    ctx: AuthContext = Depends(get_auth_context), conn: asyncpg.Connection = Depends(get_db)
) -> MessageOut:
    await users_repo.unlink_telegram(conn, ctx.user["id"])
    return MessageOut(message="Telegram отвязан.")


# ---------------------------------------------------------------------------
# Linked external sign-in accounts (Yandex ID / VK ID - groundwork, see
# services/identities.py: the OAuth exchange itself is not implemented yet)
# ---------------------------------------------------------------------------


@router.get("/identities", response_model=list[IdentityOut])
async def list_identities(
    ctx: AuthContext = Depends(get_auth_context), conn: asyncpg.Connection = Depends(get_db)
) -> list[IdentityOut]:
    rows = await identities_repo.list_for_user(conn, ctx.user["id"])
    return [
        IdentityOut(
            provider=r["provider"],
            display_name=r["display_name"],
            email=r["provider_email"],
            linked_at=r["created_at"],
            last_login_at=r["last_login_at"],
        )
        for r in rows
    ]


@router.delete("/identities/{provider}", response_model=MessageOut)
async def unlink_identity(
    provider: str, ctx: AuthContext = Depends(get_auth_context), conn: asyncpg.Connection = Depends(get_db)
) -> MessageOut:
    status = await identities_service.unlink_identity(conn, ctx.user, provider)
    if status == "not_found":
        raise NotFoundError("linked account not found")
    if status == "last_login_method":
        raise ConflictError(
            "Это единственный способ входа. Сначала задайте пароль (через «Забыли пароль?») или привяжите другой аккаунт.",
            code="last_login_method",
        )
    return MessageOut(message="Аккаунт отвязан.")


# ---------------------------------------------------------------------------
# Account deletion
# ---------------------------------------------------------------------------


@router.post("/account/delete", response_model=MessageOut)
async def request_account_deletion(
    payload: PasswordIn,
    request: Request,
    background: BackgroundTasks,
    ctx: AuthContext = Depends(get_auth_context),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> MessageOut:
    user = ctx.user
    await svc.enforce_rate_limit(request, conn, settings, "delete-account", str(user["id"]), limit=5, window_seconds=3600)
    await _require_password(conn, user["id"], payload.password, settings)
    await users_repo.request_deletion(conn, user["id"])
    if user.get("email"):
        svc.queue_email(background, templates.deletion_requested_email(settings, user["email"], user["first_name"]), settings)
    return MessageOut(
        message=f"Запрос принят. Аккаунт будет удалён через {settings.account_deletion_grace_days} дн. "
        "До этого момента удаление можно отменить."
    )


@router.post("/account/delete/cancel", response_model=MessageOut)
async def cancel_account_deletion(
    ctx: AuthContext = Depends(get_auth_context), conn: asyncpg.Connection = Depends(get_db)
) -> MessageOut:
    await users_repo.cancel_deletion(conn, ctx.user["id"])
    return MessageOut(message="Удаление аккаунта отменено.")


# ---------------------------------------------------------------------------
# Two-factor authentication (required for administrators before sensitive
# operations - see deps.require_admin_mfa)
# ---------------------------------------------------------------------------


def _hash_recovery_code(code: str) -> str:
    return hash_token(code.strip().lower())


@router.get("/mfa", response_model=MfaStatusOut)
async def mfa_status(
    ctx: AuthContext = Depends(get_auth_context),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> MfaStatusOut:
    mfa = await mfa_repo.get(conn, ctx.user["id"])
    verified_at = ctx.session.get("mfa_verified_at")
    window = timedelta(hours=settings.admin_mfa_session_hours)
    return MfaStatusOut(
        is_admin=is_admin(ctx.user, settings),
        enabled=bool(mfa and mfa["enabled_at"]),
        session_verified=bool(verified_at and datetime.now(timezone.utc) - verified_at <= window),
    )


@router.post("/mfa/setup", response_model=MfaSetupOut)
async def mfa_setup(
    payload: MfaSetupIn,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> MfaSetupOut:
    if not is_admin(ctx.user, settings):
        raise ForbiddenError("two-factor authentication is only available to administrators")
    await svc.enforce_rate_limit(request, conn, settings, "mfa", str(ctx.user["id"]), limit=10, window_seconds=600)
    await _require_password(conn, ctx.user["id"], payload.password, settings)
    existing = await mfa_repo.get(conn, ctx.user["id"])
    if existing and existing["enabled_at"]:
        raise ConflictError("Двухфакторная защита уже включена.", code="mfa_already_enabled")
    secret = totp.generate_secret()
    await mfa_repo.begin_setup(conn, ctx.user["id"], totp.encrypt_secret(secret, settings.jwt_secret))
    return MfaSetupOut(secret=secret, otpauth_uri=totp.provisioning_uri(secret, ctx.user["email"] or str(ctx.user["id"])))


@router.post("/mfa/enable", response_model=MfaEnableOut)
async def mfa_enable(
    payload: MfaCodeIn,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> MfaEnableOut:
    await svc.enforce_rate_limit(request, conn, settings, "mfa", str(ctx.user["id"]), limit=10, window_seconds=600)
    mfa = await mfa_repo.get(conn, ctx.user["id"])
    if mfa is None or mfa["enabled_at"]:
        raise APIError("Сначала начните настройку двухфакторной защиты.", code="mfa_not_started", status_code=409)
    secret = totp.decrypt_secret(mfa["secret_encrypted"], settings.jwt_secret)
    step = totp.verify_code(secret, payload.code) if secret else None
    if step is None:
        raise APIError("Неверный код.", code="invalid_code", status_code=400, field="code")
    codes = totp.generate_recovery_codes()
    await mfa_repo.enable(conn, ctx.user["id"], [_hash_recovery_code(c) for c in codes], step)
    await sessions_repo.mark_mfa_verified(conn, ctx.session["id"])
    await admin_audit.record(conn, ctx.user["id"], "mfa_enabled", target_type="user", target_id=ctx.user["id"])
    return MfaEnableOut(recovery_codes=codes)


@router.post("/mfa/verify", response_model=MessageOut)
async def mfa_verify(
    payload: MfaCodeIn,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> MessageOut:
    await svc.enforce_rate_limit(request, conn, settings, "mfa", str(ctx.user["id"]), limit=10, window_seconds=600)
    if not await _check_second_factor(conn, ctx.user["id"], payload.code, settings):
        raise APIError("Неверный код.", code="invalid_code", status_code=400, field="code")
    await sessions_repo.mark_mfa_verified(conn, ctx.session["id"])
    return MessageOut(message="Код принят.")


@router.post("/mfa/disable", response_model=MessageOut)
async def mfa_disable(
    payload: MfaDisableIn,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> MessageOut:
    await svc.enforce_rate_limit(request, conn, settings, "mfa", str(ctx.user["id"]), limit=10, window_seconds=600)
    await _require_password(conn, ctx.user["id"], payload.password, settings)
    if not await _check_second_factor(conn, ctx.user["id"], payload.code, settings):
        raise APIError("Неверный код.", code="invalid_code", status_code=400, field="code")
    await mfa_repo.disable(conn, ctx.user["id"])
    await admin_audit.record(conn, ctx.user["id"], "mfa_disabled", target_type="user", target_id=ctx.user["id"])
    return MessageOut(message="Двухфакторная защита отключена.")


async def _check_second_factor(conn: asyncpg.Connection, user_id: UUID, code: str, settings: Settings) -> bool:
    mfa = await mfa_repo.get(conn, user_id)
    if mfa is None or not mfa["enabled_at"]:
        return False
    secret = totp.decrypt_secret(mfa["secret_encrypted"], settings.jwt_secret)
    if secret:
        step = totp.verify_code(secret, code, last_used_step=mfa["last_used_step"])
        if step is not None:
            await mfa_repo.record_step(conn, user_id, step)  # the same code can't be replayed
            return True
    return await mfa_repo.use_recovery_code(conn, user_id, _hash_recovery_code(code))
