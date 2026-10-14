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
    bookings,
    calendar,
    coach_listings,
    coaches,
    exercises,
    files,
    health,
    matches,
    metrics,
    notifications,
    onboarding,
    players,
    search,
    plans,
    profile,
    profile_media,
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
from app.core.rate_limit import RateLimiter, SlidingWindowLimiter
from app.security.client import client_ip
from app.security.tokens import hash_token
from app.database import create_pool, run_migrations
from app.services.background import run_background_loop

_UNLIMITED_PATHS = {"/api/health", "/docs", "/redoc", "/openapi.json"}
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

logger = logging.getLogger("teamflow.main")


async def _start_background_task(pool: asyncpg.Pool, settings: Settings) -> asyncio.Task[None] | None:
    """Separate seam so tests can stub this out entirely — the background
    loop can send real Telegram API calls and must never run against the fake
    in-memory pool used by the test client.

    The loop always runs (it also expires sessions and processes account
    deletions); the Telegram bot is optional and only delivers notifications
    to users who linked Telegram."""
    bot = create_bot(settings) if settings.telegram_bot_token else None
    if bot is None:
        logger.info("TELEGRAM_BOT_TOKEN not set — notifications are shown in the app only")
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
    logger.info("Starting SportArena Global backend (mode=%s)", settings.app_mode)

    pool = await create_pool(settings)
    await run_migrations(pool)
    app.state.db_pool = pool
    app.state.rate_limiter = RateLimiter(settings.rate_limit_per_minute)
    app.state.auth_limiter = SlidingWindowLimiter()
    if settings.jwt_secret == "change-me-to-a-long-random-string" and settings.app_mode == "main":
        logger.error("JWT_SECRET is still the default value — set a long random secret in .env")
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
        title="SportArena Global API",
        version="0.1.0",
        description="Backend API for the SportArena Global website.",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-CSRF-Token"],
        expose_headers=["Retry-After"],
    )

    @app.middleware("http")
    async def csrf_origin_middleware(request: Request, call_next):
        # Defence in depth next to the CSRF token: browsers always send Origin
        # on cross-site POST/PUT/PATCH/DELETE, so a state-changing request from
        # a foreign page is refused before it reaches any route.
        if request.method not in _SAFE_METHODS and request.url.path.startswith("/api/"):
            origin = request.headers.get("origin")
            if origin and origin.rstrip("/") not in settings.allowed_origins:
                return JSONResponse(
                    status_code=403,
                    content={"error": {"code": "csrf_failed", "message": "request origin is not allowed"}},
                )
        return await call_next(request)

    @app.middleware("http")
    async def no_store_for_account_endpoints(request: Request, call_next):
        # Responses of /api/auth/* carry a CSRF token or are personal: never cached by the browser or a proxy.
        response = await call_next(request)
        if request.url.path.startswith("/api/auth/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.middleware("http")
    async def rate_limit_middleware(request: Request, call_next):
        if request.url.path in _UNLIMITED_PATHS:
            return await call_next(request)
        limiter: RateLimiter = request.app.state.rate_limiter
        # Prefer the signed-in session as the key: behind a reverse proxy
        # every visitor shares one apparent IP, so an IP-only key would
        # throttle the whole site for everyone once more than a few people
        # use it. IP is the fallback for guests and the auth endpoints.
        key = client_ip(request, settings)
        auth_header = request.headers.get("Authorization", "")
        session_token = (
            auth_header.removeprefix("Bearer ")
            if auth_header.startswith("Bearer ")
            else request.cookies.get(settings.session_cookie_name)
        )
        if session_token:
            key = f"session:{hash_token(session_token)[:16]}"
        if not limiter.check(key):
            return JSONResponse(
                status_code=429,
                content={"error": {"code": "rate_limited", "message": "too many requests, slow down"}},
                headers={"Retry-After": "60"},
            )
        return await call_next(request)

    @app.exception_handler(APIError)
    async def api_error_handler(request: Request, exc: APIError) -> JSONResponse:
        error: dict[str, object] = {"code": exc.code, "message": exc.message}
        headers: dict[str, str] = {}
        if exc.field:
            error["field"] = exc.field
        if exc.retry_after:
            error["retry_after"] = exc.retry_after
            headers["Retry-After"] = str(exc.retry_after)
        return JSONResponse(status_code=exc.status_code, content={"error": error}, headers=headers)

    app.include_router(auth.router)
    app.include_router(health.router)
    app.include_router(profile.router)
    app.include_router(teams.router)
    app.include_router(teams.invites_router)
    app.include_router(files.team_files_router)
    app.include_router(files.user_files_router)
    app.include_router(files.files_router)
    app.include_router(profile_media.router)
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
    app.include_router(coach_listings.router)
    app.include_router(coaches.router)
    app.include_router(players.router)
    app.include_router(search.router)
    app.include_router(metrics.router)
    app.include_router(metrics.metric_router)
    app.include_router(stats.router)
    app.include_router(ai.router)
    app.include_router(ai.team_ai_router)
    app.include_router(ai.training_ai_router)
    app.include_router(ai.privacy_router)
    app.include_router(onboarding.router)
    app.include_router(bookings.router)

    return app


app = create_app()
