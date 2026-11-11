"""Schedules (and reschedules) reminder notifications for trainings and task
deadlines. Called from the trainings/tasks routes after a successful
create/update — the actual sending happens later, in the background job."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import asyncpg

from app.config import Settings
from app.core import session_time
from app.repositories import notifications as notifications_repo
from app.repositories import teams as teams_repo
from app.repositories import users as users_repo


def _combine_date_time(training_date: Any, start_time: Any) -> datetime:
    """The session's wall-clock date and time, for the text of a message ("в 10:00"). Not a real instant: a send_at
    comes from session_time.instant_of()."""
    return datetime.combine(training_date, start_time)


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
    # The real moment the platform's clock shows the training's time (REF-19: it used to be read as UTC, 3 hours late in Moscow).
    send_at = session_time.instant_of(training["training_date"], training["start_time"]) - timedelta(
        minutes=training["reminder_minutes_before"]
    )

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


async def schedule_booking_requested_notification(conn: asyncpg.Connection, booking: dict[str, Any]) -> None:
    """Pings the coach that a new booking request is waiting on them."""
    athlete = await users_repo.get_by_id(conn, booking["athlete_user_id"])
    athlete_name = athlete["first_name"] if athlete else "Атлет"
    when = booking["starts_at"].strftime("%d.%m в %H:%M")
    await _notify_recipients(
        conn,
        recipient_ids=[booking["coach_user_id"]],
        category="booking_requested",
        title="Новая заявка на тренировку",
        body=f"{athlete_name} — {when}",
        entity_type="booking",
        entity_id=booking["id"],
        send_at=datetime.now(timezone.utc),
    )


async def schedule_booking_decided_notification(
    conn: asyncpg.Connection, booking: dict[str, Any], *, outcome: str, payable: bool = False
) -> None:
    """Pings the athlete once their booking request has an outcome —
    confirmed by the coach, declined by the coach, or auto-declined by the
    24h expiry sweep (see app.services.background.sweep_expired_bookings)."""
    if outcome == "confirmed":
        when = booking["starts_at"].strftime("%d.%m в %H:%M")
        body = f"Тренер подтвердил тренировку {when}."
        if payable and booking.get("price_per_session"):
            body += " Теперь её можно оплатить в разделе «Мои брони»."
    elif outcome == "declined":
        body = "Заявка на тренировку отклонена."
    else:
        body = "Заявка на тренировку отменена: тренер не ответил вовремя."
    await _notify_recipients(
        conn,
        recipient_ids=[booking["athlete_user_id"]],
        category="booking_decided",
        title="Статус заявки на тренировку",
        body=body,
        entity_type="booking",
        entity_id=booking["id"],
        send_at=datetime.now(timezone.utc),
    )


async def schedule_booking_cancelled_notification(
    conn: asyncpg.Connection, booking: dict[str, Any], *, by_role: str, refund_percent: int, paid: bool
) -> None:
    """Tells the other side that a confirmed booking was cancelled, and what happens to the money."""
    when = booking["starts_at"].strftime("%d.%m в %H:%M")
    if by_role == "athlete":
        recipient = booking["coach_user_id"]
        body = f"Игрок {booking['athlete_full_name']} отменил тренировку {when}."
        if paid:
            body += " Оплата остаётся у вас." if refund_percent == 0 else " Деньги возвращаются игроку, начисление за это занятие снято."
    else:
        recipient = booking["athlete_user_id"]
        body = f"Тренер отменил тренировку {when}."
        if paid:
            body += " Деньги вернутся на ту карту, которой вы платили."
    await _notify_recipients(
        conn,
        recipient_ids=[recipient],
        category="booking_decided",
        title="Тренировка отменена",
        body=body,
        entity_type="booking",
        entity_id=booking["id"],
        send_at=datetime.now(timezone.utc),
    )


async def schedule_review_requested_notification(conn: asyncpg.Connection, booking: dict[str, Any]) -> None:
    """Asks the athlete to review their coach once the coach has marked the
    session as conducted. Opens the booking's review form via the usual
    notification deep link (category + booking id)."""
    await _notify_recipients(
        conn,
        recipient_ids=[booking["athlete_user_id"]],
        category="review_requested",
        title="Оставьте отзыв о тренере",
        body=f"Занятие с тренером {booking['coach_full_name']} прошло. Поставьте оценку и напишите пару слов.",
        entity_type="booking",
        entity_id=booking["id"],
        send_at=datetime.now(timezone.utc),
    )


# --- confirming that a booked session took place (docs/session-confirmation.md, TR-10, TR-11, TR-14) -------------------------------

# what the OTHER side reads after «Тренер сообщил» / «Игрок сообщил»
_DISPUTE_WORDS = {
    "athlete_no_show": ", что вы не пришли на тренировку",
    "coach_no_show": ", что вы не пришли на тренировку",
    "not_conducted": ", что тренировка не состоялась",
    "other": " о проблеме с тренировкой",
}


async def _booking_note(conn: asyncpg.Connection, booking: dict[str, Any], *, recipient: UUID, title: str, body: str, key: str) -> None:
    await notifications_repo.create_or_reschedule(
        conn, user_id=recipient, category="booking_decided", title=title, body=body, entity_type="booking", entity_id=booking["id"],
        send_at=datetime.now(timezone.utc), dedup_key=f"{key}:{booking['id']}:{recipient}",
    )


async def schedule_session_confirmation_reminder(conn: asyncpg.Connection, booking: dict[str, Any], *, hours_after_end: int) -> None:
    """TR-10 / TR-11: the athlete has neither confirmed the session nor reported a problem (only the athlete can confirm it)."""
    when = booking["starts_at"].strftime("%d.%m в %H:%M")
    if hours_after_end < 47:
        title, body = "Подтвердите тренировку", f"Тренировка {when} состоялась? Подтвердите её — или сообщите, если что-то пошло не так."
    else:
        title = "Тренировка подтвердится через час"
        body = f"Через час тренировка {when} подтвердится автоматически, и тренер получит оплату. Если что-то не так, сообщите о проблеме сейчас."
    await _booking_note(conn, booking, recipient=booking["athlete_user_id"], title=title, body=body, key=f"session_confirm_{hours_after_end}")


async def schedule_session_confirmed_notification(conn: asyncpg.Connection, booking: dict[str, Any], *, method: str) -> None:
    """TR-14: the window closed. The athlete's own press needs no message to the athlete."""
    when = booking["starts_at"].strftime("%d.%m в %H:%M")
    if method == "auto":
        await _booking_note(conn, booking, recipient=booking["athlete_user_id"], title="Тренировка подтверждена",
                            body=f"Тренировка {when} подтверждена автоматически.", key="session_confirmed")
        await _booking_note(conn, booking, recipient=booking["coach_user_id"], title="Тренировка подтверждена",
                            body=f"Тренировка {when} подтверждена автоматически: игрок не сообщил о проблемах.", key="session_confirmed")
    elif method == "athlete":
        await _booking_note(conn, booking, recipient=booking["coach_user_id"], title="Игрок подтвердил тренировку",
                            body=f"{booking['athlete_full_name']} подтвердил, что тренировка {when} состоялась.", key="session_confirmed")
    else:  # the code: both were there and both saw it; the athlete is told that the code worked
        await _booking_note(conn, booking, recipient=booking["athlete_user_id"], title="Тренировка подтверждена",
                            body=f"Тренер ввёл ваш код: тренировка {when} подтверждена.", key="session_confirmed")


async def schedule_session_disputed_notification(conn: asyncpg.Connection, booking: dict[str, Any], *, by_role: str, kind: str) -> None:
    """TR-14: the other side learns about the reported problem and that the money waits for an administrator."""
    when = booking["starts_at"].strftime("%d.%m в %H:%M")
    words = _DISPUTE_WORDS.get(kind, _DISPUTE_WORDS["other"])
    if by_role == "coach":
        recipient = booking["athlete_user_id"]
        body = f"Тренер сообщил{words} {when}. Решение примет администратор; если это не так — напишите в поддержку."
    else:
        recipient = booking["coach_user_id"]
        body = f"Игрок сообщил{words} {when}. Оплата заморожена до решения администратора."
    await _booking_note(conn, booking, recipient=recipient, title="Спор по тренировке", body=body, key="session_disputed")


async def schedule_session_dispute_resolved_notification(conn: asyncpg.Connection, booking: dict[str, Any], *, refunded: bool) -> None:
    when = booking["starts_at"].strftime("%d.%m в %H:%M")
    if refunded:
        athlete = f"Администратор рассмотрел спор по тренировке {when}: деньги вернутся на карту, которой вы платили."
        coach = f"Администратор рассмотрел спор по тренировке {when}: деньги возвращены игроку, начисление за занятие снято."
    else:
        athlete = f"Администратор рассмотрел спор по тренировке {when}: оплата остаётся у тренера."
        coach = f"Администратор рассмотрел спор по тренировке {when}: оплата за занятие ваша."
    await _booking_note(conn, booking, recipient=booking["athlete_user_id"], title="Спор решён", body=athlete, key="session_dispute_resolved")
    await _booking_note(conn, booking, recipient=booking["coach_user_id"], title="Спор решён", body=coach, key="session_dispute_resolved")
