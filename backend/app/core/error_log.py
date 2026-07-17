"""Persists ERROR-level log records into the `error_log` table so the bot's
`/errors` admin command can show them regardless of which process (backend
or bot) produced them. Fire-and-forget: a logging call must never block or
raise, so failures to persist are swallowed.

Same rule as app/core/logging.py: never log secrets. This handler trusts
that rule already holds for every formatted message it receives.
"""
from __future__ import annotations

import asyncio
import logging

import asyncpg

_MESSAGE_MAX_LENGTH = 2000


class DatabaseErrorLogHandler(logging.Handler):
    def __init__(self, pool: asyncpg.Pool, source: str):
        super().__init__(level=logging.ERROR)
        self._pool = pool
        self._source = source

    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = self.format(record)[:_MESSAGE_MAX_LENGTH]
        except Exception:  # noqa: BLE001 - formatting must never break logging
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(self._write(record.name, message))

    async def _write(self, logger_name: str, message: str) -> None:
        try:
            async with self._pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO error_log (source, logger_name, message) VALUES ($1, $2, $3)",
                    self._source,
                    logger_name,
                    message,
                )
        except Exception:  # noqa: BLE001 - persisting an error must never raise
            pass


def attach_error_log_handler(pool: asyncpg.Pool, source: str) -> None:
    logging.getLogger().addHandler(DatabaseErrorLogHandler(pool, source))
