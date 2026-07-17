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
