from __future__ import annotations

from tests.test_teams_api import _create_coach_profile


def _settings_payload(**overrides):
    payload = {
        "is_listed": True,
        "price_per_session": 2000,
        "currency": "RUB",
        "offers_online": True,
        "offers_offline": False,
        "location": "Москва",
        "session_duration_minutes": 60,
    }
    payload.update(overrides)
    return payload


def test_coach_can_set_and_read_marketplace_settings(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)

    put_resp = client.put("/api/coaches/me/marketplace-settings", headers=headers, json=_settings_payload())
    assert put_resp.status_code == 200, put_resp.text
    assert put_resp.json()["is_listed"] is True
    assert put_resp.json()["price_per_session"] == 2000

    get_resp = client.get("/api/coaches/me/marketplace-settings", headers=headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["location"] == "Москва"


def test_cannot_list_without_price_or_format(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)

    resp = client.put(
        "/api/coaches/me/marketplace-settings",
        headers=headers,
        json=_settings_payload(price_per_session=None),
    )
    assert resp.status_code == 422


def test_marketplace_settings_require_coach_profile_first(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.put("/api/coaches/me/marketplace-settings", headers=headers, json=_settings_payload())
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "coach_profile_required"


def test_coach_can_replace_weekly_availability(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)

    resp = client.put(
        "/api/coaches/me/availability",
        headers=headers,
        json=[
            {"weekday": 0, "start_time": "10:00:00", "end_time": "12:00:00"},
            {"weekday": 2, "start_time": "14:00:00", "end_time": "16:00:00"},
        ],
    )
    assert resp.status_code == 200, resp.text
    assert len(resp.json()) == 2

    get_resp = client.get("/api/coaches/me/availability", headers=headers)
    assert get_resp.status_code == 200
    assert {w["weekday"] for w in get_resp.json()} == {0, 2}


def test_overlapping_availability_windows_rejected(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)

    resp = client.put(
        "/api/coaches/me/availability",
        headers=headers,
        json=[
            {"weekday": 0, "start_time": "10:00:00", "end_time": "12:00:00"},
            {"weekday": 0, "start_time": "11:00:00", "end_time": "13:00:00"},
        ],
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "overlapping_availability"
