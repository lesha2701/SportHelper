"""Automatic payouts of trainers' withdrawal requests (docs/payouts-automation.md).

What this module guarantees, in the order the money moves:
  1. A request is picked up only after a short pause (the trainer can still cancel it) and only if EVERY rule below passes;
     otherwise it stays untouched for a person, with the reasons written in `attention`.
  2. The reserved amount IS the payout amount: the attempt row is created in the same transaction that moves the request to
     "processing", the database refuses an attempt of any other amount, and the provider's operation key is derived from the request id.
  3. The provider is called OUTSIDE any transaction. Whatever the answer, the books are changed only by a guarded transition:
     success -> "paid" (+ the ledger entry), a proven refusal -> "rejected" (+ the reservation released), anything else stays
     "processing" for a person. A failed call is NEVER repeated by the system: the operation is looked up by its key instead.
  4. The provider's own figure is compared with ours: a different amount stops everything.
  5. Anything unexpected (no answer, a different amount, a statement that does not match our books, repeated refusals) halts automation
     until a finance administrator resumes it. Halting never touches money that is already moving.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import asyncpg

from app.config import Settings
from app.integrations.payouts import PayoutOrder, PayoutProvider, PayoutResult, get_provider
from app.repositories import ledger
from app.repositories import payouts as repo
from app.repositories import users as users_repo
from app.repositories import withdrawals as withdrawals_repo
from app.repositories.ledger import Leg
from app.services import finance_notifications as notify
from app.services import payout_details

logger = logging.getLogger("teamflow.payouts")

RECENT = timedelta(minutes=2)          # an attempt younger than this may still be inside its own call
RECONCILE_EVERY = timedelta(hours=1)
STATEMENT_WINDOW = timedelta(hours=26)
FAILURES_BEFORE_HALT = 3

REASON_TEXT = {
    "account_not_active": "аккаунт тренера заблокирован или удалён",
    "above_auto_limit": "сумма выше лимита автоматической выплаты",
    "daily_trainer_limit": "превышен суточный лимит автовыплат этому тренеру",
    "daily_total_limit": "превышен суточный лимит автовыплат по платформе",
    "first_payout": "первая выплата этому тренеру проводится вручную",
    "new_details_cooldown": "новые реквизиты: автовыплата возможна только спустя паузу после первой заявки с ними",
    "details_shared": "эти реквизиты уже использует другой тренер",
    "recipient_name_differs": "получатель не совпадает с именем тренера в профиле",
    "profile_name_incomplete": "в профиле тренера не заполнены имя и фамилия",
    "password_recently_changed": "недавно менялся пароль аккаунта",
    "trainer_has_debt": "за тренером числится долг",
    "held_earnings": "есть замороженные начисления (спор по занятию)",
    "reserve_missing": "резерв в книге не совпадает с заявкой",
    "details_unreadable": "не удалось прочитать реквизиты",
}


def _tokens(text: str) -> set[str]:
    return {part for part in re.split(r"[\s\-]+", (text or "").lower().replace("ё", "е")) if part}


def recipient_matches(first_name: str | None, last_name: str | None, recipient: str) -> bool:
    """The profile's first and last name must both appear in the recipient's full name (any order, ё = е)."""
    need_first, need_last = _tokens(first_name or ""), _tokens(last_name or "")
    return bool(need_first and need_last) and (need_first | need_last) <= _tokens(recipient)


async def evaluate(conn: asyncpg.Connection, settings: Settings, withdrawal: dict[str, Any]) -> list[str]:
    """The reasons this request must NOT be paid by the system (empty list = it may be)."""
    reasons: list[str] = []
    coach_id, amount = withdrawal["coach_user_id"], withdrawal["amount_kopecks"]
    coach = await users_repo.get_by_id(conn, coach_id)
    if coach is None or coach.get("is_banned") or coach.get("deleted_at") or coach.get("deletion_requested_at"):
        reasons.append("account_not_active")
    changed = (coach or {}).get("password_changed_at")
    if changed is not None and datetime.now(timezone.utc) - changed < timedelta(hours=settings.payout_new_details_cooldown_hours):
        reasons.append("password_recently_changed")
    if amount > settings.payout_auto_max_rub * 100:
        reasons.append("above_auto_limit")
    day_ago = datetime.now(timezone.utc) - timedelta(hours=24)
    if await repo.sent_total(conn, day_ago, coach_user_id=coach_id) + amount > settings.payout_auto_daily_trainer_rub * 100:
        reasons.append("daily_trainer_limit")
    if await repo.sent_total(conn, day_ago) + amount > settings.payout_auto_daily_total_rub * 100:
        reasons.append("daily_total_limit")

    fingerprint = await conn.fetchval("SELECT details_fingerprint FROM withdrawal_requests WHERE id = $1", withdrawal["id"])
    if fingerprint is None:
        reasons.append("details_unreadable")
    else:
        if not await repo.details_paid_before(conn, coach_id, fingerprint):
            if await repo.coach_paid_count(conn, coach_id) == 0:
                reasons.append("first_payout")
            else:
                first_seen = await repo.details_first_seen(conn, coach_id, fingerprint)
                if first_seen is None or datetime.now(timezone.utc) - first_seen < timedelta(hours=settings.payout_new_details_cooldown_hours):
                    reasons.append("new_details_cooldown")
        if await repo.details_used_by_others(conn, coach_id, fingerprint):
            reasons.append("details_shared")

    details = payout_details.decrypt(await withdrawals_repo.get_encrypted_details(conn, withdrawal["id"]) or "", settings)
    if details is None:
        if "details_unreadable" not in reasons:
            reasons.append("details_unreadable")
    elif coach is not None:
        if not (_tokens(coach.get("first_name") or "") and _tokens(coach.get("last_name") or "")):
            reasons.append("profile_name_incomplete")
        elif not recipient_matches(coach.get("first_name"), coach.get("last_name"), details.get("recipient", "")):
            reasons.append("recipient_name_differs")

    balances = await ledger.trainer_balances(conn, coach_id)
    if balances["trainer_debt"] > 0:
        reasons.append("trainer_has_debt")
    if await repo.has_held_earnings(conn, coach_id):
        reasons.append("held_earnings")
    if balances["trainer_reserved"] < amount:
        reasons.append("reserve_missing")
    return reasons


def _attention(reasons: list[str]) -> str:
    return "Автовыплата не выполнена: " + "; ".join(REASON_TEXT[r] for r in reasons)


async def _halt(conn: asyncpg.Connection, settings: Settings, reason: str) -> None:
    if await repo.halt(conn, reason):
        logger.error("Automatic payouts halted: %s", reason)
        await notify.payouts_halted(conn, settings, reason)


async def _record_unknown(conn: asyncpg.Connection, settings: Settings, attempt: dict[str, Any], why: str) -> None:
    """The provider did not answer (or answered nonsense). Nothing is known: the request stays "processing" for a person."""
    async with conn.transaction():
        await repo.set_attempt(conn, attempt["id"], status="unknown", error=why)
        await repo.set_attention(conn, attempt["withdrawal_id"], "Нет ответа банка по переводу: деньги автоматически не возвращаются. Проверьте перевод в кабинете банка.")
    await _halt(conn, settings, f"нет ответа банка по заявке {attempt['withdrawal_id']}")


async def _apply(conn: asyncpg.Connection, settings: Settings, attempt_id: UUID, result: PayoutResult) -> str:
    """Records what the provider says about an attempt. Returns: paid | sent | rejected | mismatch | final (already settled)."""
    halt_reason: str | None = None
    async with conn.transaction():
        attempt = await repo.get_attempt(conn, attempt_id, lock=True)
        if attempt is None or attempt["status"] in ("succeeded", "failed"):
            return "final"
        withdrawal = await withdrawals_repo.get(conn, attempt["withdrawal_id"], lock=True)
        assert withdrawal is not None
        wid = withdrawal["id"]
        if result.amount_kopecks != attempt["amount_kopecks"] or attempt["amount_kopecks"] != withdrawal["amount_kopecks"]:
            await repo.set_attempt(conn, attempt_id, status="unknown", provider_payout_id=result.provider_payout_id,
                                   error=f"the provider reports {result.amount_kopecks} kopecks, expected {attempt['amount_kopecks']}")
            await repo.set_attention(conn, wid, "Банк сообщил сумму, не совпадающую с заявкой. Автоматика остановлена: проверьте перевод в кабинете банка.")
            halt_reason = f"банк сообщил другую сумму по заявке {wid}"
            outcome = "mismatch"
        elif withdrawal["status"] != "processing":
            await repo.set_attempt(conn, attempt_id, status="unknown", provider_payout_id=result.provider_payout_id, error=f"the request is {withdrawal['status']}, not processing")
            halt_reason = f"ответ банка по заявке {wid}, которая уже в статусе «{withdrawal['status']}»"
            outcome = "mismatch"
        elif result.status == "succeeded":
            reference = result.provider_payout_id or attempt["idempotency_key"]
            try:
                async with conn.transaction():
                    moved = await withdrawals_repo.move(conn, wid, from_status="processing", to_status="paid", bank_reference=reference,
                                                        paid_amount_kopecks=attempt["amount_kopecks"], paid_at=datetime.now(timezone.utc),
                                                        transfer_note=f"автоматически, {attempt['provider']}")
            except asyncpg.UniqueViolationError:
                moved = False
            if not moved:
                await repo.set_attempt(conn, attempt_id, status="unknown", provider_payout_id=result.provider_payout_id, error="could not record the payout")
                halt_reason = f"не удалось записать выплату по заявке {wid}"
                outcome = "mismatch"
            else:
                await ledger.post(
                    conn, kind="withdrawal_paid", business_key=f"withdrawal:{wid}:paid", description="Выплата тренеру проведена (автоматически)",
                    withdrawal_id=wid, created_by=None,
                    legs=[Leg("trainer_reserved", "debit", withdrawal["amount_kopecks"], withdrawal["coach_user_id"]), Leg("payouts_external", "credit", withdrawal["amount_kopecks"])],
                )
                await repo.set_attempt(conn, attempt_id, status="succeeded", provider_payout_id=result.provider_payout_id, fee_kopecks=result.fee_kopecks)
                await withdrawals_repo.add_event(conn, wid, from_status="processing", to_status="paid", actor=None, note="автоматически")
                await repo.set_attention(conn, wid, None)
                updated = await withdrawals_repo.get(conn, wid)
                await notify.withdrawal_status(conn, updated, "paid")  # type: ignore[arg-type]
                outcome = "paid"
        elif result.status == "pending":
            await repo.set_attempt(conn, attempt_id, status="sent", provider_payout_id=result.provider_payout_id)
            outcome = "sent"
        else:  # a proven refusal: the provider says no money moved
            from app.services import withdrawals as withdrawals_service

            reason = "Банк не принял перевод. Сумма возвращена в доступный баланс."
            await repo.set_attempt(conn, attempt_id, status="failed", error=result.error or "rejected")
            if await withdrawals_repo.move(conn, wid, from_status="processing", to_status="rejected", reason=reason):
                await withdrawals_service._release_reservation(conn, withdrawal, actor=None, reason=reason)
                await withdrawals_repo.add_event(conn, wid, from_status="processing", to_status="rejected", actor=None, note=reason)
                await repo.set_attention(conn, wid, None)
                updated = await withdrawals_repo.get(conn, wid)
                await notify.withdrawal_status(conn, updated, "rejected", reason)  # type: ignore[arg-type]
            outcome = "rejected"
            failures = await conn.fetchval("SELECT count(*) FROM payout_attempts WHERE status = 'failed' AND finished_at >= now() - interval '1 hour'")
            if failures >= FAILURES_BEFORE_HALT:
                halt_reason = f"банк отклонил {failures} перевода за последний час"
    if halt_reason:
        await _halt(conn, settings, halt_reason)
    return outcome


async def _start(conn: asyncpg.Connection, settings: Settings, provider: PayoutProvider, withdrawal_id: UUID) -> str:
    """One request: the rules, then (only if all pass) the move to "processing" with its attempt, then the provider."""
    async with conn.transaction():
        withdrawal = await withdrawals_repo.get(conn, withdrawal_id, lock=True)
        if withdrawal is None or withdrawal["status"] != "requested":
            return "skipped"
        reasons = await evaluate(conn, settings, withdrawal)
        if reasons:
            await repo.set_attention(conn, withdrawal_id, _attention(reasons))
            return "manual"
        for source, target in (("requested", "under_review"), ("under_review", "approved"), ("approved", "processing")):
            if not await withdrawals_repo.move(conn, withdrawal_id, from_status=source, to_status=target):
                raise RuntimeError(f"withdrawal {withdrawal_id} could not move {source} -> {target}")
            await withdrawals_repo.add_event(conn, withdrawal_id, from_status=source, to_status=target, actor=None, note="автоматически")
        await repo.mark_automated(conn, withdrawal_id)
        await repo.set_attention(conn, withdrawal_id, None)
        attempt = await repo.create_attempt(conn, withdrawal_id=withdrawal_id, provider=provider.name, amount_kopecks=withdrawal["amount_kopecks"])
        await notify.withdrawal_status(conn, withdrawal, "approved")

    details = payout_details.decrypt(await withdrawals_repo.get_encrypted_details(conn, withdrawal_id) or "", settings)
    if details is None:  # evaluate() just read it, so this is systemic (the encryption key changed?): stop
        await repo.set_attempt(conn, attempt["id"], status="failed", error="details unreadable")
        await repo.set_attention(conn, withdrawal_id, "Не удалось прочитать реквизиты. Заявка осталась в обработке: проведите выплату вручную или отклоните.")
        await _halt(conn, settings, "не удалось прочитать реквизиты получателя")
        return "unknown"
    order = PayoutOrder(idempotency_key=attempt["idempotency_key"], amount_kopecks=attempt["amount_kopecks"], method=withdrawal["method"],
                        details=details, description=f"Выплата тренеру по заявке {withdrawal_id}")
    try:
        result = await provider.send(order)
    except Exception as exc:  # noqa: BLE001 - whatever went wrong, nothing is known about the money: never send again
        logger.warning("Payout provider gave no answer for withdrawal %s: %s", withdrawal_id, type(exc).__name__)
        await _record_unknown(conn, settings, attempt, f"no answer: {type(exc).__name__}")
        return "unknown"
    return await _apply(conn, settings, attempt["id"], result)


async def _resolve_open(conn: asyncpg.Connection, settings: Settings, provider: PayoutProvider) -> int:
    """Looks up, by the operation key, every attempt whose outcome is not final. Never sends anything."""
    resolved = 0
    now = datetime.now(timezone.utc)
    for attempt in await repo.open_attempts(conn, limit=settings.payout_batch_size * 3):
        age = now - attempt["created_at"]
        if attempt["status"] == "created" and age < RECENT:
            continue
        try:
            result = await provider.status(attempt["idempotency_key"])
        except Exception:  # noqa: BLE001 - the provider is unreachable: try on the next tick
            continue
        if result is None:
            if attempt["status"] == "created":  # the call may or may not have reached the bank: a person decides
                await _record_unknown(conn, settings, attempt, "no operation at the provider after the call was started")
            continue
        outcome = await _apply(conn, settings, attempt["id"], result)
        resolved += outcome in ("paid", "rejected")
        if outcome == "sent" and age > timedelta(minutes=settings.payout_unknown_escalate_minutes):
            await notify.payout_unresolved(conn, settings, attempt["withdrawal_id"], attempt["id"])
    for attempt in await repo.open_attempts(conn, limit=settings.payout_batch_size * 3):
        if attempt["status"] == "unknown" and now - attempt["created_at"] > timedelta(minutes=settings.payout_unknown_escalate_minutes):
            await notify.payout_unresolved(conn, settings, attempt["withdrawal_id"], attempt["id"])
    return resolved


async def reconcile(conn: asyncpg.Connection, settings: Settings, provider: PayoutProvider, *, force: bool = False) -> list[str]:
    """The provider's statement against our attempts. Any difference halts automation. Returns the differences found."""
    state = await repo.state(conn)
    now = datetime.now(timezone.utc)
    if not force and state["reconciled_at"] and now - state["reconciled_at"] < RECONCILE_EVERY:
        return []
    since, until = now - STATEMENT_WINDOW, now - RECENT
    ours = {a["idempotency_key"]: a for a in await repo.attempts_since(conn, since, until)}
    try:
        theirs = dict(await provider.statement(since))
    except Exception:  # noqa: BLE001 - try again on the next tick
        return []
    problems: list[str] = []
    for key, bank in theirs.items():
        mine = ours.get(key)
        if mine is None:
            if not await conn.fetchval("SELECT EXISTS (SELECT 1 FROM payout_attempts WHERE idempotency_key = $1)", key):
                problems.append(f"операция {key} есть у банка, но неизвестна нам")
            continue
        if bank.amount_kopecks != mine["amount_kopecks"]:
            problems.append(f"{key}: сумма у банка {bank.amount_kopecks}, у нас {mine['amount_kopecks']}")
        elif bank.status == "succeeded" and mine["status"] != "succeeded":
            problems.append(f"{key}: банк провёл перевод, у нас он не проведён")
        elif bank.status == "failed" and mine["status"] == "succeeded":
            problems.append(f"{key}: у нас перевод проведён, банк его отклонил")
    for key, mine in ours.items():
        if mine["status"] == "succeeded" and (key not in theirs or theirs[key].status != "succeeded"):
            problems.append(f"{key}: у нас проведено, в выписке банка нет")
    await repo.touch_reconciled(conn)
    if problems:
        await _halt(conn, settings, "сверка с выпиской банка: " + "; ".join(problems[:3]))
    return problems


async def process_due(conn: asyncpg.Connection, settings: Settings) -> dict[str, int]:
    """One tick of the background loop."""
    stats = {"paid": 0, "rejected": 0, "manual": 0, "unknown": 0, "sent": 0, "mismatch": 0, "skipped": 0, "resolved": 0, "halted": 0}
    if not settings.payouts_auto_enabled:
        return stats
    provider = get_provider(settings)
    if provider is None:
        return stats
    stats["resolved"] = await _resolve_open(conn, settings, provider)  # finishes what is already moving, even while halted
    if (await repo.state(conn))["halted"]:
        stats["halted"] = 1
        return stats
    await reconcile(conn, settings, provider)
    for withdrawal_id in await repo.due_requests(conn, older_than_minutes=settings.payout_auto_delay_minutes, limit=settings.payout_batch_size):
        if (await repo.state(conn))["halted"]:
            stats["halted"] = 1
            break
        outcome = await _start(conn, settings, provider, withdrawal_id)
        stats[outcome] = stats.get(outcome, 0) + 1
    return stats
