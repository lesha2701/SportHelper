"""Confirming that a booked session took place, and what that does to the trainer's money (docs/session-confirmation.md, TR-05…TR-13).

The rule (owner's decisions of 11.11.2026):
- the window opens when the session ends and closes when the athlete confirms, or the coach enters the athlete's one-time code (in-person
  sessions), or 48 hours pass without a dispute;
- confirmed by the athlete or by the code: the earning may be released at once; confirmed automatically: after the usual hold;
- the coach's «Тренировка проведена» is only a mark (it opens the reviews), it does not open the money;
- either side can report a problem (a no-show, a session that did not happen) while the window is open: the earning is frozen and an
  administrator decides.

Every change is made under the booking's row lock, so a confirmation, a dispute, a code and the background pass are served one after the other;
the repositories move the state only from where it must be, so repeating any of them changes nothing."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import asyncpg

from app.config import Settings
from app.core.exceptions import APIError, ForbiddenError, NotFoundError
from app.repositories import bookings as bookings_repo
from app.repositories import earnings as earnings_repo
from app.repositories import session_codes as codes_repo
from app.repositories import session_confirmations as confirmations_repo
from app.security import session_codes as code_security

logger = logging.getLogger("teamflow.bookings")

ATHLETE = "athlete"
COACH = "coach"
WINDOW_HOURS = 48
CODE_TTL = timedelta(minutes=30)
MAX_CODE_ATTEMPTS = 5   # wrong entries of one code
MAX_CODES = 5           # codes a booking may be issued: with the attempts, at most 25 guesses of a million
DISPUTE_KINDS = {ATHLETE: ("coach_no_show", "not_conducted", "other"), COACH: ("athlete_no_show", "other")}
MAX_DISPUTE_TEXT = 1000


def ends_at(booking: dict[str, Any]) -> datetime:
    return booking["starts_at"] + timedelta(minutes=booking["duration_minutes"] or 0)


def window_closes_at(booking: dict[str, Any]) -> datetime:
    return ends_at(booking) + timedelta(hours=WINDOW_HOURS)


def applies(booking: dict[str, Any]) -> bool:
    """Only a confirmed booking whose session was not cancelled has a confirmation."""
    return booking["status"] == "confirmed" and booking.get("training_id") is not None and booking.get("training_status") != "cancelled"


def state_of(booking: dict[str, Any], row: dict[str, Any] | None, *, now: datetime) -> str:
    """scheduled (not over yet) | awaiting | confirmed | auto_confirmed | disputed | resolved_released | resolved_refunded."""
    if row is not None and row["state"] != "awaiting":
        return row["state"]
    return "scheduled" if now < ends_at(booking) else "awaiting"


def _window_open(booking: dict[str, Any], row: dict[str, Any] | None, *, now: datetime) -> bool:
    """The session has begun and nothing has closed or frozen it yet (the 48 hours may have passed: until the background pass closes it,
    a person's word is still taken — the result is the same confirmation, only sooner)."""
    return now >= booking["starts_at"] and (row is None or row["state"] == "awaiting")


def role_of(booking: dict[str, Any], user_id: UUID) -> str:
    if booking["coach_user_id"] == user_id:
        return COACH
    if booking["athlete_user_id"] == user_id:
        return ATHLETE
    raise NotFoundError("booking not found")  # someone else's booking looks exactly like a missing one


def view(booking: dict[str, Any], row: dict[str, Any] | None, code: dict[str, Any] | None, *, role: str, now: datetime) -> dict[str, Any] | None:
    """What a side of the booking sees about the confirmation (BookingOut.session_confirmation). None when it does not apply."""
    if not applies(booking):
        return None
    state = state_of(booking, row, now=now)
    open_ = _window_open(booking, row, now=now)
    in_person = booking["format"] == "offline"
    disputed = row is not None and row["disputed_at"] is not None
    return {
        "state": state,
        "window_closes_at": window_closes_at(booking),
        "coach_marked_at": row["coach_marked_at"] if row else None,
        "confirmed_at": row["confirmed_at"] if row else None,
        "confirmed_method": row["confirmed_method"] if row else None,
        "disputed_by_role": row["disputed_by_role"] if disputed else None,
        "dispute_kind": row["dispute_kind"] if disputed else None,
        "dispute_text": row["dispute_text"] if disputed else None,
        "resolved_at": row["resolved_at"] if row else None,
        "can_confirm": role == ATHLETE and open_ and now >= ends_at(booking),
        "can_report_problem": open_,
        "can_get_code": role == ATHLETE and in_person and open_ and (code is None or code["issued_count"] < MAX_CODES),
        "can_enter_code": role == COACH and in_person and open_ and code is not None and code["verified_at"] is None,
    }


async def view_for(conn: asyncpg.Connection, booking: dict[str, Any], user_id: UUID) -> dict[str, Any] | None:
    if not applies(booking):
        return None
    row = await confirmations_repo.get(conn, booking["id"])
    code = await codes_repo.get(conn, booking["id"]) if booking["format"] == "offline" else None
    return view(booking, row, code, role=role_of(booking, user_id), now=datetime.now(timezone.utc))


# --- the money --------------------------------------------------------------------------------------------------------------------

async def settle_earning(conn: asyncpg.Connection, settings: Settings, booking_id: UUID, *, method: str) -> None:
    """The window closed: the earning (if the booking was paid) becomes eligible for release — at once when a person confirmed, after the
    usual hold when it was automatic."""
    now = datetime.now(timezone.utc)
    release_after = now + timedelta(hours=settings.earning_hold_hours) if method == "auto" else now
    await earnings_repo.confirm_session(conn, booking_id, release_after=release_after)


async def on_new_earning(conn: asyncpg.Connection, settings: Settings, booking: dict[str, Any] | None) -> None:
    """A payment arrived (its earning was just made): the earning follows what the confirmation already says."""
    if booking is None:
        return
    row = await confirmations_repo.get(conn, booking["id"])
    if row is None:
        return
    if row["state"] in ("confirmed", "auto_confirmed", "resolved_released"):
        await settle_earning(conn, settings, booking["id"], method=row["confirmed_method"] or "auto")
    elif row["state"] == "disputed":
        await _freeze(conn, booking["id"])


async def _freeze(conn: asyncpg.Connection, booking_id: UUID) -> None:
    earning = await earnings_repo.get_for_booking(conn, booking_id, lock=True)
    if earning is not None and earning["status"] == "pending":
        await earnings_repo.hold(conn, earning["id"], "Спор о проведении занятия")
    elif earning is not None and earning["status"] == "available":
        # Released before the confirmation existed (the old rule): it cannot be frozen any more. The administrator sees the dispute and,
        # if the athlete is right, refunds; the existing refund machinery takes it from the trainer's balance or records a debt.
        logger.warning("Disputed booking %s has an earning that was already released", booking_id)


# --- actions ----------------------------------------------------------------------------------------------------------------------

async def _locked(conn: asyncpg.Connection, booking_id: UUID, user_id: UUID) -> tuple[dict[str, Any], str]:
    """Inside a transaction: the booking as it is after anyone who held the lock before us, and the caller's side."""
    if not await bookings_repo.lock_booking(conn, booking_id):
        raise NotFoundError("booking not found")
    booking = await bookings_repo.get_booking(conn, booking_id)
    assert booking is not None
    role = role_of(booking, user_id)
    if booking["status"] != "confirmed" or booking.get("training_id") is None:
        raise APIError("Подтверждать можно только подтверждённую тренером запись.", code="booking_not_confirmed", status_code=409)
    if booking.get("training_status") == "cancelled":
        raise APIError("Это занятие отменено.", code="session_cancelled", status_code=409)
    return booking, role


def _closed_error(row: dict[str, Any]) -> APIError:
    if row["state"] == "disputed":
        return APIError("По занятию открыт спор — решение примет администратор.", code="session_disputed", status_code=409)
    return APIError("Проведение занятия уже подтверждено.", code="session_already_confirmed", status_code=409)


async def confirm_by_athlete(conn: asyncpg.Connection, settings: Settings, booking_id: UUID, user: dict[str, Any]) -> dict[str, Any]:
    """TR-05: the athlete confirms after the session's end. Repeating it returns the same confirmation."""
    async with conn.transaction():
        booking, role = await _locked(conn, booking_id, user["id"])
        if role != ATHLETE:
            raise ForbiddenError("only the athlete of this booking confirms the session")
        now = datetime.now(timezone.utc)
        if now < ends_at(booking):
            raise APIError("Подтвердить занятие можно после его окончания.", code="session_not_finished", status_code=409)
        row = await confirmations_repo.confirm(conn, booking_id, by=user["id"], method="athlete")
        if row is None:
            current = await confirmations_repo.get(conn, booking_id)
            assert current is not None
            if current["state"] in ("confirmed", "auto_confirmed"):
                return booking  # already confirmed (by this press, the code or the 48 hours): nothing to change
            raise _closed_error(current)
        await settle_earning(conn, settings, booking_id, method="athlete")
    return booking


async def mark_by_coach(conn: asyncpg.Connection, booking_id: UUID) -> None:
    """TR-06: the coach's «Тренировка проведена» is recorded; it does not open the money."""
    await confirmations_repo.mark_by_coach(conn, booking_id)


async def issue_code(conn: asyncpg.Connection, settings: Settings, booking_id: UUID, user: dict[str, Any]) -> dict[str, Any]:
    """TR-07: a new one-time code for the athlete of an in-person session that has begun. Shown once; the previous code stops working."""
    async with conn.transaction():
        booking, role = await _locked(conn, booking_id, user["id"])
        if role != ATHLETE:
            raise ForbiddenError("only the athlete of this booking gets the code")
        if booking["format"] != "offline":
            raise APIError("Код нужен только для очного занятия.", code="code_for_in_person_only", status_code=409)
        now = datetime.now(timezone.utc)
        if now < booking["starts_at"]:
            raise APIError("Код появится, когда занятие начнётся.", code="session_not_started", status_code=409)
        row = await confirmations_repo.get(conn, booking_id)
        if not _window_open(booking, row, now=now):
            raise _closed_error(row)  # type: ignore[arg-type]  (closed means a row exists)
        current = await codes_repo.get(conn, booking_id, lock=True)
        if current is not None and current["issued_count"] >= MAX_CODES:
            raise APIError("Новых кодов больше не будет: подтвердите занятие кнопкой «Подтвердить».", code="code_limit", status_code=429)
        code = code_security.generate()
        expires = now + CODE_TTL
        stored = await codes_repo.issue(conn, booking_id, code_hash=code_security.digest(code, booking_id=booking_id, secret=settings.jwt_secret),
                                        expires_at=expires)
        if stored is None:
            raise APIError("Проведение занятия уже подтверждено.", code="session_already_confirmed", status_code=409)
    return {"code": code, "expires_at": expires}


async def verify_code(conn: asyncpg.Connection, settings: Settings, booking_id: UUID, user: dict[str, Any], raw: str) -> dict[str, Any]:
    """TR-08: the coach enters the athlete's code. Right: the window closes as confirmed. Wrong: counted (and the count is kept even though
    the answer is an error), five wrong entries lock the code."""
    typed = code_security.normalize(raw)
    error: APIError | None = None
    async with conn.transaction():
        booking, role = await _locked(conn, booking_id, user["id"])
        if role != COACH:
            raise ForbiddenError("only the coach of this booking enters the code")
        if booking["format"] != "offline":
            raise APIError("Код нужен только для очного занятия.", code="code_for_in_person_only", status_code=409)
        now = datetime.now(timezone.utc)
        row = await confirmations_repo.get(conn, booking_id)
        code = await codes_repo.get(conn, booking_id, lock=True)
        if code is not None and code["verified_at"] is not None and typed is not None \
                and code_security.matches(typed, code["code_hash"], booking_id=booking_id, secret=settings.jwt_secret):
            return booking  # the same right code again: already done
        if not _window_open(booking, row, now=now):
            raise _closed_error(row)  # type: ignore[arg-type]
        if code is None or code["verified_at"] is not None:
            raise APIError("Игрок ещё не получил код: попросите его открыть запись и нажать «Показать код».", code="code_not_issued", status_code=409)
        if code["attempts"] >= MAX_CODE_ATTEMPTS:
            raise APIError("Слишком много неверных попыток: попросите игрока показать новый код.", code="code_locked", status_code=429)
        if code["expires_at"] <= now:
            raise APIError("Срок кода истёк: попросите игрока показать новый код.", code="code_expired", status_code=409)
        if typed is None or not code_security.matches(typed, code["code_hash"], booking_id=booking_id, secret=settings.jwt_secret):
            wrong = await codes_repo.count_wrong(conn, booking_id)
            left = max(MAX_CODE_ATTEMPTS - wrong, 0)
            error = APIError(f"Неверный код. Осталось попыток: {left}." if left else "Неверный код. Попросите игрока показать новый код.",
                             code="code_invalid", status_code=422)
        else:
            await codes_repo.mark_verified(conn, booking_id, by=user["id"])
            confirmed = await confirmations_repo.confirm(conn, booking_id, by=user["id"], method="code")
            assert confirmed is not None  # the window was open under the lock
            await settle_earning(conn, settings, booking_id, method="code")
    if error is not None:
        raise error  # after the commit: the wrong attempt stays counted
    return booking


async def report_problem(
    conn: asyncpg.Connection, settings: Settings, booking_id: UUID, user: dict[str, Any], *, kind: str, text: str | None
) -> dict[str, Any]:
    """TR-13 / TR-19: either side reports a problem while the window is open. The window is frozen as disputed and so is the earning."""
    text = (text or "").strip() or None
    async with conn.transaction():
        booking, role = await _locked(conn, booking_id, user["id"])
        if kind not in DISPUTE_KINDS[role]:
            raise APIError("Такую проблему эта сторона заявить не может.", code="dispute_kind_invalid", status_code=422)
        if kind == "other" and text is None:
            raise APIError("Опишите, что случилось.", code="reason_required", status_code=422)
        if text is not None and len(text) > MAX_DISPUTE_TEXT:
            raise APIError("Слишком длинное описание.", code="validation_error", status_code=422)
        now = datetime.now(timezone.utc)
        if now < booking["starts_at"]:
            raise APIError("Сообщить о проблеме можно, когда занятие начнётся.", code="session_not_started", status_code=409)
        row = await confirmations_repo.dispute(conn, booking_id, by=user["id"], role=role, kind=kind, text=text)
        if row is None:
            current = await confirmations_repo.get(conn, booking_id)
            assert current is not None
            if current["state"] == "disputed" and current["disputed_by"] == user["id"] and current["dispute_kind"] == kind:
                return booking  # the same report again
            raise _closed_error(current)
        await _freeze(conn, booking_id)
    return booking


async def auto_confirm_due(conn: asyncpg.Connection, settings: Settings, *, limit: int = 50) -> int:
    """TR-09: the background pass closes the windows that have been open for 48 hours without a dispute. A second pass finds nothing."""
    closed = 0
    for booking_id in await confirmations_repo.due_for_auto_confirmation(conn, window_hours=WINDOW_HOURS, limit=limit):
        async with conn.transaction():
            await bookings_repo.lock_booking(conn, booking_id)
            if await confirmations_repo.confirm(conn, booking_id, by=None, method="auto") is not None:
                await settle_earning(conn, settings, booking_id, method="auto")
                closed += 1
    return closed
