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

from pydantic import Field
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
    mini_app_url: str = Field(default="", alias="MINI_APP_URL")

    database_url: str = Field(
        default="postgresql://teamflow:teamflow@localhost:5432/teamflow_sandbox",
        alias="DATABASE_URL",
    )
    database_pool_min_size: int = Field(default=1, alias="DATABASE_POOL_MIN_SIZE")
    database_pool_max_size: int = Field(default=10, alias="DATABASE_POOL_MAX_SIZE")

    jwt_secret: str = Field(default="change-me-to-a-long-random-string", alias="JWT_SECRET")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    jwt_expires_minutes: int = Field(default=43200, alias="JWT_EXPIRES_MINUTES")

    cors_origins: str = Field(default="http://localhost:5173", alias="CORS_ORIGINS")

    backend_host: str = Field(default="0.0.0.0", alias="BACKEND_HOST")
    backend_port: int = Field(default=8000, alias="BACKEND_PORT")

    admin_telegram_ids: str = Field(default="", alias="ADMIN_TELEGRAM_IDS")

    # Local-development-only shortcut: when true, POST /api/auth/dev-login
    # logs in as a fixed dev user without a real Telegram initData signature
    # (see app/api/routes/dev_auth.py). Defaults to off and must stay off
    # everywhere except a developer's own machine — see docs/dev-notes.md.
    dev_auth_enabled: bool = Field(default=False, alias="DEV_AUTH_ENABLED")

    # Telegram initData is rejected if older than this many seconds.
    telegram_auth_max_age_seconds: int = Field(default=86400, alias="TELEGRAM_AUTH_MAX_AGE_SECONDS")

    invite_expiration_hours: int = Field(default=24, alias="INVITE_EXPIRATION_HOURS")

    yandex_disk_oauth_token: str = Field(default="", alias="YANDEX_DISK_OAUTH_TOKEN")
    yandex_disk_root_folder: str = Field(default="/TeamFlow", alias="YANDEX_DISK_ROOT_FOLDER")

    yandex_ai_api_key: str = Field(default="", alias="YANDEX_API_KEY")
    yandex_ai_folder_id: str = Field(default="", alias="YANDEX_FOLDER_ID")
    yandex_ai_model: str = Field(default="yandexgpt", alias="YANDEX_MODEL")
    yandex_ai_base_url: str = Field(default="https://ai.api.cloud.yandex.net/v1", alias="YANDEX_BASE_URL")

    max_image_size_mb: int = Field(default=10, alias="MAX_IMAGE_SIZE_MB")
    max_video_size_mb: int = Field(default=200, alias="MAX_VIDEO_SIZE_MB")
    upload_chunk_size_kb: int = Field(default=512, alias="UPLOAD_CHUNK_SIZE_KB")
    http_client_timeout_seconds: int = Field(default=15, alias="HTTP_CLIENT_TIMEOUT_SECONDS")
    rate_limit_per_minute: int = Field(default=300, alias="RATE_LIMIT_PER_MINUTE")

    background_task_interval_seconds: int = Field(default=30, alias="BACKGROUND_TASK_INTERVAL_SECONDS")
    soft_delete_retention_days: int = Field(default=30, alias="SOFT_DELETE_RETENTION_DAYS")
    notification_max_attempts: int = Field(default=5, alias="NOTIFICATION_MAX_ATTEMPTS")
    notification_retry_delay_seconds: int = Field(default=60, alias="NOTIFICATION_RETRY_DELAY_SECONDS")
    task_deadline_reminder_hours_before: int = Field(default=24, alias="TASK_DEADLINE_REMINDER_HOURS_BEFORE")

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def admin_telegram_ids_list(self) -> list[int]:
        ids: list[int] = []
        for raw in self.admin_telegram_ids.split(","):
            raw = raw.strip()
            if raw:
                ids.append(int(raw))
        return ids


@lru_cache
def get_settings() -> Settings:
    return Settings()
