"""Notifications about money. They are queued in the SAME transaction as the financial change (the notifications table is the
outbox; a background loop delivers them to the bell / e-mail / Telegram), so a delivery failure can never block or undo a posting,
and a replayed event cannot send twice (one dedup key per business event). Notifications are never a reason to post money.

Messages never contain payment details."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import asyncpg

from app.config import Settings
from app.repositories import notifications as notifications_repo
from app.services.money import format_rub


async def _send(conn: asyncpg.Connection, *, user_id: UUID, category: str, title: str, body: str, entity_type: str, entity_id: UUID, key: str) -> None:
    await notifications_repo.create_or_reschedule(
        conn, user_id=user_id, category=category, title=title, body=body, entity_type=entity_type, entity_id=entity_id,
        send_at=datetime.now(timezone.utc), dedup_key=f"{category}:{key}",
    )


async def finance_admin_ids(conn: asyncpg.Connection, settings: Settings) -> list[UUID]:
    emails = settings.finance_admin_emails_list
    if not emails:
        return []
    rows = await conn.fetch(
        "SELECT id FROM users WHERE lower(email) = ANY($1::text[]) AND email_verified_at IS NOT NULL AND deleted_at IS NULL", emails
    )
    return [r["id"] for r in rows]


# --- payments ---------------------------------------------------------------------------------------------------------------


async def payment_confirmed(conn: asyncpg.Connection, payment: dict[str, Any]) -> None:
    amount = format_rub(payment["gross_kopecks"])
    await _send(conn, user_id=payment["payer_user_id"], category="payment_update", title="Оплата прошла",
                body=f"Мы получили оплату {amount}. Тренировка оплачена.", entity_type="booking", entity_id=payment["booking_id"],
                key=f"paid:{payment['id']}:player")
    await _send(conn, user_id=payment["coach_user_id"], category="earning_update", title="Игрок оплатил тренировку",
                body=f"Начислено {format_rub(payment['trainer_kopecks'])} (комиссия платформы {format_rub(payment['platform_fee_kopecks'])}). "
                     "Деньги станут доступны к выводу после проверки проведённой тренировки.",
                entity_type="booking", entity_id=payment["booking_id"], key=f"paid:{payment['id']}:coach")


async def payment_canceled(conn: asyncpg.Connection, payment: dict[str, Any], attempt_id: UUID) -> None:
    await _send(conn, user_id=payment["payer_user_id"], category="payment_update", title="Платёж не завершён",
                body="Оплата не прошла или была отменена. Деньги не списаны — вы можете попробовать ещё раз.",
                entity_type="booking", entity_id=payment["booking_id"], key=f"canceled:{attempt_id}")


# --- earnings ---------------------------------------------------------------------------------------------------------------


async def earning_available(conn: asyncpg.Connection, earning: dict[str, Any], *, amount_kopecks: int) -> None:
    await _send(conn, user_id=earning["coach_user_id"], category="earning_update", title="Начисление доступно к выводу",
                body=f"{format_rub(amount_kopecks)} за проведённую тренировку теперь доступны к выводу.",
                entity_type="booking", entity_id=earning["booking_id"], key=f"available:{earning['id']}")


async def threshold_reached(conn: asyncpg.Connection, coach_user_id: UUID, earning_id: UUID, *, available_kopecks: int, minimum_kopecks: int) -> None:
    await _send(conn, user_id=coach_user_id, category="earning_update", title="Можно запросить вывод",
                body=f"Доступный баланс {format_rub(available_kopecks)} достиг минимума для вывода ({format_rub(minimum_kopecks)}).",
                entity_type="earning", entity_id=earning_id, key=f"threshold:{earning_id}")


# --- withdrawals ------------------------------------------------------------------------------------------------------------


async def withdrawal_requested(conn: asyncpg.Connection, settings: Settings, withdrawal: dict[str, Any], coach_name: str) -> None:
    """To the finance administrators, in the site. (No requisites in the text.)"""
    for admin_id in await finance_admin_ids(conn, settings):
        await _send(conn, user_id=admin_id, category="finance_admin", title="Новая заявка на вывод",
                    body=f"{coach_name} запросил вывод {format_rub(withdrawal['amount_kopecks'])}. Проверьте её в разделе «Финансы» админ-панели.",
                    entity_type="withdrawal", entity_id=withdrawal["id"], key=f"requested:{withdrawal['id']}:{admin_id}")
    await _send(conn, user_id=withdrawal["coach_user_id"], category="withdrawal_update", title="Заявка на вывод создана",
                body=f"Заявка на {format_rub(withdrawal['amount_kopecks'])} принята, сумма зарезервирована. Если это были не вы — срочно смените пароль и напишите в поддержку.",
                entity_type="withdrawal", entity_id=withdrawal["id"], key=f"requested:{withdrawal['id']}:coach")


async def withdrawal_status(conn: asyncpg.Connection, withdrawal: dict[str, Any], status: str, reason: str | None = None) -> None:
    amount = format_rub(withdrawal["amount_kopecks"])
    text = {
        "approved": ("Заявка на вывод одобрена", f"Заявка на {amount} одобрена и передана на перевод."),
        "paid": ("Выплата проведена", f"Выплата {amount} выполнена. Если деньги не пришли, напишите в поддержку."),
        "rejected": ("Заявка на вывод отклонена", f"Заявка на {amount} отклонена{': ' + reason if reason else ''}. Сумма возвращена в доступный баланс."),
        "canceled": ("Заявка на вывод отменена", f"Заявка на {amount} отменена, сумма возвращена в доступный баланс."),
    }.get(status)
    if text is None:
        return
    await _send(conn, user_id=withdrawal["coach_user_id"], category="withdrawal_update", title=text[0], body=text[1],
                entity_type="withdrawal", entity_id=withdrawal["id"], key=f"{status}:{withdrawal['id']}")


# --- refunds / incidents ----------------------------------------------------------------------------------------------------


async def refund_done(conn: asyncpg.Connection, payment: dict[str, Any], refund: dict[str, Any]) -> None:
    amount = format_rub(refund["amount_kopecks"])
    await _send(conn, user_id=payment["payer_user_id"], category="payment_update", title="Возврат выполнен",
                body=f"Мы вернули {amount}. Срок поступления зависит от вашего банка.", entity_type="booking", entity_id=payment["booking_id"],
                key=f"refund:{refund['id']}:player")
    await _send(conn, user_id=payment["coach_user_id"], category="earning_update", title="Возврат по тренировке",
                body=f"По оплате тренировки выполнен возврат игроку; ваше начисление уменьшено на {format_rub(refund['trainer_refund_kopecks'])}.",
                entity_type="booking", entity_id=payment["booking_id"], key=f"refund:{refund['id']}:coach")


async def incident(conn: asyncpg.Connection, settings: Settings, *, kind: str, payment_id: UUID | None, key: str) -> None:
    for admin_id in await finance_admin_ids(conn, settings):
        await _send(conn, user_id=admin_id, category="finance_admin", title="Финансовый инцидент",
                    body="Обнаружено расхождение по платежу — откройте раздел «Финансы» админ-панели.",
                    entity_type="payment", entity_id=payment_id or admin_id, key=f"incident:{kind}:{key}:{admin_id}")
