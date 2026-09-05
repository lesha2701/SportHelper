from __future__ import annotations

from datetime import date, timedelta

from tests.test_bookings_api import _list_coach_with_slot


def test_athlete_can_review_completed_booking(logged_in_client, login_as, monkeypatch) -> None:
    client, coach_token = logged_in_client
    coach_id, slot = _list_coach_with_slot(client, coach_token)

    athlete_token = login_as(891001, first_name="Athlete")
    athlete_headers = {"Authorization": f"Bearer {athlete_token}"}
    booking = client.post(
        "/api/bookings",
        headers=athlete_headers,
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "online"},
    ).json()

    import app.repositories.bookings as bookings_module

    monkeypatch.setattr(bookings_module, "is_completed", lambda booking: True)

    resp = client.post(
        f"/api/bookings/{booking['id']}/reviews",
        headers=athlete_headers,
        json={"rating": 5, "text": "Отличная тренировка"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["rating"] == 5

    profile = client.get(f"/api/coaches/{coach_id}", headers=athlete_headers).json()
    assert profile["average_rating"] == 5.0
    assert profile["review_count"] == 1


def test_cannot_review_before_completion(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_id, slot = _list_coach_with_slot(client, coach_token)

    athlete_token = login_as(891002, first_name="Athlete")
    athlete_headers = {"Authorization": f"Bearer {athlete_token}"}
    booking = client.post(
        "/api/bookings",
        headers=athlete_headers,
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "online"},
    ).json()

    resp = client.post(
        f"/api/bookings/{booking['id']}/reviews", headers=athlete_headers, json={"rating": 5, "text": None}
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "booking_not_completed"


def test_only_the_booking_athlete_can_review_it(logged_in_client, login_as, monkeypatch) -> None:
    client, coach_token = logged_in_client
    coach_id, slot = _list_coach_with_slot(client, coach_token)

    athlete_token = login_as(891003, first_name="Athlete")
    outsider_token = login_as(891004, first_name="Outsider")
    booking = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {athlete_token}"},
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "online"},
    ).json()

    import app.repositories.bookings as bookings_module

    monkeypatch.setattr(bookings_module, "is_completed", lambda booking: True)

    resp = client.post(
        f"/api/bookings/{booking['id']}/reviews",
        headers={"Authorization": f"Bearer {outsider_token}"},
        json={"rating": 1, "text": None},
    )
    assert resp.status_code == 403


def test_cannot_review_the_same_booking_twice(logged_in_client, login_as, monkeypatch) -> None:
    client, coach_token = logged_in_client
    coach_id, slot = _list_coach_with_slot(client, coach_token)

    athlete_token = login_as(891005, first_name="Athlete")
    athlete_headers = {"Authorization": f"Bearer {athlete_token}"}
    booking = client.post(
        "/api/bookings",
        headers=athlete_headers,
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "online"},
    ).json()

    import app.repositories.bookings as bookings_module

    monkeypatch.setattr(bookings_module, "is_completed", lambda booking: True)

    first = client.post(f"/api/bookings/{booking['id']}/reviews", headers=athlete_headers, json={"rating": 4, "text": None})
    assert first.status_code == 200

    second = client.post(f"/api/bookings/{booking['id']}/reviews", headers=athlete_headers, json={"rating": 2, "text": None})
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "already_reviewed"


def test_concurrent_reviews_of_same_booking_yield_clean_409(logged_in_client, login_as, monkeypatch) -> None:
    """Simulates the race between two concurrent review requests for the same
    booking: both could pass the route's proactive get_by_booking check
    before either finishes inserting, so the real defense is create_review's
    try/except asyncpg.UniqueViolationError. Forcing get_by_booking to always
    report "no review yet" makes the route rely entirely on create_review's
    race handling for the second call — it must come back as a clean 409
    already_reviewed, not an unhandled 500."""
    client, coach_token = logged_in_client
    coach_id, slot = _list_coach_with_slot(client, coach_token)

    athlete_token = login_as(891006, first_name="Athlete")
    athlete_headers = {"Authorization": f"Bearer {athlete_token}"}
    booking = client.post(
        "/api/bookings",
        headers=athlete_headers,
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "online"},
    ).json()

    import app.repositories.bookings as bookings_module
    import app.repositories.coach_reviews as coach_reviews_module

    async def fake_get_by_booking_never_reviewed(conn, booking_id):
        return None

    monkeypatch.setattr(bookings_module, "is_completed", lambda booking: True)
    monkeypatch.setattr(coach_reviews_module, "get_by_booking", fake_get_by_booking_never_reviewed)

    first = client.post(f"/api/bookings/{booking['id']}/reviews", headers=athlete_headers, json={"rating": 4, "text": None})
    assert first.status_code == 200, first.text

    second = client.post(f"/api/bookings/{booking['id']}/reviews", headers=athlete_headers, json={"rating": 2, "text": None})
    assert second.status_code == 409, second.text
    assert second.json()["error"]["code"] == "already_reviewed"
