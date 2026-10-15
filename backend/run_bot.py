"""Entrypoint for the Telegram bot (long polling), run as a separate process
from the FastAPI backend:

    python run_bot.py
"""
from __future__ import annotations

import asyncio
import logging

from app.bot.bot import BOT_COMMANDS, create_bot, create_dispatcher
from app.config import get_settings
from app.core.error_log import attach_error_log_handler
from app.core.logging import configure_logging
from app.database import create_pool, run_migrations

logger = logging.getLogger("teamflow.bot")


async def main() -> None:
    settings = get_settings()
    configure_logging(settings.app_mode)
    if not settings.telegram_bot_token:
        # The site works without Telegram. Idle quietly instead of exiting, so
        # `restart: unless-stopped` doesn't turn a missing token into a crash loop.
        logger.info("TELEGRAM_BOT_TOKEN is not set - the Telegram bot is disabled (the website is unaffected)")
        await asyncio.Event().wait()
        return
    logger.info("Starting SportArenaGlobal bot (mode=%s)", settings.app_mode)

    # The bot runs as its own process (separate from the FastAPI backend),
    # so /start needs its own pool to read/write Postgres directly.
    pool = await create_pool(settings)
    await run_migrations(pool)
    attach_error_log_handler(pool, "bot")

    bot = create_bot(settings)
    dispatcher = create_dispatcher(settings, pool)

    try:
        await bot.delete_webhook(drop_pending_updates=True)
        await bot.set_my_commands(BOT_COMMANDS)  # replaces the old command menu (/admin, /stats, ...)
        await dispatcher.start_polling(bot)
    finally:
        await bot.session.close()
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
