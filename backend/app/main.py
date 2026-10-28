from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager, suppress

import asyncpg
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import (
    activity,
    admin,
    admin_complaints,
    admin_content,
    admin_finance,
    admin_media,
    ai,
    auth,
    bookings,
    calendar,
    coach_listings,
    coaches,
    complaints,
    exercises,
    files,
    finance,
    health,
    matches,
    metrics,
    notifications,
    onboarding,
    payments,
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
from app.config import Settings, get_settings, production_problems
from app.core.error_log import attach_error_log_handler
from app.core.exceptions import APIError
from app.core.logging import configure_logging
from app.core.rate_limit import RateLimiter
from app.security.client import rate_limit_key
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
    bot = create_bot(settings) if settings.telegram_active else None
    if bot is None:
        logger.info("Telegram is off (TELEGRAM_ENABLED / TELEGRAM_BOT_TOKEN) — notifications are shown in the app only")
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
    logger.info("Starting SportArenaGlobal backend (mode=%s)", settings.app_mode)
    fatal, warnings = production_problems(settings)
    for message in warnings:
        logger.warning("Configuration: %s", message)
    if fatal:
        for message in fatal:
            logger.critical("Unsafe configuration: %s", message)
        raise RuntimeError("Refusing to start with an unsafe production configuration: " + "; ".join(fatal))

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
        title="SportArenaGlobal API",
        version="0.1.0",
        description="Backend API for the SportArenaGlobal website.",
        lifespan=lifespan,
        # Swagger can store a pasted session token and is a pure attack surface in
        # production: API_DOCS_ENABLED defaults to off when APP_MODE=main.
        docs_url="/docs" if settings.docs_enabled else None,
        redoc_url="/redoc" if settings.docs_enabled else None,
        openapi_url="/openapi.json" if settings.docs_enabled else None,
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
    async def response_hardening(request: Request, call_next):
        response = await call_next(request)
        # Uploaded files are served inline: never let a browser guess a type or frame the API.
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        # Responses of /api/auth/* carry a CSRF token or are personal: never cached by the browser or a proxy.
        if request.url.path.startswith("/api/auth/") or request.url.path.startswith("/api/admin/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.middleware("http")
    async def rate_limit_middleware(request: Request, call_next):
        if request.url.path in _UNLIMITED_PATHS:
            return await call_next(request)
        limiter: RateLimiter = request.app.state.rate_limiter
        # A brake on overall request volume per client address. It is deliberately
        # NOT keyed by anything the client sends (a session/bearer token would let
        # an attacker mint a fresh bucket with every fake token). It is per
        # process; the limits that matter for security (login, sign-up, password
        # reset, MFA ...) are enforced in PostgreSQL and shared by all processes.
        key = rate_limit_key(request, settings)
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
    app.include_router(admin.router)
    app.include_router(activity.router)
    app.include_router(admin_media.router)
    app.include_router(admin_content.router)
    app.include_router(admin_complaints.router)
    app.include_router(admin_finance.router)
    app.include_router(finance.router)
    app.include_router(complaints.router)
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
    app.include_router(payments.router)

    return app


app = create_app()
