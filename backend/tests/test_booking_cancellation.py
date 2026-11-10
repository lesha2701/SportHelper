"""Cancelling a confirmed booking: who may, by which rule the money goes back, and that the books stay sound (docs/refunds-api.md, section 7).

Real PostgreSQL and the pretend ЮKassa of the finance tests."""
from __future__ import annotations

import pytest

from app.config import get_settings
from app.integrations.yookassa import YooKassaError
from app.services import reconcile
from tests.admin_world import live_client, pg, world  # noqa: F401  (fixtures)
from tests.finance_helpers import assert_books_are_sound, confirmed_booking, ledger_totals, run, trainer_balances, webhook, with_conn
from tests.live_helpers import Browser, sql, sql_value
from tests.test_finance import conduct, earning_of, fin, paid_booking  # noqa: F401  (fixtures and helpers)

REASON = "Заболел"


def starts_in(fin, booking, hours: float) -> None:
    sql(fin.dsn, "UPDATE bookings SET starts_at = now() + make_interval(secs => $2) WHERE id = $1::uuid", booking["id"], hours * 3600)


def cancel(user, booking, **body):
    return user.call("POST", f"/api/bookings/{booking['id']}/cancel", json=body)


def finish_refund(fin) -> None:
    rid = next(iter(fin.provider.refunds))
    fin.provider.finish_refund(rid, "succeeded")
    assert webhook(fin.world, rid, "refund.succeeded").status_code == 200


# --- the money goes back by the rule ------------------------------------------------------------------------------------------


def test_the_athlete_cancelling_early_gets_everything_back(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    starts_in(fin, booking, 48)

    done = cancel(player, booking)

    assert done.status_code == 200
    body = done.json()
    assert body["status"] == "cancelled" and body["can_cancel"] is False
    assert body["cancellation"]["policy"] == "athlete_early" and body["cancellation"]["cancelled_by_role"] == "athlete"
    assert (body["cancellation"]["refund_percent"], body["cancellation"]["refund_amount_kopecks"], body["cancellation"]["refund_status"]) == (100, 250000, "pending")
    assert fin.provider.refund_requests[0]["amount_kopecks"] == 250000
    assert sql_value(fin.dsn, "SELECT status FROM trainings WHERE id = $1::uuid", body["training_id"]) == "cancelled"
    assert sql_value(fin.dsn, "SELECT refund_id IS NOT NULL FROM booking_cancellations") is True

    finish_refund(fin)

    assert sql_value(fin.dsn, "SELECT status FROM payments") == "refunded" and sql_value(fin.dsn, "SELECT status FROM trainer_earnings") == "reversed"
    totals = ledger_totals(fin.dsn)
    assert (totals["provider_receivable"], totals["platform_revenue"], totals["trainer_pending"], totals["trainer_debt"]) == (0, 0, 0, 0)  # the commission went back too
    mine = player.ok("GET", "/api/bookings/me")[0]
    assert mine["payment_status"] == "refunded" and mine["cancellation"]["refund_status"] == "succeeded"
    assert coach.ok("GET", "/api/bookings/coach")[0]["status"] == "cancelled"
    assert_books_are_sound(fin.dsn)


def test_the_athlete_cancelling_late_gets_nothing_and_the_trainer_keeps_the_payment(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    starts_in(fin, booking, 2)

    body = cancel(player, booking).json()

    assert body["status"] == "cancelled"
    assert (body["cancellation"]["policy"], body["cancellation"]["refund_percent"], body["cancellation"]["refund_amount_kopecks"], body["cancellation"]["refund_status"]) == ("athlete_late", 0, 0, "none")
    assert fin.provider.refund_requests == [] and sql_value(fin.dsn, "SELECT count(*) FROM refunds") == 0
    assert sql_value(fin.dsn, "SELECT status FROM payments") == "paid"
    assert sql_value(fin.dsn, "SELECT status FROM trainer_earnings") == "pending"
    assert sql_value(fin.dsn, "SELECT session_confirmed_at IS NOT NULL FROM trainer_earnings") is True  # it goes the usual way to release (the hold, then the release)
    assert trainer_balances(fin.dsn, coach.user_id)["trainer_pending"] == 225000
    assert sql_value(fin.dsn, "SELECT status FROM trainings WHERE id = $1::uuid", body["training_id"]) == "cancelled"
    assert_books_are_sound(fin.dsn)


def test_the_boundary_is_cancel_free_hours_before_the_start(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    starts_in(fin, booking, 25)
    assert player.ok("GET", f"/api/bookings/{booking['id']}/cancel-preview")["policy"] == "athlete_early"
    starts_in(fin, booking, 23)
    assert player.ok("GET", f"/api/bookings/{booking['id']}/cancel-preview")["policy"] == "athlete_late"


def test_the_trainer_cancelling_needs_a_reason_and_returns_everything_even_late(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    starts_in(fin, booking, 1)

    for body in ({}, {"reason": "  "}, {"reason": "ab"}):
        refused = cancel(coach, booking, **body)
        assert refused.status_code == 422 and refused.json()["error"]["code"] == "reason_required"
    assert sql_value(fin.dsn, "SELECT status FROM bookings") == "confirmed" and sql_value(fin.dsn, "SELECT count(*) FROM booking_cancellations") == 0

    body = cancel(coach, booking, reason=REASON).json()

    assert (body["cancellation"]["policy"], body["cancellation"]["cancelled_by_role"], body["cancellation"]["reason"]) == ("coach", "coach", REASON)
    assert body["cancellation"]["refund_amount_kopecks"] == 250000
    finish_refund(fin)
    assert sql_value(fin.dsn, "SELECT status FROM payments") == "refunded"
    assert_books_are_sound(fin.dsn)


def test_cancelling_an_unpaid_booking_is_only_a_cancellation(fin) -> None:
    coach, player, booking = confirmed_booking(fin.world, confirm=True)
    starts_in(fin, booking, 48)
    assert player.ok("GET", f"/api/bookings/{booking['id']}/cancel-preview")["policy"] == "unpaid"

    body = cancel(player, booking).json()

    assert body["status"] == "cancelled" and body["cancellation"]["policy"] == "unpaid"
    assert (body["cancellation"]["refund_amount_kopecks"], body["cancellation"]["refund_status"]) == (0, "none")
    assert sql_value(fin.dsn, "SELECT count(*) FROM refunds") == 0
    assert cancel(player, booking).status_code == 200


def test_cancelling_twice_changes_nothing_and_returns_nothing_twice(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    starts_in(fin, booking, 48)
    first = cancel(player, booking)
    again = cancel(player, booking)
    other_side = cancel(coach, booking, reason=REASON)

    assert first.status_code == again.status_code == other_side.status_code == 200
    assert again.json()["cancellation"] == first.json()["cancellation"] == other_side.json()["cancellation"]
    assert sql_value(fin.dsn, "SELECT count(*) FROM refunds") == 1 and len(fin.provider.refund_requests) == 1
    assert sql_value(fin.dsn, "SELECT refund_reserved_kopecks FROM payments") == 250000


# --- what cannot be cancelled -------------------------------------------------------------------------------------------------


def test_a_session_that_started_or_was_conducted_cannot_be_cancelled(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    starts_in(fin, booking, -1)
    refused = cancel(player, booking)
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "session_started"
    assert player.call("GET", f"/api/bookings/{booking['id']}/cancel-preview").status_code == 409
    assert player.ok("GET", "/api/bookings/me")[0]["can_cancel"] is False

    conduct(fin, coach, booking)
    refused = cancel(coach, booking, reason=REASON)
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "session_completed"
    assert sql_value(fin.dsn, "SELECT count(*) FROM refunds") == 0


def test_only_a_confirmed_booking_is_cancelled(fin) -> None:
    coach, player, booking = confirmed_booking(fin.world)  # still waiting for the trainer
    refused = cancel(player, booking)
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "booking_not_confirmed"


def test_someone_elses_booking_looks_like_a_missing_one(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    stranger = Browser(fin.world.client, "stranger@example.com", "Чужой", "player")
    for call in (cancel(stranger, booking, reason=REASON), stranger.call("GET", f"/api/bookings/{booking['id']}/cancel-preview")):
        assert call.status_code == 404
    assert sql_value(fin.dsn, "SELECT status FROM bookings") == "confirmed"


def test_a_cancelled_booking_cannot_be_paid_and_the_slot_is_free_again(fin) -> None:
    coach, player, booking = confirmed_booking(fin.world, confirm=True)
    starts_in(fin, booking, 48)
    cancel(player, booking)

    paying = player.call("POST", f"/api/bookings/{booking['id']}/pay")
    assert paying.status_code == 409 and paying.json()["error"]["code"] == "booking_not_confirmed"
    assert sql_value(fin.dsn, "SELECT count(*) FROM bookings WHERE status IN ('pending', 'confirmed')") == 0  # the slot's unique index no longer holds it


# --- the provider, the trainer's money, a late payment -------------------------------------------------------------------------


def test_the_cancellation_does_not_wait_for_the_provider_and_the_refund_follows(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    starts_in(fin, booking, 48)
    fin.provider.fail_refund_next = YooKassaError("ЮKassa is unreachable", retryable=True)

    done = cancel(player, booking)

    assert done.status_code == 200 and done.json()["status"] == "cancelled"
    assert done.json()["cancellation"]["refund_status"] == "pending"
    assert sql_value(fin.dsn, "SELECT status FROM refunds") == "requested" and fin.provider.refund_requests == []
    assert sql_value(fin.dsn, "SELECT refund_reserved_kopecks FROM payments") == 250000  # the athlete's money is held for the refund, not lost

    async def tick(conn):
        return await reconcile.reconcile_payments(conn, get_settings())

    sql(fin.dsn, "UPDATE refunds SET updated_at = now() - interval '5 minutes'")  # the reconciliation takes what has waited a couple of minutes
    run(with_conn(fin.dsn, tick))
    assert len(fin.provider.refund_requests) == 1 and sql_value(fin.dsn, "SELECT status FROM refunds") == "pending"
    finish_refund(fin)
    assert sql_value(fin.dsn, "SELECT status FROM payments") == "refunded"
    assert_books_are_sound(fin.dsn)


def test_a_late_cancellation_leaves_the_earning_on_the_usual_road_to_release(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    starts_in(fin, booking, 2)
    cancel(player, booking)

    released = fin.admin.ok("POST", f"/api/admin/finance/earnings/{earning_of(fin, booking)}/release", json={"note": "поздняя отмена"})

    assert released["status"] == "available"
    assert trainer_balances(fin.dsn, coach.user_id)["trainer_available"] == 225000
    assert_books_are_sound(fin.dsn)


def test_a_payment_that_arrives_after_the_cancellation_is_returned_in_full(fin) -> None:
    coach, player, booking = confirmed_booking(fin.world, confirm=True)
    starts_in(fin, booking, 48)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")  # the payment page is open
    pid = next(iter(fin.provider.payments))

    assert cancel(coach, booking, reason=REASON).json()["cancellation"]["policy"] == "unpaid"
    fin.provider.finish(pid, "succeeded")  # ...and the athlete pays on it anyway
    assert webhook(fin.world, pid).status_code == 200

    assert sql_value(fin.dsn, "SELECT status FROM payments") == "paid"
    assert len(fin.provider.refund_requests) == 1 and fin.provider.refund_requests[0]["amount_kopecks"] == 250000
    assert sql_value(fin.dsn, "SELECT count(*) FROM payment_incidents WHERE kind = 'paid_booking_closed'") == 1  # the administrator still sees it
    finish_refund(fin)
    assert sql_value(fin.dsn, "SELECT status FROM payments") == "refunded" and sql_value(fin.dsn, "SELECT status FROM trainer_earnings") == "reversed"
    assert_books_are_sound(fin.dsn)


def test_the_other_side_is_told_about_the_cancellation(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    starts_in(fin, booking, 48)
    cancel(player, booking)

    assert sql_value(fin.dsn, "SELECT count(*) FROM notifications WHERE title = 'Тренировка отменена' AND user_id = $1::uuid", coach.user_id) == 1
    assert sql_value(fin.dsn, "SELECT count(*) FROM notifications WHERE title = 'Тренировка отменена' AND user_id = $1::uuid", player.user_id) == 0


def test_the_preview_changes_nothing_and_tells_the_amount(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    starts_in(fin, booking, 48)

    mine = player.ok("GET", f"/api/bookings/{booking['id']}/cancel-preview")
    theirs = coach.ok("GET", f"/api/bookings/{booking['id']}/cancel-preview")

    assert (mine["policy"], mine["refund_percent"], mine["refund_kopecks"], mine["paid_kopecks"], mine["trainer_keeps_payment"]) == ("athlete_early", 100, 250000, 250000, False)
    assert mine["free_cancel_until"] is not None and 47 < mine["hours_before_start"] <= 48
    assert (theirs["policy"], theirs["free_cancel_until"], theirs["refund_kopecks"]) == ("coach", None, 250000)
    assert sql_value(fin.dsn, "SELECT status FROM bookings") == "confirmed" and sql_value(fin.dsn, "SELECT count(*) FROM booking_cancellations") == 0
    assert player.ok("GET", "/api/bookings/me")[0]["can_cancel"] is True


def test_a_booked_session_cannot_be_cancelled_or_deleted_around_the_booking(fin) -> None:
    """The athlete owns the session in the calendar. Cancelling or deleting it alone would leave the booking confirmed and paid, and the trainer's slot taken: that road is closed."""
    coach, player, booking, payment_id = paid_booking(fin)
    starts_in(fin, booking, 48)
    training_id = booking.get("training_id") or sql_value(fin.dsn, "SELECT training_id::text FROM bookings WHERE id = $1::uuid", booking["id"])
    training = player.ok("GET", f"/api/trainings/{training_id}")
    body = {"training_date": training["training_date"], "start_time": training["start_time"], "duration_minutes": training["duration_minutes"],
            "location": training["location"], "description": training["description"], "plan_id": training["plan_id"],
            "reminder_minutes_before": training["reminder_minutes_before"], "status": "cancelled", "is_independent": False, "responsible_user_id": None}

    cancelled = player.call("PUT", f"/api/trainings/{training_id}", json=body)
    deleted = player.call("DELETE", f"/api/trainings/{training_id}")

    assert cancelled.status_code == deleted.status_code == 409
    assert cancelled.json()["error"]["code"] == deleted.json()["error"]["code"] == "booked_session_use_cancel"
    assert sql_value(fin.dsn, "SELECT status FROM trainings WHERE id = $1::uuid", training_id) == "scheduled"
    assert cancel(coach, booking, reason=REASON).status_code == 200  # the way that settles the money still works
