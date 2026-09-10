from __future__ import annotations

from datetime import date, timedelta

from tests.test_teams_api import _create_coach_profile
from tests.test_coach_marketplace_api import _settings_payload


def _list_coach_with_slot(client, coach_token) -> tuple[str, str]:
    """Returns (coach_user_id, iso datetime of the first open slot)."""
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token, sport="Теннис")
    # Availability must be set before is_listed=True is accepted.
    client.put(
        "/api/coaches/me/availability",
        headers=coach_headers,
        json=[{"weekday": 0, "start_time": "10:00:00", "end_time": "12:00:00"}],
    )
    client.put("/api/coaches/me/marketplace-settings", headers=coach_headers, json=_settings_payload())
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


def test_athlete_booking_creates_pending_request_with_no_training_yet(logged_in_client, login_as) -> None:
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
    assert booking["status"] == "pending"
    assert booking["training_id"] is None
    assert booking["is_completed"] is False

    mine = client.get("/api/bookings/me", headers=athlete_headers).json()
    assert len(mine) == 1
    assert mine[0]["id"] == booking["id"]
    assert mine[0]["status"] == "pending"


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


def test_booked_slot_disappears_from_open_slots(logged_in_client, login_as) -> None:
    """Regression test for the naive/aware datetime bug: booking a slot must
    make it stop showing up in a subsequent open-slots lookup for the same
    date. Before starts_at was normalized to aware UTC end-to-end (schema
    validator in BookingIn) and compute_open_slots built its cursor/booked
    comparison consistently aware, a naive cursor would never equal an
    aware starts_at coming back from a real TIMESTAMPTZ column, so this
    slot would incorrectly still appear as open. Reverting either half of
    the fix (the schema normalization or the aware cursor in
    compute_open_slots / its test fake) reintroduces exactly that
    naive-vs-aware mismatch and makes this assertion fail."""
    client, coach_token = logged_in_client
    coach_id, slot = _list_coach_with_slot(client, coach_token)
    coach_headers = {"Authorization": f"Bearer {coach_token}"}

    athlete_token = login_as(890005, first_name="Athlete")
    booking_resp = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {athlete_token}"},
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "online"},
    )
    assert booking_resp.status_code == 200, booking_resp.text

    today = date.today()
    days_until_monday = (7 - today.weekday()) % 7
    next_monday = today + timedelta(days=days_until_monday or 7)
    slots_after = client.get(
        f"/api/coaches/{coach_id}/slots",
        params={"from_date": next_monday.isoformat(), "to_date": next_monday.isoformat()},
        headers=coach_headers,
    ).json()
    assert slot not in {s["starts_at"] for s in slots_after}


def test_double_booking_rejected_across_different_utc_offsets(logged_in_client, login_as) -> None:
    """Direct reproduction of critical finding #1: the same instant
    expressed with two different UTC offsets must not defeat the
    double-booking guard. `slot` (as returned by the open-slots endpoint)
    is UTC; requesting it again with an explicit +00:00 offset is the same
    instant and must collide with the first booking."""
    client, coach_token = logged_in_client
    coach_id, slot = _list_coach_with_slot(client, coach_token)
    assert slot.endswith("Z")
    same_instant_with_explicit_offset = slot[:-1] + "+00:00"

    first_token = login_as(890006, first_name="First")
    second_token = login_as(890007, first_name="Second")

    ok = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {first_token}"},
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "online"},
    )
    assert ok.status_code == 200, ok.text

    conflict = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {second_token}"},
        json={"coach_user_id": coach_id, "starts_at": same_instant_with_explicit_offset, "format": "online"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "slot_unavailable"
