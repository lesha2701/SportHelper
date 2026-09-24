from __future__ import annotations


def test_default_preferences_are_enabled(logged_in_client) -> None:
    client, token = logged_in_client
    response = client.get("/api/notifications/preferences", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    prefs = {p["category"]: p["enabled"] for p in response.json()}
    assert prefs == {
        "training_reminder": True,
        "task_deadline": True,
        "new_training": True,
        "new_match": True,
        "new_task": True,
        "booking_requested": True,
        "booking_decided": True,
    }


def test_disable_and_reenable_category(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}

    disable_resp = client.put(
        "/api/notifications/preferences",
        headers=headers,
        json={"preferences": [{"category": "training_reminder", "enabled": False}]},
    )
    assert disable_resp.status_code == 200
    prefs = {p["category"]: p["enabled"] for p in disable_resp.json()}
    assert prefs["training_reminder"] is False
    assert prefs["task_deadline"] is True

    reenable_resp = client.put(
        "/api/notifications/preferences",
        headers=headers,
        json={"preferences": [{"category": "training_reminder", "enabled": True}]},
    )
    assert reenable_resp.status_code == 200
    prefs = {p["category"]: p["enabled"] for p in reenable_resp.json()}
    assert prefs["training_reminder"] is True


def test_preferences_are_per_user(logged_in_client, login_as) -> None:
    client, token = logged_in_client
    client.put(
        "/api/notifications/preferences",
        headers={"Authorization": f"Bearer {token}"},
        json={"preferences": [{"category": "task_deadline", "enabled": False}]},
    )

    other_token = login_as(850001, first_name="Other")
    response = client.get("/api/notifications/preferences", headers={"Authorization": f"Bearer {other_token}"})
    prefs = {p["category"]: p["enabled"] for p in response.json()}
    assert prefs["task_deadline"] is True


def _trigger_booking_requested_notification(client, login_as):
    """The simplest existing flow that produces a real, immediately-due
    notification: an athlete's booking request pings the coach."""
    from tests.test_bookings_api import _list_coach_with_slot
    from tests.test_teams_api import _create_coach_profile

    coach_token = login_as(860001, first_name="Coach")
    _create_coach_profile(client, coach_token)
    listing_id, slot = _list_coach_with_slot(client, coach_token)

    athlete_token = login_as(860002, first_name="Athlete")
    client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {athlete_token}"},
        json={"listing_id": listing_id, "starts_at": slot, "format": "online"},
    )
    return coach_token


def test_list_notifications_shows_due_items(logged_in_client, login_as) -> None:
    client, _ = logged_in_client
    coach_token = _trigger_booking_requested_notification(client, login_as)

    resp = client.get("/api/notifications", headers={"Authorization": f"Bearer {coach_token}"})
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert len(items) == 1
    assert items[0]["category"] == "booking_requested"
    assert items[0]["entity_type"] == "booking"
    assert items[0]["read_at"] is None


def test_mark_notification_read(logged_in_client, login_as) -> None:
    client, _ = logged_in_client
    coach_token = _trigger_booking_requested_notification(client, login_as)
    coach_headers = {"Authorization": f"Bearer {coach_token}"}

    notification_id = client.get("/api/notifications", headers=coach_headers).json()[0]["id"]

    resp = client.post(f"/api/notifications/{notification_id}/read", headers=coach_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["read_at"] is not None

    items = client.get("/api/notifications", headers=coach_headers).json()
    assert items[0]["read_at"] is not None


def test_mark_notification_read_is_idempotent(logged_in_client, login_as) -> None:
    client, _ = logged_in_client
    coach_token = _trigger_booking_requested_notification(client, login_as)
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    notification_id = client.get("/api/notifications", headers=coach_headers).json()[0]["id"]

    first = client.post(f"/api/notifications/{notification_id}/read", headers=coach_headers).json()
    second = client.post(f"/api/notifications/{notification_id}/read", headers=coach_headers).json()
    assert first["read_at"] == second["read_at"]


def test_cannot_mark_another_users_notification_read(logged_in_client, login_as) -> None:
    client, _ = logged_in_client
    coach_token = _trigger_booking_requested_notification(client, login_as)
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    notification_id = client.get("/api/notifications", headers=coach_headers).json()[0]["id"]

    outsider_token = login_as(860003, first_name="Outsider")
    resp = client.post(
        f"/api/notifications/{notification_id}/read", headers={"Authorization": f"Bearer {outsider_token}"}
    )
    assert resp.status_code == 404


def test_mark_all_read(logged_in_client, login_as) -> None:
    client, _ = logged_in_client
    coach_token = _trigger_booking_requested_notification(client, login_as)
    coach_headers = {"Authorization": f"Bearer {coach_token}"}

    resp = client.post("/api/notifications/read-all", headers=coach_headers)
    assert resp.status_code == 204

    items = client.get("/api/notifications", headers=coach_headers).json()
    assert all(item["read_at"] is not None for item in items)
