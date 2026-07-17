from __future__ import annotations

import asyncpg
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

from app.bot.handlers.admin import register as register_admin
from app.bot.handlers.start import register as register_start
from app.config import Settings


def create_bot(settings: Settings) -> Bot:
    if not settings.telegram_bot_token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured")
    return Bot(
        token=settings.telegram_bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )


def create_dispatcher(settings: Settings, pool: asyncpg.Pool | None = None) -> Dispatcher:
    """`pool` is optional because the FastAPI backend also builds a bare Bot
    (for the background notification loop) via create_bot without ever
    needing a Dispatcher — the admin router is only reachable through
    run_bot.py, which always supplies a pool."""
    dispatcher = Dispatcher()
    dispatcher["settings"] = settings
    dispatcher["pool"] = pool
    dispatcher.include_router(register_start(settings))
    if pool is not None:
        dispatcher.include_router(register_admin(settings, pool))
    return dispatcher
