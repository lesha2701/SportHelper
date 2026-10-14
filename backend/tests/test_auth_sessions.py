from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.config import get_settings
from tests.auth_helpers import OTHER_PASSWORD, PASSWORD, csrf_headers, login, register, sign_in, sign_up


def _set_env(monkeypatch, **env) -> None:
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()


# --- login -----------------------------------------------------------------


def test_login_sets_an_httponly_session_cookie_and_returns_the_user(client) -> None:
    sign_up(client)

    resp = login(client)

    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == "alice@example.com" and body["email_verified"] is True
    assert body["csrf_token"]
    assert "password_hash" not in resp.text and PASSWORD not in resp.text
    cookie = resp.headers["set-cookie"]
    assert cookie.startswith("sag_session=")
    assert "HttpOnly" in cookie and "Path=/" in cookie and "SameSite=lax" in cookie
    assert "Secure" not in cookie  # plain http in dev
    assert "Max-Age=2592000" in cookie  # 30 days: a limited lifetime


def test_cookie_is_secure_and_host_prefixed_in_production(client, monkeypatch) -> None:
    _set_env(monkeypatch, COOKIE_SECURE="true")
    sign_up(client)

    cookie = login(client).headers["set-cookie"]

    assert cookie.startswith("__Host-sag_session=")
    assert "Secure" in cookie and "HttpOnly" in cookie and "Domain" not in cookie


def test_cookies_are_secure_by_default_when_the_site_is_https(client, monkeypatch) -> None:
    _set_env(monkeypatch, APP_BASE_URL="https://sportarenaglobal.ru")
    monkeypatch.delenv("COOKIE_SECURE", raising=False)
    sign_up(client)

    cookie = login(client).headers["set-cookie"]

    assert cookie.startswith("__Host-sag_session=") and "Secure" in cookie


def test_an_explicit_cookie_setting_wins_over_the_guess(client, monkeypatch) -> None:
    _set_env(monkeypatch, APP_BASE_URL="https://sportarenaglobal.ru", COOKIE_SECURE="false")
    sign_up(client)

    assert "Secure" not in login(client).headers["set-cookie"]


def test_session_cookie_value_is_not_stored_in_the_database(client) -> None:
    sign_up(client)
    login(client)
    raw = client.cookies.get("sag_session")

    assert raw and all(raw not in row["token_hash"] for row in client.auth_store.sessions.values())


def test_session_survives_between_visits_and_me_reports_the_user(client) -> None:
    sign_up(client)
    login(client)

    me = client.get("/api/auth/me")

    assert me.status_code == 200
    assert me.json()["email"] == "alice@example.com"


def test_wrong_password_and_unknown_email_look_identical(client) -> None:
    sign_up(client)

    wrong = login(client, password="not the password!!")
    unknown = login(client, email="nobody@example.com")

    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()
    assert wrong.json()["error"]["code"] == "invalid_credentials"
    assert "set-cookie" not in wrong.headers


def test_unverified_account_cannot_log_in_but_gets_a_clear_reason(client) -> None:
    register(client)

    resp = login(client)

    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "email_not_verified"
    assert "set-cookie" not in resp.headers
    # A wrong password on an unverified account must not reveal that it is unverified.
    assert login(client, password="a wrong password!!").json()["error"]["code"] == "invalid_credentials"


def test_banned_user_cannot_log_in_or_use_an_existing_session(client) -> None:
    sign_up(client)
    login(client)
    client.auth_store.find_by_email("alice@example.com")["is_banned"] = True

    assert client.get("/api/auth/me").status_code == 403
    client.cookies.clear()
    assert login(client).status_code == 403


def test_account_locks_after_repeated_failures_even_for_the_right_password(client) -> None:
    sign_up(client)
    for _ in range(4):
        assert login(client, password="wrong wrong wrong").status_code == 401

    fifth = login(client, password="wrong wrong wrong")
    assert fifth.status_code == 429 and fifth.json()["error"]["code"] == "account_locked"
    assert int(fifth.headers["Retry-After"]) > 0

    locked = login(client)  # the correct password, but the account is locked
    assert locked.status_code == 429 and "set-cookie" not in locked.headers


def test_lock_expires_and_a_successful_login_resets_the_counter(client) -> None:
    sign_up(client)
    for _ in range(5):
        login(client, password="wrong wrong wrong")
    user = client.auth_store.find_by_email("alice@example.com")
    user["locked_until"] = datetime.now(timezone.utc) - timedelta(seconds=1)

    assert login(client).status_code == 200
    assert user["failed_login_count"] == 0 and user["locked_until"] is None


def test_login_requests_are_rate_limited_per_ip(client, monkeypatch) -> None:
    _set_env(monkeypatch, AUTH_RATE_LIMIT_ENABLED="true")

    codes = [login(client, email=f"user{i}@example.com").status_code for i in range(32)]

    assert codes[:30] == [401] * 30
    assert codes[30:] == [429, 429]


def test_login_is_rate_limited_per_target_email_regardless_of_ip(client, monkeypatch) -> None:
    _set_env(monkeypatch, AUTH_RATE_LIMIT_ENABLED="true", TRUST_PROXY_HEADERS="true")

    def attempt(n: int):
        return client.post(
            "/api/auth/login",
            json={"email": "victim@example.com", "password": "guess number %d" % n},
            headers={"X-Forwarded-For": f"203.0.113.{n}"},  # a different IP every time
        )

    codes = [attempt(n).status_code for n in range(12)]

    assert codes[:10] == [401] * 10
    assert codes[10:] == [429, 429]


def test_unverified_login_attempt_does_not_leak_through_rate_limit_messages(client) -> None:
    register(client)

    assert login(client, email="alice@example.com").json()["error"]["code"] == "email_not_verified"


# --- logout & session management ------------------------------------------------


def test_logout_revokes_the_session_and_clears_the_cookie(client) -> None:
    info = sign_in(client)

    resp = client.post("/api/auth/logout", headers=csrf_headers(info["csrf"]))

    assert resp.status_code == 200
    assert "sag_session=" in resp.headers["set-cookie"] and "Max-Age=0" in resp.headers["set-cookie"]
    assert all(row["revoked_at"] is not None for row in client.auth_store.sessions.values())
    assert client.get("/api/auth/me").status_code == 401


def test_logout_without_a_session_is_harmless(client) -> None:
    resp = client.post("/api/auth/logout")

    assert resp.status_code == 200


def test_the_revoked_session_token_cannot_be_used_again(client) -> None:
    info = sign_in(client)
    stolen = client.cookies.get("sag_session")
    client.post("/api/auth/logout", headers=csrf_headers(info["csrf"]))
    client.cookies.clear()

    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {stolen}"}).status_code == 401
    client.cookies.set("sag_session", stolen)
    assert client.get("/api/auth/me").status_code == 401


def test_expired_session_is_refused(client) -> None:
    sign_in(client)
    for row in client.auth_store.sessions.values():
        row["expires_at"] = datetime.now(timezone.utc) - timedelta(seconds=1)

    assert client.get("/api/auth/me").status_code == 401


def test_sessions_are_listed_with_the_current_one_marked(client) -> None:
    info = sign_in(client)
    other = login(client)  # a second login = a second session (second device)
    assert other.status_code == 200

    sessions = client.get("/api/auth/sessions").json()

    assert len(sessions) == 2
    assert sum(s["current"] for s in sessions) == 1
    assert all({"id", "device", "ip_address", "created_at", "last_seen_at", "current"} <= s.keys() for s in sessions)
    assert info["user"]["email"] == "alice@example.com"


def test_a_single_session_can_be_revoked_without_ending_the_others(client) -> None:
    info = sign_in(client)
    first_cookie = client.cookies.get("sag_session")
    second = login(client)
    second_cookie = client.cookies.get("sag_session")
    assert first_cookie != second_cookie

    sessions = client.get("/api/auth/sessions").json()
    first_id = next(s["id"] for s in sessions if not s["current"])
    resp = client.delete(f"/api/auth/sessions/{first_id}", headers=csrf_headers(second.json()["csrf_token"]))

    assert resp.status_code == 200
    assert client.get("/api/auth/me").status_code == 200  # the second is still alive
    client.cookies.clear()
    client.cookies.set("sag_session", first_cookie)
    assert client.get("/api/auth/me").status_code == 401  # the first is gone
    assert info["csrf"] != second.json()["csrf_token"]  # CSRF tokens are per session


def test_revoking_the_current_session_clears_the_cookie(client) -> None:
    info = sign_in(client)
    current = next(s["id"] for s in client.get("/api/auth/sessions").json() if s["current"])

    resp = client.delete(f"/api/auth/sessions/{current}", headers=csrf_headers(info["csrf"]))

    assert resp.status_code == 200 and "Max-Age=0" in resp.headers["set-cookie"]


def test_a_user_cannot_see_or_revoke_another_users_sessions(client, login_as) -> None:
    victim_token = login_as(1001)
    victim_session = next(iter(client.auth_store.sessions.values()))
    info = sign_in(client)  # a different user, signed in with a cookie

    listed = client.get("/api/auth/sessions").json()
    resp = client.delete(f"/api/auth/sessions/{victim_session['id']}", headers=csrf_headers(info["csrf"]))

    assert all(s["id"] != str(victim_session["id"]) for s in listed)
    assert resp.status_code == 404
    assert victim_session["revoked_at"] is None
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {victim_token}"}).status_code == 200


def test_logout_all_ends_every_session_including_this_one(client) -> None:
    sign_in(client)
    first_cookie = client.cookies.get("sag_session")
    second = login(client)  # the cookie jar now holds the second session
    assert client.cookies.get("sag_session") != first_cookie

    resp = client.post("/api/auth/logout-all", headers=csrf_headers(second.json()["csrf_token"]))

    assert resp.status_code == 200
    assert all(row["revoked_at"] is not None for row in client.auth_store.sessions.values())
    client.cookies.clear()
    client.cookies.set("sag_session", first_cookie)
    assert client.get("/api/auth/me").status_code == 401


# --- CSRF ------------------------------------------------------------------------


def test_state_changing_cookie_requests_need_the_csrf_token(client) -> None:
    info = sign_in(client)
    body = {"mode": "player"}

    missing = client.post("/api/profile/active-mode", json=body)
    wrong = client.post("/api/profile/active-mode", json=body, headers=csrf_headers("0" * 64))
    other_session_token = client.post("/api/profile/active-mode", json=body, headers=csrf_headers(info["csrf"][::-1]))

    for resp in (missing, wrong, other_session_token):
        assert resp.status_code == 403 and resp.json()["error"]["code"] == "csrf_failed"


def test_a_valid_csrf_token_lets_the_request_through(client) -> None:
    info = sign_in(client)

    resp = client.post("/api/profile/active-mode", json={"mode": "player"}, headers=csrf_headers(info["csrf"]))

    assert resp.status_code == 409  # got past CSRF and auth; "create the profile first"
    assert resp.json()["error"]["code"] == "profile_required"


def test_safe_requests_do_not_need_a_csrf_token(client) -> None:
    sign_in(client)

    assert client.get("/api/profile/me").status_code == 200


def test_csrf_token_of_one_session_does_not_work_for_another(client) -> None:
    first = sign_in(client)
    client.cookies.clear()
    second = login(client)
    assert first["csrf"] != second.json()["csrf_token"]

    resp = client.post("/api/profile/active-mode", json={"mode": "player"}, headers=csrf_headers(first["csrf"]))

    assert resp.status_code == 403


def test_bearer_clients_are_not_subject_to_csrf(client, login_as) -> None:
    token = login_as(1002)
    client.cookies.clear()

    resp = client.post("/api/profile/active-mode", json={"mode": "player"}, headers={"Authorization": f"Bearer {token}"})

    assert resp.status_code == 409 and resp.json()["error"]["code"] == "profile_required"


def test_foreign_origin_is_rejected_even_before_authentication(client) -> None:
    resp = client.post("/api/auth/login", json={"email": "a@b.co", "password": "x"}, headers={"Origin": "https://evil.example"})

    assert resp.status_code == 403 and resp.json()["error"]["code"] == "csrf_failed"


def test_own_origin_is_accepted(client) -> None:
    sign_up(client)

    resp = client.post(
        "/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD}, headers={"Origin": "http://localhost:5173"}
    )

    assert resp.status_code == 200


def test_cors_allows_credentials_only_for_configured_origins(client) -> None:
    good = client.options(
        "/api/auth/login",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
                 "Access-Control-Request-Headers": "content-type,x-csrf-token"},
    )
    bad = client.options(
        "/api/auth/login",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )

    assert good.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert good.headers["access-control-allow-credentials"] == "true"
    assert "access-control-allow-origin" not in bad.headers


def test_auth_failures_never_echo_passwords_or_tokens_in_logs(client, caplog) -> None:
    import logging

    sign_up(client)
    with caplog.at_level(logging.DEBUG):
        login(client, password="super secret wrong guess")
        client.post("/api/auth/forgot-password", json={"email": "alice@example.com"})
        client.post("/api/auth/verify-email", json={"token": "tok-1234567890"})

    log_text = "\n".join(record.getMessage() for record in caplog.records)
    assert "super secret wrong guess" not in log_text and PASSWORD not in log_text
    assert "tok-1234567890" not in log_text
    reset_mail = [m for m in client.outbox if "восстановлен" in m.subject.lower()][-1]
    assert reset_mail.text.split("token=")[1].split()[0] not in log_text


def test_other_tests_can_still_use_a_different_password_helper() -> None:
    assert OTHER_PASSWORD != PASSWORD
