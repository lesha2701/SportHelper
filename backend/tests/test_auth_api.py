from __future__ import annotations

from uuid import UUID

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


def _confirm_in_bot(token: str, user_id: str) -> bool:
    """Stands in for the bot's "Подтвердить вход" tap (bot/handlers/start.py)."""
    import asyncio

    from app.repositories import login_tokens

    return asyncio.run(login_tokens.confirm(None, token, UUID(user_id)))


def test_browser_login_start_returns_bot_link(client: TestClient) -> None:
    response = client.post("/api/auth/browser/start")

    assert response.status_code == 200
    body = response.json()
    assert body["bot_url"] == f"https://t.me/TestFlowBot?start=login_{body['token']}"
    assert body["expires_in"] > 0


def test_browser_login_pending_until_confirmed_then_returns_session_once(client: TestClient) -> None:
    init_data = build_init_data(BOT_TOKEN, user_id=901, first_name="Web", username="webuser")
    user = client.post("/api/auth/telegram", json={"init_data": init_data}).json()["user"]
    token = client.post("/api/auth/browser/start").json()["token"]

    assert client.post("/api/auth/browser/poll", json={"token": token}).json() == {
        "status": "pending",
        "auth": None,
    }

    assert _confirm_in_bot(token, user["id"]) is True
    done = client.post("/api/auth/browser/poll", json={"token": token}).json()
    assert done["status"] == "ok"
    assert done["auth"]["user"]["telegram_id"] == 901
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {done['auth']['access_token']}"})
    assert me.status_code == 200

    # single-use: replaying the same token yields nothing
    assert client.post("/api/auth/browser/poll", json={"token": token}).json()["status"] == "expired"


def test_browser_login_unknown_token_is_expired(client: TestClient) -> None:
    response = client.post("/api/auth/browser/poll", json={"token": "nope"})

    assert response.json()["status"] == "expired"


def test_browser_login_token_cannot_be_confirmed_twice(client: TestClient) -> None:
    a = client.post("/api/auth/telegram", json={"init_data": build_init_data(BOT_TOKEN, user_id=902)}).json()["user"]
    b = client.post("/api/auth/telegram", json={"init_data": build_init_data(BOT_TOKEN, user_id=903)}).json()["user"]
    token = client.post("/api/auth/browser/start").json()["token"]

    assert _confirm_in_bot(token, a["id"]) is True
    assert _confirm_in_bot(token, b["id"]) is False
