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
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from app.bot.deeplink import build_site_url
from app.config import Settings
from app.integrations.yandex_disk import YandexDiskClient, YandexDiskError
from app.repositories import auth_tokens as auth_tokens_repo
from app.repositories import bookings as bookings_repo
from app.repositories import files as files_repo
from app.repositories import notifications as notifications_repo
from app.repositories import rate_limits as rate_limits_repo
from app.repositories import sessions as sessions_repo
from app.repositories import tasks as tasks_repo
from app.repositories import users as users_repo
from app.services import notifications as notifications_service
from app.services import nudges as nudges_service

logger = logging.getLogger("teamflow.background")

BOOKING_EXPIRY_HOURS = 24


async def send_due_notifications(conn: asyncpg.Connection, bot: Bot | None, settings: Settings) -> None:
    due = await notifications_repo.list_due(conn)
    for notification in due:
        if not await notifications_repo.is_enabled(conn, notification["user_id"], notification["category"]):
            await notifications_repo.mark_cancelled(conn, notification["id"])
            continue

        user = await users_repo.get_by_id(conn, notification["user_id"])
        if user is None or user.get("deleted_at") is not None:
            await notifications_repo.mark_cancelled(conn, notification["id"])
            continue

        # Telegram is an optional extra channel. A user who never linked it
        # (or a server without a bot) still sees every notification in the
        # app's bell, which is fed straight from this table - so there is
        # nothing to deliver, and the row is simply marked as handled.
        if bot is None or user["telegram_id"] is None:
            await notifications_repo.mark_sent(conn, notification["id"])
            continue

        text = f"<b>{notification['title']}</b>\n{notification['body']}"
        keyboard = None
        if settings.app_base_url:
            url = build_site_url(
                settings.app_base_url, {"open": notification["category"], "id": str(notification["entity_id"])}
            )
            keyboard = InlineKeyboardMarkup(
                inline_keyboard=[[InlineKeyboardButton(text="Открыть на сайте", url=url)]]
            )
        try:
            await bot.send_message(chat_id=user["telegram_id"], text=text, reply_markup=keyboard)
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


async def sweep_expired_bookings(conn: asyncpg.Connection) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=BOOKING_EXPIRY_HOURS)
    expired = await bookings_repo.sweep_expired(conn, older_than=cutoff)
    for booking in expired:
        try:
            await notifications_service.schedule_booking_decided_notification(conn, booking, outcome="expired")
        except Exception:  # noqa: BLE001 - one bad notification must never strand the rest of the batch or tick
            logger.exception(
                "Failed to schedule expiry notification for booking %s", booking["id"]
            )
    if expired:
        logger.info("Auto-declined %d expired booking request(s)", len(expired))


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


# Checking who needs a nudge is a (cheap but non-trivial) query over all users;
# the send window is hours wide, so there's no need to run it on every 30s tick.
_NUDGE_CHECK_EVERY = timedelta(minutes=10)
_last_nudge_check: datetime | None = None


async def schedule_training_nudges(conn: asyncpg.Connection, settings: Settings) -> None:
    global _last_nudge_check
    now = datetime.now(timezone.utc)
    if _last_nudge_check is not None and now - _last_nudge_check < _NUDGE_CHECK_EVERY:
        return
    _last_nudge_check = now
    try:
        await nudges_service.schedule_training_nudges(conn, settings, now=now)
    except Exception:  # noqa: BLE001 - nudges are optional; they must never block real notifications
        logger.exception("Failed to schedule training nudges")


async def purge_stale_auth_data(conn: asyncpg.Connection) -> None:
    """Expired sessions and spent/expired one-time links are dead weight."""
    sessions = await sessions_repo.purge_expired(conn)
    tokens = await auth_tokens_repo.purge_expired(conn)
    hits = await rate_limits_repo.purge_old(conn)
    if sessions or tokens:
        logger.info("Purged %d stale session(s) and %d one-time token(s) (%d rate-limit rows)", sessions, tokens, hits)


async def process_account_deletions(conn: asyncpg.Connection, settings: Settings) -> None:
    """Anonymises accounts whose deletion grace period has passed. Rows are
    kept (only personal data is erased) so that bookings, reviews and any
    financial records are never removed by cascade."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.account_deletion_grace_days)
    for user_id in await users_repo.list_due_for_deletion(conn, older_than=cutoff):
        try:
            await users_repo.anonymize(conn, user_id)
            logger.info("Anonymised user %s after deletion request", user_id)
        except Exception:  # noqa: BLE001 - one bad account must not block the rest
            logger.exception("Failed to anonymise user %s", user_id)


_AUTH_CLEANUP_EVERY = timedelta(hours=1)
_last_auth_cleanup: datetime | None = None


async def run_account_maintenance(conn: asyncpg.Connection, settings: Settings) -> None:
    global _last_auth_cleanup
    now = datetime.now(timezone.utc)
    if _last_auth_cleanup is not None and now - _last_auth_cleanup < _AUTH_CLEANUP_EVERY:
        return
    _last_auth_cleanup = now
    await purge_stale_auth_data(conn)
    await process_account_deletions(conn, settings)


async def run_tick(pool: asyncpg.Pool, bot: Bot | None, settings: Settings) -> None:
    async with pool.acquire() as conn:
        await sweep_overdue_tasks(conn)
        await sweep_expired_bookings(conn)
        await schedule_training_nudges(conn, settings)
        await send_due_notifications(conn, bot, settings)
        await purge_soft_deleted_files(conn, settings)
        await run_account_maintenance(conn, settings)


async def run_background_loop(pool: asyncpg.Pool, bot: Bot | None, settings: Settings) -> None:
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
