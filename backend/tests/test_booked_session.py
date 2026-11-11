"""The session of a booking lives in the athlete's calendar, but its time and its «conducted» belong to the booking (docs/session-confirmation.md):
the athlete must not mark it conducted or move it by editing the training, and the coach's «Тренировка проведена» always settles the earning."""
from __future__ import annotations

from app.core import session_time
from tests.admin_world import live_client, pg, world  # noqa: F401  (fixtures)
from tests.live_helpers import sql, sql_value
from tests.test_finance import fin, paid_booking  # noqa: F401  (fixtures and helpers)


def _training_id(fin, booking) -> str:
    return sql_value(fin.dsn, "SELECT training_id::text FROM bookings WHERE id = $1::uuid", booking["id"])


def _edit(user, training_id: str, **change):
    """The training as the client sends it back from its edit form, with some fields changed."""
    t = user.ok("GET", f"/api/trainings/{training_id}")
    body = {k: t[k] for k in ("training_date", "start_time", "duration_minutes", "location", "description", "plan_id", "reminder_minutes_before", "status")}
    body.update(is_independent=False, responsible_user_id=None)
    body.update(change)
    return user.call("PUT", f"/api/trainings/{training_id}", json=body)


def _starts_in(fin, booking, hours: float) -> None:
    """The session starts in `hours` on the platform's clock (starts_at is wall-clock time, see app/core/session_time.py)."""
    sql(fin.dsn, f"UPDATE bookings SET starts_at = {session_time.sql_wall_now()} + make_interval(secs => $2) WHERE id = $1::uuid", booking["id"], hours * 3600)


def _confirmed_at(fin):
    return sql_value(fin.dsn, "SELECT session_confirmed_at FROM trainer_earnings")


def test_the_athlete_cannot_mark_a_booked_session_conducted(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    training_id = _training_id(fin, booking)
    for hours in (48, -2):  # neither before the start nor after it: «conducted» is the coach's word (and later the confirmation's)
        _starts_in(fin, booking, hours)
        refused = _edit(player, training_id, status="completed")
        assert refused.status_code == 409 and refused.json()["error"]["code"] == "booked_session_managed_by_booking"
    assert sql_value(fin.dsn, "SELECT status FROM trainings WHERE id = $1::uuid", training_id) == "scheduled"
    assert coach.call("POST", f"/api/bookings/{booking['id']}/complete").status_code == 200
    assert _confirmed_at(fin) is not None


def test_the_athlete_cannot_move_a_booked_session(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    training_id = _training_id(fin, booking)
    before = sql_value(fin.dsn, "SELECT (training_date, start_time, duration_minutes)::text FROM trainings WHERE id = $1::uuid", training_id)
    for change in ({"training_date": "2030-01-01"}, {"start_time": "06:15:00"}, {"duration_minutes": 15}):
        refused = _edit(player, training_id, **change)
        assert refused.status_code == 409 and refused.json()["error"]["code"] == "booked_session_managed_by_booking", change
    assert sql_value(fin.dsn, "SELECT (training_date, start_time, duration_minutes)::text FROM trainings WHERE id = $1::uuid", training_id) == before


def test_the_athlete_still_keeps_their_own_notes_on_a_booked_session(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    training_id = _training_id(fin, booking)
    saved = _edit(player, training_id, description="Взять ракетку", reminder_minutes_before=30)
    assert saved.status_code == 200 and saved.json()["description"] == "Взять ракетку"


def test_the_session_of_a_cancelled_booking_cannot_be_brought_back(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    training_id = _training_id(fin, booking)
    _starts_in(fin, booking, 48)
    assert player.call("POST", f"/api/bookings/{booking['id']}/cancel", json={}).status_code == 200
    refused = _edit(player, training_id, status="scheduled")
    assert refused.status_code == 409 and sql_value(fin.dsn, "SELECT status FROM trainings WHERE id = $1::uuid", training_id) == "cancelled"


def test_the_coachs_mark_settles_the_earning_even_when_the_training_was_already_marked(fin) -> None:
    """Sessions an athlete marked conducted before this was closed: the coach's button must still settle the money, and only after the start."""
    coach, player, booking, _ = paid_booking(fin)
    training_id = _training_id(fin, booking)
    sql(fin.dsn, "UPDATE trainings SET status = 'completed' WHERE id = $1::uuid", training_id)  # as the old road left it

    _starts_in(fin, booking, 48)
    early = coach.call("POST", f"/api/bookings/{booking['id']}/complete")
    assert early.status_code == 409 and early.json()["error"]["code"] == "session_not_started" and _confirmed_at(fin) is None

    _starts_in(fin, booking, -2)
    assert coach.call("POST", f"/api/bookings/{booking['id']}/complete").status_code == 200
    assert _confirmed_at(fin) is not None
    assert coach.call("POST", f"/api/bookings/{booking['id']}/complete").status_code == 200  # repeating it is still harmless
