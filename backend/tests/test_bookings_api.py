from __future__ import annotations

from datetime import date, timedelta

from tests.test_teams_api import _create_coach_profile
from tests.test_coach_marketplace_api import _settings_payload


def _list_coach_with_slot(client, coach_token) -> tuple[str, str]:
    """Returns (coach_user_id, iso datetime of the first open slot)."""
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token, sport="Теннис")
    client.put("/api/coaches/me/marketplace-settings", headers=coach_headers, json=_settings_payload())
    client.put(
        "/api/coaches/me/availability",
        headers=coach_headers,
        json=[{"weekday": 0, "start_time": "10:00:00", "end_time": "12:00:00"}],
    )
    coach_id = client.get("/api/auth/me", headers=coach_headers).json()["id"]

    today = date.today()
    days_until_monday = (7 - today.weekday()) % 7
    next_monday = today + timedelta(days=days_until_monday or 7)
    slots = client.get(
        f"/api/coaches/{coach_id}/slots",
        params={"from_date": next_monday.isoformat(), "to_date": next_monday.isoformat()},
        headers=coach_headers,
    ).json()
    return coach_id, slots[0]["starts_at"]


def test_athlete_can_book_open_slot_and_it_appears_in_calendar(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_id, slot = _list_coach_with_slot(client, coach_token)

    athlete_token = login_as(890001, first_name="Athlete")
    athlete_headers = {"Authorization": f"Bearer {athlete_token}"}

    resp = client.post(
        "/api/bookings",
        headers=athlete_headers,
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "online"},
    )
    assert resp.status_code == 200, resp.text
    booking = resp.json()
    assert booking["status"] == "confirmed"
    assert booking["is_completed"] is False

    training_resp = client.get(f"/api/trainings/{booking['training_id']}", headers=athlete_headers)
    assert training_resp.status_code == 200
    assert training_resp.json()["type"] == "personal"

    mine = client.get("/api/bookings/me", headers=athlete_headers).json()
    assert len(mine) == 1
    assert mine[0]["id"] == booking["id"]


def test_double_booking_same_slot_rejected(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_id, slot = _list_coach_with_slot(client, coach_token)

    first_token = login_as(890002, first_name="First")
    second_token = login_as(890003, first_name="Second")

    ok = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {first_token}"},
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "online"},
    )
    assert ok.status_code == 200

    conflict = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {second_token}"},
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "online"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "slot_unavailable"


def test_cannot_book_format_coach_does_not_offer(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_id, slot = _list_coach_with_slot(client, coach_token)  # offers_online only, per _settings_payload default

    athlete_token = login_as(890004, first_name="Athlete")
    resp = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {athlete_token}"},
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "offline"},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "format_not_offered"


def test_coach_cannot_book_themselves(logged_in_client) -> None:
    client, coach_token = logged_in_client
    coach_id, slot = _list_coach_with_slot(client, coach_token)

    resp = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "online"},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "self_booking"
