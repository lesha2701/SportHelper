"""Website administration: who may call what, and that two-factor is really
checked in the CURRENT session (not merely 'configured')."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.routing import APIRoute

from app.api.deps import require_admin, require_admin_mfa
from app.config import get_settings
from app.security import totp
from tests.auth_helpers import PASSWORD, csrf_headers, login, sign_in, sign_up

ADMIN = "boss@example.com"


@pytest.fixture
def admin_env(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", ADMIN)
    get_settings.cache_clear()


def _code(secret: str, offset: int = 0) -> str:
    return totp._hotp(secret, totp.current_step() + offset)


def _enable_mfa(client, csrf: str) -> tuple[str, list[str]]:
    secret = client.post("/api/auth/mfa/setup", headers=csrf_headers(csrf)).json()["secret"]
    codes = client.post("/api/auth/mfa/enable", headers=csrf_headers(csrf), json={"code": _code(secret)}).json()["recovery_codes"]
    return secret, codes


def _signed_in_admin(client):
    return sign_in(client, email=ADMIN)


def _victim(client):
    return client.auth_store.new_user(email="victim@fixtures.example.com", email_verified_at=datetime.now(timezone.utc),
                                      password_hash="x", first_name="Жертва")


# --- structure: every admin route is guarded by a role dependency --------------------------------


def _dependency_calls(dependant) -> set:
    calls = {dependant.call}
    for sub in dependant.dependencies:
        calls |= _dependency_calls(sub)
    return calls


def test_every_admin_route_requires_an_admin_role_not_just_a_login(client) -> None:
    routes = [r for r in client.app.routes if isinstance(r, APIRoute) and r.path.startswith("/api/admin")]
    assert len(routes) >= 5
    for route in routes:
        calls = _dependency_calls(route.dependant)
        assert require_admin in calls or require_admin_mfa in calls, f"{route.path} is not role-protected"


def test_everything_that_shows_personal_data_or_changes_accounts_needs_the_second_factor(client) -> None:
    sensitive = {"/api/admin/users", "/api/admin/users/{user_id}/ban", "/api/admin/users/{user_id}/unban", "/api/admin/audit"}
    seen = set()
    for route in client.app.routes:
        if isinstance(route, APIRoute) and route.path in sensitive:
            seen.add(route.path)
            assert require_admin_mfa in _dependency_calls(route.dependant), route.path
    assert seen == sensitive


# --- the role --------------------------------------------------------------------------------------


def test_anonymous_and_ordinary_users_cannot_reach_admin_routes(client, admin_env) -> None:
    assert client.get("/api/admin/overview").status_code == 401
    sign_in(client)  # alice@example.com is not an administrator

    for path in ("/api/admin/overview", "/api/admin/users", "/api/admin/audit"):
        resp = client.get(path)
        assert resp.status_code == 403, path
        assert resp.json()["error"]["code"] == "forbidden"
    assert client.post(f"/api/admin/users/{_victim(client)['id']}/ban").status_code == 403


def test_admin_rights_do_not_come_from_anything_the_client_sends(client, admin_env) -> None:
    info = sign_in(client)
    headers = {**csrf_headers(info["csrf"]), "X-Admin": "true", "X-Roles": "admin"}

    assert client.get("/api/admin/overview", headers=headers, params={"admin": "true", "is_admin": "1"}).status_code == 403
    # Registering the administrator's address grants nothing: it stays unverified (the
    # attacker can't read that mailbox), and an unverified account can't even sign in.
    client.cookies.clear()
    assert client.post("/api/auth/register", json={"first_name": "x", "email": ADMIN, "password": PASSWORD,
                                                    "password_confirm": PASSWORD, "accept_terms": True}).status_code == 201
    assert login(client, email=ADMIN).status_code == 403
    assert client.get("/api/admin/overview").status_code == 401


def test_an_administrator_without_two_factor_sees_aggregates_only(client, admin_env) -> None:
    _signed_in_admin(client)

    overview = client.get("/api/admin/overview")
    users = client.get("/api/admin/users")

    assert overview.status_code == 200 and "email" not in overview.text
    assert users.status_code == 403 and users.json()["error"]["code"] == "mfa_setup_required"


# --- the second factor is per SESSION --------------------------------------------------------------


def test_configured_two_factor_is_not_proof_that_it_was_passed_in_this_session(client, admin_env) -> None:
    info = _signed_in_admin(client)
    _enable_mfa(client, info["csrf"])
    assert client.get("/api/admin/users").status_code == 200  # enabling it proved possession in this session

    client.cookies.clear()  # a different browser / a stolen password
    fresh = login(client, email=ADMIN)
    assert fresh.status_code == 200
    blocked = client.get("/api/admin/users")

    assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "mfa_required"
    assert client.post(f"/api/admin/users/{_victim(client)['id']}/ban", headers=csrf_headers(fresh.json()["csrf_token"])).status_code == 403
    assert client.get("/api/admin/audit").status_code == 403
    # ...while the non-personal overview is still available.
    assert client.get("/api/admin/overview").status_code == 200


def test_passing_the_code_unlocks_only_that_session(client, admin_env) -> None:
    info = _signed_in_admin(client)
    secret, _ = _enable_mfa(client, info["csrf"])
    first_cookie = client.cookies.get("sag_session")
    client.cookies.clear()
    second = login(client, email=ADMIN).json()
    second_cookie = client.cookies.get("sag_session")

    ok = client.post("/api/auth/mfa/verify", headers=csrf_headers(second["csrf_token"]), json={"code": _code(secret, 1)})
    assert ok.status_code == 200
    assert client.get("/api/admin/users").status_code == 200

    client.cookies.clear()
    client.cookies.set("sag_session", first_cookie)
    assert client.get("/api/admin/users").status_code == 200  # the first session was verified at setup
    client.cookies.clear()
    third = login(client, email=ADMIN)
    assert third.status_code == 200 and client.cookies.get("sag_session") not in (first_cookie, second_cookie)
    assert client.get("/api/admin/users").status_code == 403  # a third session starts unverified


def test_the_verification_goes_stale(client, admin_env) -> None:
    info = _signed_in_admin(client)
    _enable_mfa(client, info["csrf"])
    assert client.get("/api/admin/audit").status_code == 200

    for row in client.auth_store.sessions.values():
        row["mfa_verified_at"] = datetime.now(timezone.utc) - timedelta(hours=13)

    assert client.get("/api/admin/audit").json()["error"]["code"] == "mfa_required"


def test_a_recovery_code_counts_as_the_second_factor_once(client, admin_env) -> None:
    info = _signed_in_admin(client)
    _, codes = _enable_mfa(client, info["csrf"])
    client.cookies.clear()
    fresh = login(client, email=ADMIN).json()

    assert client.post("/api/auth/mfa/verify", headers=csrf_headers(fresh["csrf_token"]), json={"code": codes[0]}).status_code == 200
    assert client.get("/api/admin/users").status_code == 200
    client.cookies.clear()
    again = login(client, email=ADMIN).json()
    assert client.post("/api/auth/mfa/verify", headers=csrf_headers(again["csrf_token"]), json={"code": codes[0]}).status_code == 400


def test_a_wrong_code_gives_nothing_and_is_throttled(client, admin_env, monkeypatch) -> None:
    info = _signed_in_admin(client)
    _enable_mfa(client, info["csrf"])
    client.cookies.clear()
    fresh = login(client, email=ADMIN).json()
    monkeypatch.setenv("AUTH_RATE_LIMIT_ENABLED", "true")
    get_settings.cache_clear()

    codes = [client.post("/api/auth/mfa/verify", headers=csrf_headers(fresh["csrf_token"]), json={"code": f"{n:06d}"}).status_code
             for n in range(12)]

    assert codes[:10] == [400] * 10 and codes[10:] == [429, 429]
    assert client.get("/api/admin/users").status_code == 403


# --- what the operations do -------------------------------------------------------------------------


def test_listing_users_is_available_to_a_verified_admin_and_searchable(client, admin_env) -> None:
    info = _signed_in_admin(client)
    _enable_mfa(client, info["csrf"])
    _victim(client)

    everyone = client.get("/api/admin/users").json()
    found = client.get("/api/admin/users", params={"q": "victim"}).json()

    assert everyone["total"] == 2 and {u["email"] for u in everyone["items"]} == {ADMIN, "victim@fixtures.example.com"}
    assert [u["email"] for u in found["items"]] == ["victim@fixtures.example.com"]
    assert "password" not in client.get("/api/admin/users").text


def test_banning_ends_the_users_sessions_is_audited_and_can_be_undone(client, admin_env, login_as) -> None:
    victim_token = login_as(5001, first_name="Нарушитель")
    victim = client.auth_store.find_by_email("user5001@fixtures.example.com")
    info = _signed_in_admin(client)
    _enable_mfa(client, info["csrf"])
    headers = csrf_headers(info["csrf"])
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {victim_token}"}).status_code == 200

    banned = client.post(f"/api/admin/users/{victim['id']}/ban", headers=headers)

    assert banned.status_code == 200 and banned.json()["is_banned"] is True
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {victim_token}"}).status_code in (401, 403)
    audit = client.get("/api/admin/audit").json()
    assert audit[0]["action"] == "ban" and audit[0]["admin"] == ADMIN and audit[0]["target_id"] == str(victim["id"])

    assert client.post(f"/api/admin/users/{victim['id']}/unban", headers=headers).json()["is_banned"] is False
    assert [e["action"] for e in client.get("/api/admin/audit").json()][:2] == ["unban", "ban"]


def test_an_admin_cannot_ban_themselves_or_another_admin_or_a_stranger_id(client, admin_env, monkeypatch) -> None:
    monkeypatch.setenv("ADMIN_EMAILS", f"{ADMIN},second@example.com")
    get_settings.cache_clear()
    second = client.auth_store.new_user(email="second@example.com", email_verified_at=datetime.now(timezone.utc), password_hash="x")
    info = _signed_in_admin(client)
    _enable_mfa(client, info["csrf"])
    headers = csrf_headers(info["csrf"])
    me = client.get("/api/auth/me").json()["id"]

    assert client.post(f"/api/admin/users/{me}/ban", headers=headers).json()["error"]["code"] == "cannot_ban_self"
    assert client.post(f"/api/admin/users/{second['id']}/ban", headers=headers).json()["error"]["code"] == "cannot_ban_admin"
    assert client.post("/api/admin/users/00000000-0000-0000-0000-000000000000/ban", headers=headers).status_code == 404


def test_state_changing_admin_calls_need_csrf_with_a_cookie_session(client, admin_env) -> None:
    info = _signed_in_admin(client)
    _enable_mfa(client, info["csrf"])
    victim = _victim(client)

    forged = client.post(f"/api/admin/users/{victim['id']}/ban")  # no X-CSRF-Token, as a cross-site form would send

    assert forged.status_code == 403 and forged.json()["error"]["code"] == "csrf_failed"
    assert victim["is_banned"] is False


def test_a_banned_admin_loses_access_at_once(client, admin_env) -> None:
    info = _signed_in_admin(client)
    _enable_mfa(client, info["csrf"])
    client.auth_store.find_by_email(ADMIN)["is_banned"] = True

    assert client.get("/api/admin/overview").status_code == 403


def test_sign_up_helper_is_unused_here() -> None:
    assert sign_up is not None
