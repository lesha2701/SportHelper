from __future__ import annotations

import asyncpg
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import BotCommand

from app.bot.handlers.start import register as register_start
from app.config import Settings

# The whole menu of the bot: one command. Everything else it does is sending notifications.
BOT_COMMANDS = [BotCommand(command="start", description="Ссылка на сайт")]


def create_bot(settings: Settings) -> Bot:
    if not settings.telegram_bot_token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured")
    return Bot(
        token=settings.telegram_bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )


def create_dispatcher(settings: Settings, pool: asyncpg.Pool) -> Dispatcher:
    """Only used by run_bot.py (the FastAPI backend builds a bare Bot for the notification loop and
    needs no Dispatcher). The pool is for /start: finding the account and linking the chat."""
    dispatcher = Dispatcher()
    dispatcher["settings"] = settings
    dispatcher["pool"] = pool
    dispatcher.include_router(register_start(settings, pool))
    return dispatcher
