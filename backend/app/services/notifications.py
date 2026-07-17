"""Schedules (and reschedules) reminder notifications for trainings and task
deadlines. Called from the trainings/tasks routes after a successful
create/update — the actual sending happens later, in the background job."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import asyncpg

from app.config import Settings
from app.repositories import notifications as notifications_repo
from app.repositories import teams as teams_repo


def _combine_date_time(training_date: Any, start_time: Any) -> datetime:
    return datetime.combine(training_date, start_time, tzinfo=timezone.utc)


async def _notify_recipients(
    conn: asyncpg.Connection,
    *,
    recipient_ids: list[UUID],
    category: str,
    title: str,
    body: str,
    entity_type: str,
    entity_id: UUID,
    send_at: datetime,
) -> None:
    """Shared fan-out for the "new_training" / "new_match" / "new_task"
    one-off pings below — they all differ only in recipient selection and
    the title/body text. schedule_training_reminders and
    schedule_task_deadline_reminders aren't built on this: they also clear
    previously-scheduled notifications and compute a delayed send_at, which
    doesn't fit this shape cleanly."""
    for user_id in recipient_ids:
        await notifications_repo.create_or_reschedule(
            conn,
            user_id=user_id,
            category=category,
            title=title,
            body=body,
            entity_type=entity_type,
            entity_id=entity_id,
            send_at=send_at,
            dedup_key=f"{category}:{entity_id}:{user_id}",
        )


async def schedule_training_reminders(conn: asyncpg.Connection, training: dict[str, Any]) -> None:
    # Always clear whatever was scheduled before — covers both "reminder
    # turned off" (nothing gets recreated) and "time changed" (recreated
    # below with a fresh send_at).
    await notifications_repo.cancel_pending_for_entity(conn, "training", training["id"])
    if training["reminder_minutes_before"] is None or training.get("status") == "cancelled":
        return

    training_at = _combine_date_time(training["training_date"], training["start_time"])
    send_at = training_at - timedelta(minutes=training["reminder_minutes_before"])

    if training["type"] == "personal":
        recipient_ids = [training["created_by"]]
    else:
        members = await teams_repo.list_members(conn, training["team_id"])
        recipient_ids = [m["user_id"] for m in members]

    title = "Скоро тренировка"
    body = f"Тренировка {training_at.strftime('%d.%m в %H:%M')}"
    if training.get("location"):
        body += f", {training['location']}"

    for user_id in recipient_ids:
        await notifications_repo.create_or_reschedule(
            conn,
            user_id=user_id,
            category="training_reminder",
            title=title,
            body=body,
            entity_type="training",
            entity_id=training["id"],
            send_at=send_at,
            dedup_key=f"training_reminder:{training['id']}:{user_id}",
        )


async def schedule_new_training_notification(conn: asyncpg.Connection, training: dict[str, Any]) -> None:
    """One-off "a new training was added" ping for every other team member —
    separate from schedule_training_reminders, which is the reminder closer
    to the training's start time. Personal trainings have no other members
    to notify, so this is a no-op for those."""
    if training["type"] == "personal":
        return
    members = await teams_repo.list_members(conn, training["team_id"])
    recipient_ids = [m["user_id"] for m in members if m["user_id"] != training["created_by"]]
    if not recipient_ids:
        return

    training_at = _combine_date_time(training["training_date"], training["start_time"])
    body = f"Добавлена тренировка {training_at.strftime('%d.%m в %H:%M')}"
    if training.get("location"):
        body += f", {training['location']}"

    await _notify_recipients(
        conn,
        recipient_ids=recipient_ids,
        category="new_training",
        title="Новая тренировка",
        body=body,
        entity_type="training",
        entity_id=training["id"],
        send_at=datetime.now(timezone.utc),
    )


async def schedule_new_match_notification(conn: asyncpg.Connection, match: dict[str, Any]) -> None:
    members = await teams_repo.list_members(conn, match["team_id"])
    recipient_ids = [m["user_id"] for m in members if m["user_id"] != match["created_by"]]
    if not recipient_ids:
        return

    match_at = _combine_date_time(match["match_date"], match["start_time"])
    await _notify_recipients(
        conn,
        recipient_ids=recipient_ids,
        category="new_match",
        title="Новый матч",
        body=f"Матч с «{match['opponent_name']}» {match_at.strftime('%d.%m в %H:%M')}",
        entity_type="match",
        entity_id=match["id"],
        send_at=datetime.now(timezone.utc),
    )


async def schedule_new_task_notification(
    conn: asyncpg.Connection, task: dict[str, Any], assignee_user_ids: list[UUID]
) -> None:
    recipient_ids = [uid for uid in assignee_user_ids if uid != task["created_by"]]
    if not recipient_ids:
        return

    body = f"«{task['title']}»"
    if task.get("deadline"):
        body += f" — дедлайн {task['deadline'].strftime('%d.%m в %H:%M')}"

    await _notify_recipients(
        conn,
        recipient_ids=recipient_ids,
        category="new_task",
        title="Новое задание",
        body=body,
        entity_type="task",
        entity_id=task["id"],
        send_at=datetime.now(timezone.utc),
    )


async def schedule_task_deadline_reminders(
    conn: asyncpg.Connection, task: dict[str, Any], assignee_user_ids: list[UUID], settings: Settings
) -> None:
    await notifications_repo.cancel_pending_for_entity(conn, "task", task["id"])
    if task["deadline"] is None:
        return

    deadline: datetime = task["deadline"]
    send_at = deadline - timedelta(hours=settings.task_deadline_reminder_hours_before)
    now = datetime.now(timezone.utc)
    if send_at < now:
        send_at = now

    title = "Дедлайн задания приближается"
    body = f"«{task['title']}» — дедлайн {deadline.strftime('%d.%m в %H:%M')}"

    for user_id in assignee_user_ids:
        await notifications_repo.create_or_reschedule(
            conn,
            user_id=user_id,
            category="task_deadline",
            title=title,
            body=body,
            entity_type="task",
            entity_id=task["id"],
            send_at=send_at,
            dedup_key=f"task_deadline:{task['id']}:{user_id}",
        )
