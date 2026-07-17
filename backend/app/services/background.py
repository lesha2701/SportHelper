"""The single background asyncio task for the whole app (no Redis/Celery,
per the project spec). Runs one tick every `background_task_interval_seconds`
for as long as the FastAPI process is alive: sends due notifications
(retrying failed ones with backoff), flips overdue task assignments, and
purges files past their soft-delete retention window.

Team invites are intentionally not touched here — they're already gated by
`expires_at` wherever they're read or used, so there's no separate "expired"
state to close. Likewise there is nothing to sweep for "incomplete uploads":
a `files` row is only ever inserted after a successful upload, so no
`status = 'uploading'` row is ever left dangling.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

import asyncpg
from aiogram import Bot
from aiogram.exceptions import TelegramAPIError

from app.config import Settings
from app.integrations.yandex_disk import YandexDiskClient, YandexDiskError
from app.repositories import files as files_repo
from app.repositories import notifications as notifications_repo
from app.repositories import tasks as tasks_repo
from app.repositories import users as users_repo

logger = logging.getLogger("teamflow.background")


async def send_due_notifications(conn: asyncpg.Connection, bot: Bot, settings: Settings) -> None:
    due = await notifications_repo.list_due(conn)
    for notification in due:
        if not await notifications_repo.is_enabled(conn, notification["user_id"], notification["category"]):
            await notifications_repo.mark_cancelled(conn, notification["id"])
            continue

        user = await users_repo.get_by_id(conn, notification["user_id"])
        if user is None:
            await notifications_repo.mark_cancelled(conn, notification["id"])
            continue

        text = f"<b>{notification['title']}</b>\n{notification['body']}"
        try:
            await bot.send_message(chat_id=user["telegram_id"], text=text)
        except TelegramAPIError as exc:
            attempts = notification["attempts"] + 1
            if attempts >= settings.notification_max_attempts:
                await notifications_repo.mark_failed(conn, notification["id"], str(exc))
            else:
                next_send_at = datetime.now(timezone.utc) + timedelta(seconds=settings.notification_retry_delay_seconds)
                await notifications_repo.mark_retry(conn, notification["id"], next_send_at, str(exc))
        else:
            await notifications_repo.mark_sent(conn, notification["id"])


async def sweep_overdue_tasks(conn: asyncpg.Connection) -> None:
    count = await tasks_repo.sweep_overdue(conn)
    if count:
        logger.info("Marked %d task assignment(s) overdue", count)


async def purge_soft_deleted_files(conn: asyncpg.Connection, settings: Settings) -> None:
    if not settings.yandex_disk_oauth_token:
        return
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.soft_delete_retention_days)
    purgeable = await files_repo.list_purgeable(conn, cutoff)
    if not purgeable:
        return

    client = YandexDiskClient(settings)
    for file_record in purgeable:
        try:
            await client.delete(file_record["disk_path"])
        except YandexDiskError as exc:
            logger.error("Failed to delete %s from Yandex.Disk: %s", file_record["disk_path"], exc)
            continue
        await files_repo.hard_delete(conn, file_record["id"])
        logger.info("Purged retained file %s", file_record["id"])


async def run_tick(pool: asyncpg.Pool, bot: Bot, settings: Settings) -> None:
    async with pool.acquire() as conn:
        await sweep_overdue_tasks(conn)
        await send_due_notifications(conn, bot, settings)
        await purge_soft_deleted_files(conn, settings)


async def run_background_loop(pool: asyncpg.Pool, bot: Bot, settings: Settings) -> None:
    logger.info("Background task loop started (interval=%ss)", settings.background_task_interval_seconds)
    try:
        while True:
            try:
                await run_tick(pool, bot, settings)
            except Exception:  # noqa: BLE001 - one bad tick must never kill the loop
                logger.exception("Background task tick failed")
            await asyncio.sleep(settings.background_task_interval_seconds)
    except asyncio.CancelledError:
        logger.info("Background task loop stopped")
        raise
