from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager, suppress

import asyncpg
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import (
    ai,
    auth,
    calendar,
    exercises,
    files,
    health,
    matches,
    metrics,
    notifications,
    plans,
    profile,
    reports,
    stats,
    task_templates,
    tasks,
    teams,
    trainings,
)
from app.bot.bot import create_bot
from app.config import Settings, get_settings
from app.core.error_log import attach_error_log_handler
from app.core.exceptions import APIError
from app.core.logging import configure_logging
from app.core.rate_limit import RateLimiter
from app.security.jwt import InvalidToken, decode_access_token
from app.database import create_pool, run_migrations
from app.services.background import run_background_loop

_UNLIMITED_PATHS = {"/api/health", "/docs", "/redoc", "/openapi.json"}


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"

logger = logging.getLogger("teamflow.main")


async def _start_background_task(pool: asyncpg.Pool, settings: Settings) -> asyncio.Task[None] | None:
    """Separate seam so tests can stub this out entirely — the background
    loop sends real Telegram API calls and must never run against the fake
    in-memory pool used by the test client."""
    if not settings.telegram_bot_token:
        logger.warning("TELEGRAM_BOT_TOKEN not set — background notifications are disabled")
        return None
    bot = create_bot(settings)
    return asyncio.create_task(run_background_loop(pool, bot, settings))


def _attach_error_log_handler(pool: asyncpg.Pool) -> None:
    """Separate seam so tests can stub this out — see _start_background_task
    above for why (this one doesn't hit Telegram, but it does add a handler
    to the shared root logger, which shouldn't accumulate across tests)."""
    attach_error_log_handler(pool, "backend")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.app_mode)
    logger.info("Starting TeamFlow Sports backend (mode=%s)", settings.app_mode)

    pool = await create_pool(settings)
    await run_migrations(pool)
    app.state.db_pool = pool
    app.state.rate_limiter = RateLimiter(settings.rate_limit_per_minute)
    _attach_error_log_handler(pool)

    background_task = await _start_background_task(pool, settings)

    yield

    if background_task is not None:
        background_task.cancel()
        with suppress(asyncio.CancelledError):
            await background_task

    await pool.close()
    logger.info("Backend shut down")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="TeamFlow Sports API",
        version="0.1.0",
        description="Backend API for the TeamFlow Sports Telegram Mini App.",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def rate_limit_middleware(request: Request, call_next):
        if request.url.path in _UNLIMITED_PATHS:
            return await call_next(request)
        limiter: RateLimiter = request.app.state.rate_limiter
        # Prefer the authenticated user as the key — almost every route
        # requires a bearer token, and behind a tunnel (ngrok/cloudflared,
        # per the README's dev setup) every visitor shares one apparent IP,
        # so an IP-only key would throttle the whole app for everyone the
        # moment more than one person opens it. IP is only the fallback for
        # the handful of unauthenticated requests (e.g. POST /api/auth/telegram).
        key = _client_ip(request)
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            try:
                user_id = decode_access_token(auth_header.removeprefix("Bearer "), settings)
                key = f"user:{user_id}"
            except InvalidToken:
                pass
        if not limiter.check(key):
            return JSONResponse(
                status_code=429,
                content={"error": {"code": "rate_limited", "message": "too many requests, slow down"}},
            )
        return await call_next(request)

    @app.exception_handler(APIError)
    async def api_error_handler(request: Request, exc: APIError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message}},
        )

    app.include_router(auth.router)
    app.include_router(health.router)
    app.include_router(profile.router)
    app.include_router(teams.router)
    app.include_router(teams.invites_router)
    app.include_router(files.team_files_router)
    app.include_router(files.files_router)
    app.include_router(exercises.router)
    app.include_router(exercises.team_exercises_router)
    app.include_router(plans.router)
    app.include_router(plans.team_plans_router)
    app.include_router(trainings.router)
    app.include_router(trainings.team_trainings_router)
    app.include_router(reports.router)
    app.include_router(tasks.router)
    app.include_router(tasks.team_tasks_router)
    app.include_router(task_templates.router)
    app.include_router(matches.router)
    app.include_router(matches.team_matches_router)
    app.include_router(notifications.router)
    app.include_router(calendar.router)
    app.include_router(metrics.router)
    app.include_router(metrics.metric_router)
    app.include_router(stats.router)
    app.include_router(ai.router)
    app.include_router(ai.team_ai_router)

    return app


app = create_app()
