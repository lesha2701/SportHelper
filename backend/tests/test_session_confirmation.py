"""Confirming that a booked session took place (docs/session-confirmation.md, TR-05…TR-13), through the API on a real PostgreSQL."""
from __future__ import annotations

import threading

from app.config import get_settings
from app.core import session_time
from app.services import session_confirmation as service
from tests.admin_world import live_client, pg, world  # noqa: F401  (fixtures)
from tests.finance_helpers import assert_books_are_sound, confirmed_booking, run, webhook, with_conn
from tests.live_helpers import sql, sql_value
from tests.test_finance import earning_of, fin, paid_booking  # noqa: F401  (fixtures and helpers)


def _ended(fin, booking, hours_ago: float = 1) -> None:
    """The session (60 minutes) ended the given number of hours ago on the platform's clock (starts_at is wall-clock time)."""
    sql(fin.dsn, f"UPDATE bookings SET starts_at = {session_time.sql_wall_now()} - make_interval(secs => $2) WHERE id = $1::uuid", booking["id"], (hours_ago + 1) * 3600)


def _starts_in(fin, booking, hours: float) -> None:
    sql(fin.dsn, f"UPDATE bookings SET starts_at = {session_time.sql_wall_now()} + make_interval(secs => $2) WHERE id = $1::uuid", booking["id"], hours * 3600)


def _in_person(fin, booking) -> None:
    sql(fin.dsn, "UPDATE bookings SET format = 'offline' WHERE id = $1::uuid", booking["id"])


def _card(user, booking) -> dict | None:
    """The booking as this side sees it in its own list (the athlete's or the coach's)."""
    for path in ("/api/bookings/me", "/api/bookings/coach"):
        response = user.call("GET", path)
        if response.status_code == 200:
            found = [b for b in response.json() if b["id"] == booking["id"]]
            if found:
                return found[0]["session_confirmation"]
    raise AssertionError("the booking is in neither list of this user")


def _earning(fin, booking) -> dict:
    row = sql(fin.dsn, "SELECT status, session_confirmed_at, release_after, (release_after <= now() + interval '1 minute') AS at_once "
                       "FROM trainer_earnings WHERE booking_id = $1::uuid", booking["id"])
    return dict(row[0])


def _post(user, booking, path: str, **body):
    return user.call("POST", f"/api/bookings/{booking['id']}/session/{path}", json=body or None)


def _error(response) -> tuple[int, str]:
    return response.status_code, response.json()["error"]["code"]


def _auto(fin) -> int:
    return run(with_conn(fin.dsn, lambda c: service.auto_confirm_due(c, get_settings())))


# --- the athlete confirms (TR-05) and the coach only marks (TR-06) ----------------------------------------------------------------

def test_the_athlete_confirms_after_the_end_and_the_money_may_go_at_once(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    _starts_in(fin, booking, 48)
    assert _card(player, booking)["state"] == "scheduled" and _card(player, booking)["can_confirm"] is False

    _starts_in(fin, booking, -0.5)  # under way
    assert _error(_post(player, booking, "confirm")) == (409, "session_not_finished")

    _ended(fin, booking)
    assert coach.call("POST", f"/api/bookings/{booking['id']}/complete").status_code == 200
    assert _earning(fin, booking)["session_confirmed_at"] is None  # the coach's word alone opens nothing
    card = _card(player, booking)
    assert card["state"] == "awaiting" and card["can_confirm"] is True and card["coach_marked_at"] is not None
    assert _card(coach, booking)["can_confirm"] is False

    done = _post(player, booking, "confirm")
    assert done.status_code == 200 and done.json()["session_confirmation"]["state"] == "confirmed"
    assert done.json()["session_confirmation"]["confirmed_method"] == "athlete"
    earning = _earning(fin, booking)
    assert earning["session_confirmed_at"] is not None and earning["at_once"] is True
    again = _post(player, booking, "confirm")
    assert again.status_code == 200 and sql_value(fin.dsn, "SELECT count(*) FROM session_confirmations") == 1


def test_only_the_athlete_confirms_and_a_stranger_sees_nothing(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    stranger = confirmed_booking(fin.world, coach_email="c9@example.com", player_email="p9@example.com", title="Другое")[1]
    _ended(fin, booking)
    assert _post(coach, booking, "confirm").status_code == 403
    assert _post(stranger, booking, "confirm").status_code == 404
    assert _post(stranger, booking, "problem", kind="other", text="?").status_code == 404


def test_there_is_nothing_to_confirm_for_an_unconfirmed_or_a_cancelled_booking(fin) -> None:
    coach, player, booking = confirmed_booking(fin.world)
    assert _card(player, booking) is None
    coach.ok("POST", f"/api/bookings/{booking['id']}/confirm")
    _starts_in(fin, booking, 48)
    assert _card(player, booking)["state"] == "scheduled"
    player.ok("POST", f"/api/bookings/{booking['id']}/cancel", json={})
    assert _card(player, booking) is None
    assert _error(_post(player, booking, "confirm")) == (409, "booking_not_confirmed")


# --- the one-time code (TR-07, TR-08) ---------------------------------------------------------------------------------------------

def test_the_code_confirms_an_in_person_session(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    assert _error(_post(player, booking, "code")) == (409, "code_for_in_person_only")
    _in_person(fin, booking)
    _starts_in(fin, booking, 1)
    assert _error(_post(player, booking, "code")) == (409, "session_not_started")
    _starts_in(fin, booking, -0.25)  # the session has begun: the athlete shows the code, the coach types it
    assert _card(coach, booking)["can_enter_code"] is False  # nothing issued yet
    assert _error(_post(coach, booking, "code/verify", code="123456")) == (409, "code_not_issued")

    issued = _post(player, booking, "code")
    assert issued.status_code == 200 and len(issued.json()["code"]) == 6
    code = issued.json()["code"]
    assert code not in str(sql(fin.dsn, "SELECT * FROM session_codes"))  # only a hash is kept
    assert _card(coach, booking)["can_enter_code"] is True

    done = _post(coach, booking, "code/verify", code=f" {code[:3]}-{code[3:]} ")
    assert done.status_code == 200 and done.json()["session_confirmation"]["confirmed_method"] == "code"
    assert _earning(fin, booking)["at_once"] is True
    assert _post(coach, booking, "code/verify", code=code).status_code == 200  # the same right code again: already done
    assert _error(_post(player, booking, "code")) == (409, "session_already_confirmed")


def test_wrong_codes_are_counted_and_five_lock_the_code(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    _in_person(fin, booking)
    _starts_in(fin, booking, -0.25)
    code = _post(player, booking, "code").json()["code"]
    wrong = f"{(int(code) + 1) % 1_000_000:06d}"
    for left in (4, 3, 2, 1):
        refused = _post(coach, booking, "code/verify", code=wrong)
        assert _error(refused) == (422, "code_invalid") and f"Осталось попыток: {left}" in refused.json()["error"]["message"]
    assert _error(_post(coach, booking, "code/verify", code=wrong)) == (422, "code_invalid")
    assert _error(_post(coach, booking, "code/verify", code=code)) == (429, "code_locked")  # even the right one, once locked
    assert sql_value(fin.dsn, "SELECT attempts FROM session_codes") == 5

    fresh = _post(player, booking, "code").json()["code"]  # a new code starts its own count
    assert _post(coach, booking, "code/verify", code=fresh).status_code == 200


def test_an_expired_code_a_replaced_code_and_the_issue_limit(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    _in_person(fin, booking)
    _starts_in(fin, booking, -0.25)
    first = _post(player, booking, "code").json()["code"]
    sql(fin.dsn, "UPDATE session_codes SET expires_at = now() - interval '1 second', issued_at = now() - interval '1 hour'")
    assert _error(_post(coach, booking, "code/verify", code=first)) == (409, "code_expired")

    second = _post(player, booking, "code").json()["code"]
    if second != first:
        assert _error(_post(coach, booking, "code/verify", code=first)) == (422, "code_invalid")  # the replaced code is dead
    for _ in range(3):
        _post(player, booking, "code")
    assert sql_value(fin.dsn, "SELECT issued_count FROM session_codes") == service.MAX_CODES
    assert _error(_post(player, booking, "code")) == (429, "code_limit")
    assert _card(player, booking)["can_get_code"] is False


def test_only_the_athlete_gets_the_code_and_only_the_coach_enters_it(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    _in_person(fin, booking)
    _starts_in(fin, booking, -0.25)
    assert _post(coach, booking, "code").status_code == 403
    code = _post(player, booking, "code").json()["code"]
    assert _post(player, booking, "code/verify", code=code).status_code == 403


# --- a problem (TR-13, TR-19 backend) ---------------------------------------------------------------------------------------------

def test_a_reported_problem_freezes_the_money_until_an_administrator_decides(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    _starts_in(fin, booking, 1)
    assert _error(_post(coach, booking, "problem", kind="athlete_no_show")) == (409, "session_not_started")
    _ended(fin, booking, hours_ago=50)
    assert _error(_post(coach, booking, "problem", kind="coach_no_show")) == (422, "dispute_kind_invalid")
    assert _error(_post(player, booking, "problem", kind="other")) == (422, "reason_required")

    reported = _post(coach, booking, "problem", kind="athlete_no_show", text="Не пришёл, ждал 30 минут")
    assert reported.status_code == 200
    card = _card(player, booking)
    assert (card["state"], card["disputed_by_role"], card["dispute_kind"]) == ("disputed", "coach", "athlete_no_show")
    assert card["can_confirm"] is False and card["can_report_problem"] is False
    assert _earning(fin, booking)["status"] == "held"
    assert _error(_post(player, booking, "confirm")) == (409, "session_disputed")
    assert _post(coach, booking, "problem", kind="athlete_no_show", text="Не пришёл, ждал 30 минут").status_code == 200  # same report again
    assert _auto(fin) == 0  # the 48 hours never close a dispute
    assert _card(coach, booking)["state"] == "disputed"


def test_a_confirmation_and_a_dispute_at_the_same_moment_leave_one_consistent_result(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    _ended(fin, booking)
    results: dict[str, int] = {}
    go = [threading.Thread(target=lambda: results.__setitem__("confirm", _post(player, booking, "confirm").status_code)),
          threading.Thread(target=lambda: results.__setitem__("problem", _post(coach, booking, "problem", kind="athlete_no_show").status_code))]
    [t.start() for t in go]
    [t.join() for t in go]

    state = sql_value(fin.dsn, "SELECT state FROM session_confirmations")
    earning = _earning(fin, booking)
    if state == "confirmed":
        assert results == {"confirm": 200, "problem": 409} and earning["status"] == "pending" and earning["session_confirmed_at"] is not None
    else:
        assert state == "disputed" and results == {"confirm": 409, "problem": 200} and earning["status"] == "held"


# --- the 48 hours (TR-09) and the money (TR-12) -----------------------------------------------------------------------------------

def test_after_48_hours_the_session_confirms_itself_once(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    _ended(fin, booking, hours_ago=47)
    assert _auto(fin) == 0
    _ended(fin, booking, hours_ago=49)
    assert _auto(fin) == 1 and _auto(fin) == 0
    card = _card(player, booking)
    assert (card["state"], card["confirmed_method"]) == ("auto_confirmed", "auto")
    earning = _earning(fin, booking)
    assert earning["session_confirmed_at"] is not None and earning["at_once"] is False  # automatic: after the usual hold
    assert _error(_post(player, booking, "problem", kind="coach_no_show")) == (409, "session_already_confirmed")
    assert _post(player, booking, "confirm").status_code == 200  # nothing to add, nothing broken


def test_a_payment_that_arrives_after_the_confirmation_is_confirmed_at_once(fin) -> None:
    coach, player, booking = confirmed_booking(fin.world, confirm=True)
    _starts_in(fin, booking, 2)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")  # the payment page is open
    pid = next(iter(fin.provider.payments))
    _ended(fin, booking)
    assert _post(player, booking, "confirm").status_code == 200  # unpaid yet: nothing to settle
    fin.provider.finish(pid, "succeeded")
    assert webhook(fin.world, pid).status_code == 200

    earning = _earning(fin, booking)
    assert earning["session_confirmed_at"] is not None and earning["at_once"] is True
    assert_books_are_sound(fin.dsn)


def test_releasing_by_the_administrator_needs_the_confirmation_not_the_coachs_mark(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    _ended(fin, booking)
    coach.ok("POST", f"/api/bookings/{booking['id']}/complete")
    release = f"/api/admin/finance/earnings/{earning_of(fin, booking)}/release"
    assert fin.admin.call("POST", release, json={}).json()["error"]["code"] == "session_not_confirmed"
    player.ok("POST", f"/api/bookings/{booking['id']}/session/confirm")
    assert fin.admin.call("POST", release, json={}).status_code == 200


# --- reminders (TR-10, TR-11) and the messages about the result (TR-14) -----------------------------------------------------------

def _remind(fin) -> int:
    return run(with_conn(fin.dsn, lambda c: service.remind_due(c, get_settings())))


def _notes(fin, user_id: str) -> list[tuple[str, str]]:
    rows = sql(fin.dsn, "SELECT title, body FROM notifications WHERE user_id = $1::uuid AND category IN ('booking_decided', 'finance_admin') "
                        "AND (title LIKE '%одтвер%' OR title LIKE 'Спор%') ORDER BY created_at", user_id)
    return [(r["title"], r["body"]) for r in rows]


def _ids(fin, booking) -> tuple[str, str]:
    row = sql(fin.dsn, "SELECT athlete_user_id::text AS a, coach_user_id::text AS c FROM bookings WHERE id = $1::uuid", booking["id"])[0]
    return row["a"], row["c"]


def test_the_athlete_is_reminded_at_24_and_47_hours_once_each(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    athlete, trainer = _ids(fin, booking)
    _ended(fin, booking, hours_ago=23)
    assert _remind(fin) == 0
    _ended(fin, booking, hours_ago=25)
    assert _remind(fin) == 1 and _remind(fin) == 0
    _ended(fin, booking, hours_ago=47.5)
    assert _remind(fin) == 1 and _remind(fin) == 0
    titles = [t for t, _ in _notes(fin, athlete)]
    assert titles == ["Подтвердите тренировку", "Тренировка подтвердится через час"]
    assert _notes(fin, trainer) == []  # only the athlete can confirm


def test_a_late_pass_sends_only_the_last_reminder_and_nobody_is_reminded_of_a_closed_window(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    athlete, _ = _ids(fin, booking)
    _ended(fin, booking, hours_ago=47.5)  # the 24-hour step was missed (the server was down)
    assert _remind(fin) == 1
    assert [t for t, _ in _notes(fin, athlete)] == ["Тренировка подтвердится через час"]

    coach2, player2, booking2, _ = paid_booking(fin, 2)
    _ended(fin, booking2, hours_ago=25)
    player2.ok("POST", f"/api/bookings/{booking2['id']}/session/confirm")
    assert _remind(fin) == 0


def test_each_side_hears_about_the_result(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    athlete, trainer = _ids(fin, booking)
    _ended(fin, booking)
    player.ok("POST", f"/api/bookings/{booking['id']}/session/confirm")
    assert _notes(fin, trainer)[-1][0] == "Игрок подтвердил тренировку" and _notes(fin, athlete) == []

    coach2, player2, booking2, _ = paid_booking(fin, 2)
    athlete2, trainer2 = _ids(fin, booking2)
    _ended(fin, booking2, hours_ago=49)
    assert _auto(fin) == 1
    assert "автоматически" in _notes(fin, athlete2)[-1][1] and "автоматически" in _notes(fin, trainer2)[-1][1]


def test_a_dispute_is_told_to_the_other_side_and_to_the_finance_administrators(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    athlete, trainer = _ids(fin, booking)
    admin = sql_value(fin.dsn, "SELECT id::text FROM users WHERE lower(email) = lower($1)", get_settings().finance_admin_emails_list[0])
    _ended(fin, booking)
    player.ok("POST", f"/api/bookings/{booking['id']}/session/problem", json={"kind": "coach_no_show", "text": None})

    title, body = _notes(fin, trainer)[-1]
    assert title == "Спор по тренировке" and body.startswith("Игрок сообщил, что вы не пришли на тренировку") and "заморожена" in body
    assert _notes(fin, athlete) == []
    assert _notes(fin, admin)[-1][0] == "Спор по занятию"


# --- the administrator decides (TR-13) ----------------------------------------------------------------------------------------------

def _resolve(fin, booking, outcome: str, note: str = "Посмотрел переписку"):
    return fin.admin.call("POST", f"/api/admin/finance/disputes/{booking['id']}/resolve", json={"outcome": outcome, "note": note})


def test_the_administrator_gives_the_payment_to_the_trainer(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    athlete, trainer = _ids(fin, booking)
    _ended(fin, booking)
    coach.ok("POST", f"/api/bookings/{booking['id']}/session/problem", json={"kind": "athlete_no_show", "text": "Не пришёл"})

    listed = fin.admin.ok("GET", "/api/admin/finance/disputes")
    assert listed["total"] == 1 and listed["items"][0]["dispute_kind"] == "athlete_no_show" and listed["items"][0]["earning_status"] == "held"
    assert _resolve(fin, booking, "release", note="ok").status_code == 422  # a decision is explained
    done = _resolve(fin, booking, "release")
    assert done.status_code == 200 and done.json()["state"] == "resolved_released"
    earning = _earning(fin, booking)
    assert earning["status"] == "pending" and earning["session_confirmed_at"] is not None and earning["at_once"] is True
    assert _error(_resolve(fin, booking, "refund")) == (409, "dispute_already_resolved")
    assert fin.admin.ok("GET", "/api/admin/finance/disputes")["total"] == 0  # open ones only by default
    assert _card(player, booking)["state"] == "resolved_released"
    assert _notes(fin, athlete)[-1][0] == _notes(fin, trainer)[-1][0] == "Спор решён"
    assert sql_value(fin.dsn, "SELECT count(*) FROM admin_audit_log WHERE action = 'finance.dispute.resolve' AND result = 'success'") == 1


def test_the_administrator_returns_the_money_to_the_athlete(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    _ended(fin, booking)
    player.ok("POST", f"/api/bookings/{booking['id']}/session/problem", json={"kind": "coach_no_show", "text": None})

    done = _resolve(fin, booking, "refund")
    assert done.status_code == 200 and done.json()["refund_id"] is not None
    assert len(fin.provider.refund_requests) == 1 and fin.provider.refund_requests[0]["amount_kopecks"] == 250000
    rid = next(iter(fin.provider.refunds))
    fin.provider.finish_refund(rid, "succeeded")
    assert webhook(fin.world, rid, "refund.succeeded").status_code == 200

    assert sql_value(fin.dsn, "SELECT status FROM payments") == "refunded"
    assert _earning(fin, booking)["status"] == "reversed"
    assert_books_are_sound(fin.dsn)


def test_there_is_nothing_to_decide_without_a_dispute(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    assert _resolve(fin, booking, "release").status_code == 404


# --- races and money safety (TR-20, TR-21) ----------------------------------------------------------------------------------------

def test_the_right_code_entered_twice_at_once_confirms_once(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    _in_person(fin, booking)
    _starts_in(fin, booking, -0.25)
    code = _post(player, booking, "code").json()["code"]
    statuses: list[int] = []
    go = [threading.Thread(target=lambda: statuses.append(_post(coach, booking, "code/verify", code=code).status_code)) for _ in range(2)]
    [t.start() for t in go]
    [t.join() for t in go]

    assert statuses == [200, 200]
    assert sql_value(fin.dsn, "SELECT count(*) FROM session_confirmations WHERE state = 'confirmed' AND confirmed_method = 'code'") == 1
    assert sql_value(fin.dsn, "SELECT count(*) FROM session_codes WHERE verified_at IS NOT NULL") == 1
    assert sql_value(fin.dsn, "SELECT attempts FROM session_codes") == 0  # neither entry was counted as wrong


def test_the_athletes_confirmation_and_the_48_hours_at_once_close_the_window_once(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    _ended(fin, booking, hours_ago=49)
    results: dict[str, object] = {}
    go = [threading.Thread(target=lambda: results.__setitem__("athlete", _post(player, booking, "confirm").status_code)),
          threading.Thread(target=lambda: results.__setitem__("auto", _auto(fin)))]
    [t.start() for t in go]
    [t.join() for t in go]

    state, method = sql(fin.dsn, "SELECT state, confirmed_method FROM session_confirmations")[0]
    assert results["athlete"] == 200
    assert (state, method, results["auto"]) in {("confirmed", "athlete", 0), ("auto_confirmed", "auto", 1)}
    assert _earning(fin, booking)["session_confirmed_at"] is not None


def test_a_confirmed_earning_is_released_once_however_often_it_is_asked(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    _ended(fin, booking)
    player.ok("POST", f"/api/bookings/{booking['id']}/session/confirm")
    release = f"/api/admin/finance/earnings/{earning_of(fin, booking)}/release"
    assert fin.admin.call("POST", release, json={}).status_code == 200
    assert fin.admin.call("POST", release, json={}).status_code == 200  # the same earning, already released
    assert player.call("POST", f"/api/bookings/{booking['id']}/session/confirm").status_code == 200
    assert sql_value(fin.dsn, "SELECT count(*) FROM ledger_transactions WHERE kind = 'earning_released'") == 1
    assert coach.ok("GET", "/api/finance/summary")["available_kopecks"] == 225000
    assert_books_are_sound(fin.dsn)


def test_old_sessions_are_confirmed_silently_when_the_feature_arrives(fin) -> None:
    """Sessions that ended long before this was released are closed by the first pass without messages about weeks-old training."""
    coach, player, booking, _ = paid_booking(fin)
    athlete, trainer = _ids(fin, booking)
    _ended(fin, booking, hours_ago=24 * 30)
    assert _auto(fin) == 1
    assert sql_value(fin.dsn, "SELECT state FROM session_confirmations") == "auto_confirmed"
    assert _notes(fin, athlete) == [] and _notes(fin, trainer) == []
