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


from datetime import date, timedelta


def _list_a_coach(client, token) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token, sport="Баскетбол")
    client.put("/api/coaches/me/marketplace-settings", headers=headers, json=_settings_payload())
    client.put(
        "/api/coaches/me/availability",
        headers=headers,
        json=[{"weekday": 0, "start_time": "10:00:00", "end_time": "12:00:00"}],
    )


def test_listed_coach_appears_in_public_list_and_profile(logged_in_client) -> None:
    client, token = logged_in_client
    _list_a_coach(client, token)
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).json()

    list_resp = client.get("/api/coaches", headers={"Authorization": f"Bearer {token}"})
    assert list_resp.status_code == 200
    assert any(c["user_id"] == me["id"] for c in list_resp.json())

    profile_resp = client.get(f"/api/coaches/{me['id']}", headers={"Authorization": f"Bearer {token}"})
    assert profile_resp.status_code == 200
    assert profile_resp.json()["sport"] == "Баскетбол"
    assert profile_resp.json()["average_rating"] is None
    assert profile_resp.json()["review_count"] == 0


def test_unlisted_coach_does_not_appear(logged_in_client) -> None:
    client, token = logged_in_client
    _create_coach_profile(client, token)

    resp = client.get("/api/coaches", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json() == []


def test_coach_list_filters_by_sport_and_price(logged_in_client, login_as) -> None:
    client, token = logged_in_client
    _list_a_coach(client, token)

    other_token = login_as(880001, first_name="Other")
    other_headers = {"Authorization": f"Bearer {other_token}"}
    _create_coach_profile(client, other_token, sport="Плавание")
    client.put(
        "/api/coaches/me/marketplace-settings",
        headers=other_headers,
        json=_settings_payload(price_per_session=5000),
    )
    client.put(
        "/api/coaches/me/availability",
        headers=other_headers,
        json=[{"weekday": 1, "start_time": "09:00:00", "end_time": "11:00:00"}],
    )

    by_sport = client.get(
        "/api/coaches", params={"sport": "Баскетбол"}, headers={"Authorization": f"Bearer {token}"}
    ).json()
    assert len(by_sport) == 1
    assert by_sport[0]["sport"] == "Баскетбол"

    by_price = client.get(
        "/api/coaches", params={"max_price": 3000}, headers={"Authorization": f"Bearer {token}"}
    ).json()
    assert all(c["price_per_session"] is None or float(c["price_per_session"]) <= 3000 for c in by_price)


def test_open_slots_computed_from_availability(logged_in_client) -> None:
    client, token = logged_in_client
    _list_a_coach(client, token)
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).json()

    today = date.today()
    days_until_monday = (7 - today.weekday()) % 7  # weekday 0 == Monday
    next_monday = today + timedelta(days=days_until_monday or 7)

    resp = client.get(
        f"/api/coaches/{me['id']}/slots",
        params={"from_date": next_monday.isoformat(), "to_date": next_monday.isoformat()},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json() == [
        {"starts_at": f"{next_monday.isoformat()}T10:00:00", "duration_minutes": 60},
        {"starts_at": f"{next_monday.isoformat()}T11:00:00", "duration_minutes": 60},
    ]
