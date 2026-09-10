from __future__ import annotations

from tests.test_bookings_api import _list_coach_with_slot


def _create_pending_booking(client, coach_token, login_as, telegram_id=890101):
    coach_id, slot = _list_coach_with_slot(client, coach_token)
    athlete_token = login_as(telegram_id, first_name="Athlete")
    resp = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {athlete_token}"},
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "online"},
    )
    assert resp.status_code == 200, resp.text
    return coach_id, athlete_token, resp.json()


def test_coach_sees_pending_request_in_inbox(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as)

    pending = client.get("/api/bookings/coach/pending", headers={"Authorization": f"Bearer {coach_token}"}).json()
    assert len(pending) == 1
    assert pending[0]["id"] == booking["id"]
    assert pending[0]["athlete_full_name"] == "Athlete"


def test_coach_confirms_booking_creates_training_and_notifies_athlete(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as)

    resp = client.post(
        f"/api/bookings/{booking['id']}/confirm",
        headers={"Authorization": f"Bearer {coach_token}"},
    )
    assert resp.status_code == 200, resp.text
    confirmed = resp.json()
    assert confirmed["status"] == "confirmed"
    assert confirmed["training_id"] is not None

    training_resp = client.get(
        f"/api/trainings/{confirmed['training_id']}", headers={"Authorization": f"Bearer {athlete_token}"}
    )
    assert training_resp.status_code == 200
    assert training_resp.json()["type"] == "personal"

    # Confirming removes it from the coach's pending inbox.
    pending = client.get("/api/bookings/coach/pending", headers={"Authorization": f"Bearer {coach_token}"}).json()
    assert pending == []


def test_coach_declines_booking_frees_the_slot(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as)

    resp = client.post(
        f"/api/bookings/{booking['id']}/decline",
        headers={"Authorization": f"Bearer {coach_token}"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "declined"

    # The slot is bookable again by someone else.
    other_athlete_token = login_as(890102, first_name="Other")
    retry = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {other_athlete_token}"},
        json={"coach_user_id": coach_id, "starts_at": booking["starts_at"], "format": "online"},
    )
    assert retry.status_code == 200, retry.text
    assert retry.json()["status"] == "pending"


def test_confirm_rejects_wrong_coach(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as)

    other_coach_token = login_as(890103, first_name="OtherCoach")
    resp = client.post(
        f"/api/bookings/{booking['id']}/confirm",
        headers={"Authorization": f"Bearer {other_coach_token}"},
    )
    assert resp.status_code == 403


def test_confirm_twice_is_rejected(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as)

    headers = {"Authorization": f"Bearer {coach_token}"}
    first = client.post(f"/api/bookings/{booking['id']}/confirm", headers=headers)
    assert first.status_code == 200

    second = client.post(f"/api/bookings/{booking['id']}/confirm", headers=headers)
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "booking_not_pending"
