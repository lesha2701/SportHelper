from __future__ import annotations

from datetime import datetime, timedelta, timezone

from tests.test_booking_confirmation_api import _create_pending_booking
from tests.test_teams_api import _create_coach_profile


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _confirmed_booking(client, coach_token, login_as, telegram_id=891001):
    """A confirmed booking: (booking, athlete_token, athlete_user_id)."""
    _l, athlete_token, booking = _create_pending_booking(client, coach_token, login_as, telegram_id)
    confirmed = client.post(f"/api/bookings/{booking['id']}/confirm", headers=_h(coach_token)).json()
    athlete_id = client.get("/api/auth/me", headers=_h(athlete_token)).json()["id"]
    return confirmed, athlete_token, athlete_id


def _session_started(client, booking_id: str, *, minutes_ago: int = 5) -> None:
    """Moves the session to 'in progress' (started, not yet over) — confirming needs a future slot."""
    for record in client.bookings_store.values():
        if str(record["id"]) == booking_id:
            record["starts_at"] = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
            record["duration_minutes"] = 60


def _complete(client, coach_token, booking_id):
    return client.post(f"/api/bookings/{booking_id}/complete", headers=_h(coach_token))


def _my_notifications(client, token, category):
    return [n for n in client.get("/api/notifications", headers=_h(token)).json() if n["category"] == category]


# --- «Тренировка проведена» -------------------------------------------------------


def test_coach_cannot_mark_a_session_conducted_before_it_starts(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    booking, _athlete, _ = _confirmed_booking(client, coach_token, login_as)

    resp = _complete(client, coach_token, booking["id"])

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "session_not_started"


def test_marking_conducted_completes_the_session_and_asks_the_athlete_for_a_review(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    booking, athlete_token, _ = _confirmed_booking(client, coach_token, login_as)
    _session_started(client, booking["id"])
    assert client.get("/api/bookings/me", headers=_h(athlete_token)).json()[0]["is_completed"] is False

    resp = _complete(client, coach_token, booking["id"])

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["training_status"] == "completed"
    assert body["is_completed"] is True  # reviews are open now, although the slot hasn't ended
    assert client.get(f"/api/trainings/{booking['training_id']}", headers=_h(athlete_token)).json()["status"] == "completed"
    asked = _my_notifications(client, athlete_token, "review_requested")
    assert len(asked) == 1
    assert asked[0]["entity_id"] == booking["id"]
    assert "отзыв" in asked[0]["title"].lower()


def test_marking_conducted_twice_does_not_ask_again(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    booking, athlete_token, _ = _confirmed_booking(client, coach_token, login_as)
    _session_started(client, booking["id"])

    _complete(client, coach_token, booking["id"])
    again = _complete(client, coach_token, booking["id"])

    assert again.status_code == 200
    assert len(_my_notifications(client, athlete_token, "review_requested")) == 1


def test_only_the_coach_of_the_session_can_mark_it_conducted(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    booking, athlete_token, _ = _confirmed_booking(client, coach_token, login_as)
    _session_started(client, booking["id"])
    stranger = login_as(891090, first_name="Stranger")

    assert _complete(client, athlete_token, booking["id"]).status_code == 403
    assert _complete(client, stranger, booking["id"]).status_code == 403
    assert _my_notifications(client, athlete_token, "review_requested") == []


# --- When reviews open ----------------------------------------------------------------


def test_athlete_can_review_the_coach_only_once_the_session_is_conducted(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    booking, athlete_token, _ = _confirmed_booking(client, coach_token, login_as)
    _session_started(client, booking["id"])
    review = {"rating": 5, "text": "Отличная работа"}

    early = client.post(f"/api/bookings/{booking['id']}/reviews", headers=_h(athlete_token), json=review)
    assert early.status_code == 409
    assert early.json()["error"]["code"] == "booking_not_completed"

    _complete(client, coach_token, booking["id"])
    ok = client.post(f"/api/bookings/{booking['id']}/reviews", headers=_h(athlete_token), json=review)
    assert ok.status_code == 200


def test_reviews_also_open_by_themselves_once_the_session_time_is_over(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    booking, athlete_token, _ = _confirmed_booking(client, coach_token, login_as)
    _session_started(client, booking["id"], minutes_ago=90)  # ended 30 min ago, coach never pressed anything

    assert client.get("/api/bookings/me", headers=_h(athlete_token)).json()[0]["is_completed"] is True
    resp = client.post(f"/api/bookings/{booking['id']}/reviews", headers=_h(athlete_token), json={"rating": 4, "text": None})
    assert resp.status_code == 200


# --- Coach reviews the player ----------------------------------------------------------


def test_coach_can_review_the_player_after_the_session_but_not_twice(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    booking, _athlete, _ = _confirmed_booking(client, coach_token, login_as)
    _session_started(client, booking["id"])
    review = {"rating": 2, "text": "Опоздал на 20 минут, не выполнял задания"}

    early = client.post(f"/api/bookings/{booking['id']}/player-review", headers=_h(coach_token), json=review)
    assert early.status_code == 409 and early.json()["error"]["code"] == "booking_not_completed"

    _complete(client, coach_token, booking["id"])
    ok = client.post(f"/api/bookings/{booking['id']}/player-review", headers=_h(coach_token), json=review)
    assert ok.status_code == 200
    assert ok.json()["rating"] == 2

    dup = client.post(f"/api/bookings/{booking['id']}/player-review", headers=_h(coach_token), json=review)
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "already_reviewed"
    mine = client.get("/api/bookings/coach", headers=_h(coach_token)).json()
    assert mine[0]["has_player_review"] is True


def test_rating_must_be_between_one_and_five(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    booking, _athlete, _ = _confirmed_booking(client, coach_token, login_as)
    _session_started(client, booking["id"])
    _complete(client, coach_token, booking["id"])

    for rating in (0, 6):
        resp = client.post(f"/api/bookings/{booking['id']}/player-review", headers=_h(coach_token), json={"rating": rating})
        assert resp.status_code == 422


def test_only_the_sessions_coach_can_review_the_player(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    booking, athlete_token, _ = _confirmed_booking(client, coach_token, login_as)
    _session_started(client, booking["id"])
    _complete(client, coach_token, booking["id"])
    other_coach = login_as(891091, first_name="Other")
    _create_coach_profile(client, other_coach)

    for token in (athlete_token, other_coach):
        resp = client.post(f"/api/bookings/{booking['id']}/player-review", headers=_h(token), json={"rating": 1, "text": "x"})
        assert resp.status_code == 403


# --- Who can read what coaches wrote about a player ---------------------------------------


def test_coaches_with_a_booking_see_the_reviews_everyone_else_does_not(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    booking, athlete_token, athlete_id = _confirmed_booking(client, coach_token, login_as)
    _session_started(client, booking["id"])
    _complete(client, coach_token, booking["id"])
    client.post(
        f"/api/bookings/{booking['id']}/player-review", headers=_h(coach_token), json={"rating": 2, "text": "Не рекомендую"}
    )

    seen = client.get(f"/api/players/{athlete_id}/reviews", headers=_h(coach_token))
    assert seen.status_code == 200
    body = seen.json()
    assert body["count"] == 1 and body["average"] == 2
    assert body["reviews"][0]["text"] == "Не рекомендую"
    assert body["reviews"][0]["coach_name"] == "Coach"

    unrelated_coach = login_as(891092, first_name="Unrelated")
    other_player = login_as(891093, first_name="Player")
    for token in (unrelated_coach, other_player, athlete_token):  # not the player themself either
        assert client.get(f"/api/players/{athlete_id}/reviews", headers=_h(token)).status_code == 403


def test_a_new_request_shows_how_other_coaches_rated_the_athlete(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    booking, athlete_token, athlete_id = _confirmed_booking(client, coach_token, login_as, 891002)
    _session_started(client, booking["id"])
    _complete(client, coach_token, booking["id"])
    client.post(f"/api/bookings/{booking['id']}/player-review", headers=_h(coach_token), json={"rating": 1, "text": "Плохо"})

    # The same athlete now asks a second coach for a session.
    second_coach = login_as(891003, first_name="Second")
    _l, _t, pending = _create_pending_booking(client, second_coach, login_as, 891004)  # a different athlete — control
    other_listing = client.get("/api/coach-listings", headers=_h(athlete_token)).json()
    target = next(c for c in other_listing if c["coach_user_id"] != booking["coach_user_id"])
    slot = client.get(
        f"/api/coach-listings/{target['id']}/slots",
        params={"from_date": datetime.now(timezone.utc).date().isoformat(), "to_date": (datetime.now(timezone.utc) + timedelta(days=14)).date().isoformat()},
        headers=_h(athlete_token),
    ).json()[0]["starts_at"]
    asked = client.post(
        "/api/bookings",
        headers=_h(athlete_token),
        json={"listing_id": target["id"], "starts_at": slot, "format": "online"},
    )
    assert asked.status_code == 200, asked.text

    rows = client.get("/api/bookings/coach/pending", headers=_h(second_coach)).json()
    mine = next(r for r in rows if r["athlete_user_id"] == athlete_id)
    assert mine["athlete_review_count"] == 1 and mine["athlete_rating_average"] == 1
    control = next(r for r in rows if r["athlete_user_id"] != athlete_id)
    assert control["athlete_review_count"] == 0 and control["athlete_rating_average"] is None
    assert pending["id"]
