"""Periodic "time to train" nudges: a gentle push (Telegram message with an
"open the app" button + a row in the in-app bell) to players who haven't
opened SportArena for a while, so the product stays on their mind.

It reuses the normal notification pipeline — this module only decides WHO
gets a nudge and WHAT it says, then queues it as a `training_nudge`
notification; app.services.background.send_due_notifications delivers it
(respecting the user's per-category switch, retries, and the deep link).

Restraint is the point: a daily window in a fixed timezone, one nudge per
~2 days per user, never to someone active in the last day, and it stops
after a few unanswered nudges until the user comes back.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from uuid import UUID
from zoneinfo import ZoneInfo

import asyncpg

from app.config import Settings
from app.repositories import notifications as notifications_repo
from app.repositories import tasks as tasks_repo

logger = logging.getLogger("teamflow.nudges")

_GENERIC = (
    ("Время потренироваться", "Самое время размяться: запланируйте тренировку в SportArena."),
    ("Пора на тренировку", "Регулярность — основа прогресса. Сегодня хороший день, чтобы позаниматься."),
    ("Не забывайте про тренировки", "Загляните в SportArena и запланируйте занятие на ближайшие дни."),
    ("Как ваши тренировки?", "В SportArena ждут календарь, задания и ваша статистика. Загляните на минуту."),
)


def _local_now(settings: Settings, now: datetime) -> datetime:
    return now.astimezone(ZoneInfo(settings.nudge_timezone))


def in_send_window(settings: Settings, now: datetime) -> bool:
    """Whether `now` falls inside the daily window (project-wide timezone)."""
    return settings.nudge_window_start_hour <= _local_now(settings, now).hour < settings.nudge_window_end_hour


def _open_tasks_phrase(count: int) -> str:
    last_two, last = count % 100, count % 10
    if last == 1 and last_two != 11:
        return f"{count} невыполненное задание"
    if 2 <= last <= 4 and not 12 <= last_two <= 14:
        return f"{count} невыполненных задания"
    return f"{count} невыполненных заданий"


def build_nudge_message(*, open_tasks: int, has_player_profile: bool, user_id: UUID, today: date) -> tuple[str, str]:
    """A short, varied text. Context beats generic: pending tasks first, then
    a prompt to finish setting up, otherwise a rotating motivational line
    (rotated per user and per day so neighbours don't all get the same one)."""
    if open_tasks > 0:
        return (
            "Время потренироваться",
            f"У вас {_open_tasks_phrase(open_tasks)}. Откройте SportArena, займитесь ими или запланируйте свою тренировку.",
        )
    if not has_player_profile:
        return ("Пора начинать", "Заполните профиль и запланируйте первую тренировку — это займёт пару минут.")
    return _GENERIC[(today.toordinal() + user_id.int) % len(_GENERIC)]


async def schedule_training_nudges(conn: asyncpg.Connection, settings: Settings, *, now: datetime | None = None) -> int:
    """Queues a nudge for every eligible user, if now is inside the send
    window. Returns how many were queued."""
    now = now or datetime.now(timezone.utc)
    if not settings.nudge_enabled or not in_send_window(settings, now):
        return 0

    candidates = await notifications_repo.list_nudge_candidates(
        conn,
        inactive_before=now - timedelta(hours=settings.nudge_inactive_after_hours),
        min_gap_after=now - timedelta(hours=settings.nudge_min_interval_hours),
        max_unanswered=settings.nudge_max_unanswered,
        limit=settings.nudge_batch_size,
    )
    if not candidates:
        return 0

    open_tasks = await tasks_repo.count_open_assignments_for_users(conn, [c["user_id"] for c in candidates])
    today = _local_now(settings, now).date()
    for candidate in candidates:
        user_id = candidate["user_id"]
        title, body = build_nudge_message(
            open_tasks=open_tasks.get(user_id, 0),
            has_player_profile=candidate["has_player_profile"],
            user_id=user_id,
            today=today,
        )
        await notifications_repo.create_or_reschedule(
            conn,
            user_id=user_id,
            category="training_nudge",
            title=title,
            body=body,
            # No real entity behind a nudge: it points at the user themself and
            # the app opens the "new training" screen (see Workspace.tsx).
            entity_type="user",
            entity_id=user_id,
            send_at=now,
            dedup_key=f"training_nudge:{user_id}:{today.isoformat()}",
        )
    logger.info("Queued %d training nudge(s)", len(candidates))
    return len(candidates)
