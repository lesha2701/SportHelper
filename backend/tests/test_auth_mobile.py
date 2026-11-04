"""Sign-in for the native app: POST /api/auth/mobile/login returns a Bearer session token."""
from __future__ import annotations

from app.config import get_settings
from tests.auth_helpers import PASSWORD, sign_up


def _set_env(monkeypatch, **env) -> None:
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()


def _mobile_login(client, email: str = "alice@example.com", password: str = PASSWORD):
    return client.post("/api/auth/mobile/login", json={"email": email, "password": password})


def test_mobile_login_is_off_by_default(client) -> None:
    sign_up(client)

    assert _mobile_login(client).status_code == 404


def test_mobile_login_returns_a_token_and_no_cookie(client, monkeypatch) -> None:
    _set_env(monkeypatch, MOBILE_AUTH_ENABLED="true")
    sign_up(client)
    client.cookies.clear()

    resp = _mobile_login(client)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["email"] == "alice@example.com"
    assert body["access_token"] and body["expires_at"]
    assert "csrf_token" not in body and "password_hash" not in resp.text
    assert "set-cookie" not in resp.headers


def test_the_mobile_token_authenticates_writes_without_csrf(client, monkeypatch) -> None:
    _set_env(monkeypatch, MOBILE_AUTH_ENABLED="true")
    sign_up(client)
    client.cookies.clear()
    token = _mobile_login(client).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    assert client.get("/api/auth/me", headers=headers).status_code == 200
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    # Logging out revokes the session: the token is dead afterwards.
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_the_mobile_token_works_when_the_general_bearer_flag_is_off(client, monkeypatch) -> None:
    _set_env(monkeypatch, MOBILE_AUTH_ENABLED="true", BEARER_AUTH_ENABLED="false")
    sign_up(client)
    client.cookies.clear()
    token = _mobile_login(client).json()["access_token"]

    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_bearer_stays_ignored_when_both_flags_are_off(client, monkeypatch) -> None:
    _set_env(monkeypatch, MOBILE_AUTH_ENABLED="true")
    sign_up(client)
    client.cookies.clear()
    token = _mobile_login(client).json()["access_token"]
    _set_env(monkeypatch, MOBILE_AUTH_ENABLED="false", BEARER_AUTH_ENABLED="false")

    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_mobile_login_rejects_a_wrong_password_and_an_unknown_email(client, monkeypatch) -> None:
    _set_env(monkeypatch, MOBILE_AUTH_ENABLED="true")
    sign_up(client)

    wrong = _mobile_login(client, password="not the password at all")
    unknown = _mobile_login(client, email="nobody@example.com")

    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["error"]["code"] == "invalid_credentials"
    assert "access_token" not in wrong.text


def test_mobile_login_requires_a_confirmed_email(client, monkeypatch) -> None:
    from tests.auth_helpers import register

    _set_env(monkeypatch, MOBILE_AUTH_ENABLED="true")
    assert register(client).status_code == 201

    resp = _mobile_login(client)

    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "email_not_verified"


def test_mobile_login_locks_the_account_like_the_site_login(client, monkeypatch) -> None:
    _set_env(monkeypatch, MOBILE_AUTH_ENABLED="true", LOGIN_MAX_FAILURES="3")
    sign_up(client)

    for _ in range(3):
        _mobile_login(client, password="wrong password here")
    resp = _mobile_login(client)

    assert resp.status_code == 429
    assert resp.json()["error"]["code"] == "account_locked"


def test_the_mobile_session_is_listed_and_can_be_revoked(client, monkeypatch) -> None:
    _set_env(monkeypatch, MOBILE_AUTH_ENABLED="true")
    sign_up(client)
    client.cookies.clear()
    token = _mobile_login(client).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    sessions = client.get("/api/auth/sessions", headers=headers).json()

    assert any(s["current"] for s in sessions)
    assert token not in str(sessions)
