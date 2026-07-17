from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import BOT_TOKEN, build_init_data


def test_login_with_valid_init_data_returns_token_and_user(client: TestClient) -> None:
    init_data = build_init_data(BOT_TOKEN, user_id=555, first_name="Petr", username="petrov")

    response = client.post("/api/auth/telegram", json={"init_data": init_data})

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["user"]["telegram_id"] == 555
    assert body["user"]["username"] == "petrov"
    assert body["user"]["active_mode"] is None


def test_login_with_invalid_signature_is_rejected(client: TestClient) -> None:
    init_data = build_init_data(BOT_TOKEN).replace("hash=", "hash=deadbeef")

    response = client.post("/api/auth/telegram", json={"init_data": init_data})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_me_endpoint_requires_bearer_token(client: TestClient) -> None:
    response = client.get("/api/auth/me")

    assert response.status_code == 401


def test_me_endpoint_returns_current_user_after_login(client: TestClient) -> None:
    init_data = build_init_data(BOT_TOKEN, user_id=777, first_name="Olga", username="olga")
    login_response = client.post("/api/auth/telegram", json={"init_data": init_data})
    token = login_response.json()["access_token"]

    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json()["telegram_id"] == 777
