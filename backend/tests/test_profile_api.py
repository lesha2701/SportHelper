from __future__ import annotations

from fastapi.testclient import TestClient


def test_profile_me_is_empty_before_any_profile_created(logged_in_client) -> None:
    client, token = logged_in_client

    response = client.get("/api/profile/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    body = response.json()
    assert body == {"active_mode": None, "player": None, "coach": None}


def test_creating_player_profile_auto_activates_player_mode(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}

    response = client.put(
        "/api/profile/player",
        headers=headers,
        json={
            "full_name": "Иван Иванов",
            "age": 22,
            "height_cm": 180,
            "weight_kg": 75.5,
            "sport": "футбол",
            "position": "нападающий",
            "level": "amateur",
            "goals": "набрать форму",
            "load_restrictions": None,
        },
    )
    assert response.status_code == 200
    assert response.json()["full_name"] == "Иван Иванов"

    me = client.get("/api/auth/me", headers=headers).json()
    assert me["active_mode"] == "player"


def test_creating_second_profile_does_not_change_active_mode(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}

    client.put(
        "/api/profile/player",
        headers=headers,
        json={"full_name": "Игрок", "sport": "баскетбол"},
    )
    client.put(
        "/api/profile/coach",
        headers=headers,
        json={"full_name": "Тренер", "sport": "баскетбол", "experience_years": 5},
    )

    me = client.get("/api/auth/me", headers=headers).json()
    assert me["active_mode"] == "player"

    profile_me = client.get("/api/profile/me", headers=headers).json()
    assert profile_me["player"]["sport"] == "баскетбол"
    assert profile_me["coach"]["sport"] == "баскетбол"


def test_switch_active_mode_requires_existing_profile(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}

    response = client.post("/api/profile/active-mode", headers=headers, json={"mode": "coach"})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "profile_required"


def test_switch_active_mode_succeeds_when_profile_exists(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}

    client.put("/api/profile/coach", headers=headers, json={"full_name": "Тренер", "sport": "хоккей"})

    response = client.post("/api/profile/active-mode", headers=headers, json={"mode": "coach"})

    assert response.status_code == 200
    assert response.json()["active_mode"] == "coach"


def test_player_profile_rejects_out_of_range_age(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}

    response = client.put(
        "/api/profile/player",
        headers=headers,
        json={"full_name": "Игрок", "sport": "волейбол", "age": 200},
    )

    assert response.status_code == 422
