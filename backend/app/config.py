"""Application configuration loaded from environment / .env file.

Two instances (sandbox and main) run from the same codebase but with
different env files. Point ENV_FILE at the desired file before starting
the process (defaults to ".env" in the repository root):

    ENV_FILE=.env.sandbox python -m app.main
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent
DATABASE_DIR = PROJECT_ROOT / "database"

_env_file_name = os.environ.get("ENV_FILE", ".env")
_env_file_path = Path(_env_file_name)
if not _env_file_path.is_absolute():
    _env_file_path = PROJECT_ROOT / _env_file_path


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_env_file_path),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_mode: str = Field(default="sandbox", alias="APP_MODE")

    telegram_bot_token: str = Field(default="", alias="TELEGRAM_BOT_TOKEN")
    telegram_bot_username: str = Field(default="", alias="TELEGRAM_BOT_USERNAME")

    database_url: str = Field(
        default="postgresql://teamflow:teamflow@localhost:5432/teamflow_sandbox",
        alias="DATABASE_URL",
    )
    database_pool_min_size: int = Field(default=1, alias="DATABASE_POOL_MIN_SIZE")
    database_pool_max_size: int = Field(default=10, alias="DATABASE_POOL_MAX_SIZE")

    # Server secret used to derive per-session CSRF tokens and the key that
    # encrypts stored TOTP secrets. Sessions themselves are random opaque ids
    # (see app/security/sessions.py), not JWTs.
    jwt_secret: str = Field(default="change-me-to-a-long-random-string", alias="JWT_SECRET")

    # Public address of the website, used to build links in emails and in the
    # Telegram bot. No trailing slash.
    # MINI_APP_URL (the old name of this setting) is still honoured.
    app_base_url: str = Field(
        default="http://localhost:5173",
        validation_alias=AliasChoices("APP_BASE_URL", "MINI_APP_URL"),
    )

    # --- Sessions & cookies ---------------------------------------------------
    session_lifetime_days: int = Field(default=30, alias="SESSION_LIFETIME_DAYS")
    # Hard cap regardless of activity, so a stolen cookie can't live forever.
    session_absolute_max_days: int = Field(default=90, alias="SESSION_ABSOLUTE_MAX_DAYS")
    # `Secure` + the `__Host-` cookie prefix. Left unset it follows APP_BASE_URL
    # (https:// -> secure), so a production .env that forgets it is still safe.
    cookie_secure: bool | None = Field(default=None, alias="COOKIE_SECURE")
    # lax: the site and /api share one origin behind the reverse proxy. Use
    # "none" (requires COOKIE_SECURE=true) only if the API lives on another site.
    cookie_samesite: str = Field(default="lax", alias="COOKIE_SAMESITE")
    # Leave empty for a host-only cookie (recommended).
    cookie_domain: str = Field(default="", alias="COOKIE_DOMAIN")
    # Trust the X-Forwarded-For header set by the reverse proxy (Caddy) when
    # working out the client IP for rate limits and session lists.
    trust_proxy_headers: bool = Field(default=False, alias="TRUST_PROXY_HEADERS")
    # X-Forwarded-For is only believed when the TCP peer itself is one of these
    # (the reverse proxy / docker network). Anyone else can't spoof their IP.
    trusted_proxy_cidrs: str = Field(
        default="127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7",
        alias="TRUSTED_PROXY_CIDRS",
    )
    # Session tokens may also be presented as `Authorization: Bearer` (scripts,
    # Swagger). Off by default: the browser site only needs the HttpOnly cookie.
    bearer_auth_enabled: bool = Field(default=False, alias="BEARER_AUTH_ENABLED")
    # Swagger/ReDoc/openapi.json. Default: on for sandbox, off when APP_MODE=main.
    api_docs_enabled: bool | None = Field(default=None, alias="API_DOCS_ENABLED")

    # --- Passwords ---------------------------------------------------------------
    password_min_length: int = Field(default=12, alias="PASSWORD_MIN_LENGTH")
    password_max_length: int = Field(default=512, alias="PASSWORD_MAX_LENGTH")
    # Argon2id cost (defaults are the RFC 9106 "low memory" profile).
    argon2_time_cost: int = Field(default=3, alias="ARGON2_TIME_COST")
    argon2_memory_kib: int = Field(default=65536, alias="ARGON2_MEMORY_KIB")
    argon2_parallelism: int = Field(default=4, alias="ARGON2_PARALLELISM")
    # Reject passwords found in known breaches via the Have I Been Pwned
    # range API. Only the first 5 characters of the password's SHA-1 leave the
    # server (k-anonymity); on a network error the check is skipped.
    password_breach_check: bool = Field(default=False, alias="PASSWORD_BREACH_CHECK")

    # --- One-time links ------------------------------------------------------------
    email_verify_ttl_hours: int = Field(default=24, alias="EMAIL_VERIFY_TTL_HOURS")
    password_reset_ttl_minutes: int = Field(default=30, alias="PASSWORD_RESET_TTL_MINUTES")
    email_change_ttl_hours: int = Field(default=24, alias="EMAIL_CHANGE_TTL_HOURS")
    telegram_token_ttl_minutes: int = Field(default=30, alias="TELEGRAM_TOKEN_TTL_MINUTES")

    # --- Brute-force protection ------------------------------------------------------
    # Per-IP / per-email request limits on the auth endpoints (login, register,
    # password reset, ...). Disable only in automated tests.
    auth_rate_limit_enabled: bool = Field(default=True, alias="AUTH_RATE_LIMIT_ENABLED")
    login_max_failures: int = Field(default=5, alias="LOGIN_MAX_FAILURES")
    login_lockout_minutes: int = Field(default=15, alias="LOGIN_LOCKOUT_MINUTES")

    # --- Legal & lifecycle -------------------------------------------------------------
    terms_version: str = Field(default="2026-10", alias="TERMS_VERSION")
    # An account scheduled for deletion is anonymised after this many days.
    account_deletion_grace_days: int = Field(default=14, alias="ACCOUNT_DELETION_GRACE_DAYS")

    # --- Email (SMTP) --------------------------------------------------------------------
    # Leave SMTP_HOST empty to disable sending. In non-production (APP_MODE
    # != main) the message is then printed to the log so links can be copied;
    # in production nothing sensitive is ever logged.
    smtp_host: str = Field(default="", alias="SMTP_HOST")
    smtp_port: int = Field(default=587, alias="SMTP_PORT")
    smtp_username: str = Field(default="", alias="SMTP_USERNAME")
    smtp_password: str = Field(default="", alias="SMTP_PASSWORD")
    # "starttls" (port 587), "ssl" (port 465) or "none" (e.g. Mailpit on 1025).
    smtp_security: str = Field(default="starttls", alias="SMTP_SECURITY")
    smtp_from: str = Field(default="SportArenaGlobal <no-reply@localhost>", alias="SMTP_FROM")
    smtp_timeout_seconds: int = Field(default=15, alias="SMTP_TIMEOUT_SECONDS")

    # --- Admins ------------------------------------------------------------------------------
    # Verified accounts with these emails are administrators in the web API.
    # Admin rights can only be granted here (trusted configuration), never
    # through an API request. Financial operations additionally require MFA.
    admin_emails: str = Field(default="", alias="ADMIN_EMAILS")
    admin_mfa_session_hours: int = Field(default=12, alias="ADMIN_MFA_SESSION_HOURS")

    cors_origins: str = Field(default="http://localhost:5173", alias="CORS_ORIGINS")

    backend_host: str = Field(default="0.0.0.0", alias="BACKEND_HOST")
    backend_port: int = Field(default=8000, alias="BACKEND_PORT")

    admin_telegram_ids: str = Field(default="", alias="ADMIN_TELEGRAM_IDS")

    invite_expiration_hours: int = Field(default=24, alias="INVITE_EXPIRATION_HOURS")

    yandex_disk_oauth_token: str = Field(default="", alias="YANDEX_DISK_OAUTH_TOKEN")
    yandex_disk_root_folder: str = Field(default="/TeamFlow", alias="YANDEX_DISK_ROOT_FOLDER")

    yandex_ai_api_key: str = Field(default="", alias="YANDEX_API_KEY")
    yandex_ai_folder_id: str = Field(default="", alias="YANDEX_FOLDER_ID")
    yandex_ai_model: str = Field(default="yandexgpt", alias="YANDEX_MODEL")
    yandex_ai_base_url: str = Field(default="https://ai.api.cloud.yandex.net/v1", alias="YANDEX_BASE_URL")

    max_image_size_mb: int = Field(default=10, alias="MAX_IMAGE_SIZE_MB")
    max_video_size_mb: int = Field(default=100, alias="MAX_VIDEO_SIZE_MB")
    max_video_duration_seconds: int = Field(default=60, alias="MAX_VIDEO_DURATION_SECONDS")
    upload_chunk_size_kb: int = Field(default=512, alias="UPLOAD_CHUNK_SIZE_KB")
    http_client_timeout_seconds: int = Field(default=15, alias="HTTP_CLIENT_TIMEOUT_SECONDS")
    rate_limit_per_minute: int = Field(default=300, alias="RATE_LIMIT_PER_MINUTE")

    background_task_interval_seconds: int = Field(default=30, alias="BACKGROUND_TASK_INTERVAL_SECONDS")
    soft_delete_retention_days: int = Field(default=30, alias="SOFT_DELETE_RETENTION_DAYS")
    notification_max_attempts: int = Field(default=5, alias="NOTIFICATION_MAX_ATTEMPTS")
    notification_retry_delay_seconds: int = Field(default=60, alias="NOTIFICATION_RETRY_DELAY_SECONDS")
    task_deadline_reminder_hours_before: int = Field(default=24, alias="TASK_DEADLINE_REMINDER_HOURS_BEFORE")

    # "Time to train" re-engagement nudges (app/services/nudges.py).
    nudge_enabled: bool = Field(default=True, alias="NUDGE_ENABLED")
    # Users have no stored timezone, so the send window is in one project-wide zone.
    nudge_timezone: str = Field(default="Europe/Moscow", alias="NUDGE_TIMEZONE")
    nudge_window_start_hour: int = Field(default=17, alias="NUDGE_WINDOW_START_HOUR")
    nudge_window_end_hour: int = Field(default=20, alias="NUDGE_WINDOW_END_HOUR")
    # At most one nudge per this many hours per user (40h ~ "every other day" with a daily window).
    nudge_min_interval_hours: int = Field(default=40, alias="NUDGE_MIN_INTERVAL_HOURS")
    # Don't nudge someone who opened the app within this many hours.
    nudge_inactive_after_hours: int = Field(default=24, alias="NUDGE_INACTIVE_AFTER_HOURS")
    # After this many nudges in a row without the user coming back, stop until they do.
    nudge_max_unanswered: int = Field(default=3, alias="NUDGE_MAX_UNANSWERED")
    nudge_batch_size: int = Field(default=200, alias="NUDGE_BATCH_SIZE")

    @field_validator("cookie_secure", "api_docs_enabled", mode="before")
    @classmethod
    def _blank_means_unset(cls, value):
        # `COOKIE_SECURE=` / `API_DOCS_ENABLED=` left empty in a .env file means "decide automatically".
        return None if isinstance(value, str) and not value.strip() else value

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def admin_emails_list(self) -> list[str]:
        return [email.strip().lower() for email in self.admin_emails.split(",") if email.strip()]

    @property
    def allowed_origins(self) -> set[str]:
        origins = set(self.cors_origins_list)
        if self.app_base_url:
            origins.add(self.app_base_url.rstrip("/"))
        return origins

    @property
    def docs_enabled(self) -> bool:
        return self.api_docs_enabled if self.api_docs_enabled is not None else self.app_mode != "main"

    @property
    def trusted_proxy_networks(self) -> tuple:
        return _parse_networks(self.trusted_proxy_cidrs)

    @property
    def secure_cookies(self) -> bool:
        if self.cookie_secure is not None:
            return self.cookie_secure
        return self.app_base_url.lower().startswith("https://")

    @property
    def session_cookie_name(self) -> str:
        # The __Host- prefix makes browsers refuse a cookie that wasn't set
        # over HTTPS from this exact host (no Domain, Path=/), which blocks
        # cookie-injection from sibling subdomains. It needs Secure, so it is
        # only used when cookies are Secure.
        return "__Host-sag_session" if self.secure_cookies else "sag_session"

    @property
    def admin_telegram_ids_list(self) -> list[int]:
        ids: list[int] = []
        for raw in self.admin_telegram_ids.split(","):
            raw = raw.strip()
            if raw:
                ids.append(int(raw))
        return ids


def production_problems(settings: "Settings") -> tuple[list[str], list[str]]:
    """(fatal, warnings) for APP_MODE=main. Fatal ones mean the site would run with
    credentials/cookies that are not safe, so the backend refuses to start rather than
    quietly serving logins over a weak setup."""
    if settings.app_mode != "main":
        return [], []
    fatal: list[str] = []
    warnings: list[str] = []
    secret = settings.jwt_secret
    if secret == "change-me-to-a-long-random-string" or len(secret) < 32:
        fatal.append("JWT_SECRET must be a random string of at least 32 characters (openssl rand -hex 32)")
    if not settings.app_base_url.lower().startswith("https://"):
        fatal.append("APP_BASE_URL must be the public https:// address of the site")
    if settings.cookie_secure is False:
        fatal.append("COOKIE_SECURE=false is not allowed in production: session cookies must be Secure")
    if settings.cookie_samesite.lower() == "none" and not settings.secure_cookies:
        fatal.append("COOKIE_SAMESITE=none requires Secure cookies")
    origins = settings.cors_origins_list
    if "*" in origins:
        fatal.append("CORS_ORIGINS must list the exact site origin, not *")
    if not settings.smtp_host:
        warnings.append("SMTP_HOST is empty: nobody can confirm an email or reset a password")
    if any(not o.lower().startswith("https://") for o in origins):
        warnings.append("CORS_ORIGINS contains a non-https origin")
    if not settings.trust_proxy_headers:
        warnings.append("TRUST_PROXY_HEADERS is off: behind a reverse proxy every visitor shares the proxy's address in rate limits")
    if settings.bearer_auth_enabled:
        warnings.append("BEARER_AUTH_ENABLED is on: session tokens are accepted outside the HttpOnly cookie")
    if settings.docs_enabled:
        warnings.append("API docs (Swagger) are enabled")
    return fatal, warnings


@lru_cache
def _parse_networks(raw: str) -> tuple:
    import ipaddress

    return tuple(ipaddress.ip_network(part.strip(), strict=False) for part in raw.split(",") if part.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
