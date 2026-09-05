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
