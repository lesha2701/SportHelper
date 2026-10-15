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
    secret = client.post("/api/auth/mfa/setup", headers=csrf_headers(csrf), json={"password": PASSWORD}).json()["secret"]
    codes = client.post("/api/auth/mfa/enable", headers=csrf_headers(csrf), json={"code": _code(secret)}).json()["recovery_codes"]
    return secret, codes


def _signed_in_admin(client):
    return sign_in(client, email=ADMIN)


GATED = "/api/_test/admin_data"


def _mount(client) -> None:
    """A stand-in admin route behind the second factor, so the second-factor rules can be tested without a database
    (what the real routes return is covered against PostgreSQL in test_admin_users.py / test_admin_dashboard.py)."""
    from fastapi import Depends

    @client.app.get(GATED)
    async def gated(ctx=Depends(require_admin_mfa)):
        return {"ok": True}


def _victim(client):
    return client.auth_store.new_user(email="victim@fixtures.example.com", email_verified_at=datetime.now(timezone.utc),
                                      password_hash="x", first_name="Жертва")


# --- structure: every admin route is guarded by a role dependency --------------------------------


def _dependency_calls(dependant) -> set:
    calls = {dependant.call}
    for sub in dependant.dependencies:
        calls |= _dependency_calls(sub)
    return calls


# The one admin route that is allowed to answer before the second factor: it only reports what is still needed.
_PRE_MFA_ROUTES = {"/api/admin/session"}


def test_every_admin_route_requires_an_admin_role_not_just_a_login(client) -> None:
    routes = [r for r in client.app.routes if isinstance(r, APIRoute) and r.path.startswith("/api/admin")]
    assert len(routes) >= 5
    for route in routes:
        calls = _dependency_calls(route.dependant)
        assert require_admin in calls or require_admin_mfa in calls, f"{route.path} is not role-protected"


def test_every_admin_route_except_the_session_probe_needs_the_second_factor(client) -> None:
    routes = [r for r in client.app.routes if isinstance(r, APIRoute) and r.path.startswith("/api/admin")]
    assert {r.path for r in routes} >= _PRE_MFA_ROUTES
    for route in routes:
        if route.path in _PRE_MFA_ROUTES:
            continue
        assert require_admin_mfa in _dependency_calls(route.dependant), f"{route.path} can be used without the second factor"


# --- the role --------------------------------------------------------------------------------------


def test_anonymous_and_ordinary_users_cannot_reach_admin_routes(client, admin_env) -> None:
    assert client.get("/api/admin/dashboard").status_code == 401
    sign_in(client)  # alice@example.com is not an administrator

    for path in ("/api/admin/dashboard", "/api/admin/users", "/api/admin/audit"):
        resp = client.get(path)
        assert resp.status_code == 403, path
        assert resp.json()["error"]["code"] == "forbidden"
    assert client.post(f"/api/admin/users/{_victim(client)['id']}/ban").status_code == 403


def test_admin_rights_do_not_come_from_anything_the_client_sends(client, admin_env) -> None:
    info = sign_in(client)
    headers = {**csrf_headers(info["csrf"]), "X-Admin": "true", "X-Roles": "admin"}

    assert client.get("/api/admin/dashboard", headers=headers, params={"admin": "true", "is_admin": "1"}).status_code == 403
    # Registering the administrator's address grants nothing: it stays unverified (the
    # attacker can't read that mailbox), and an unverified account can't even sign in.
    client.cookies.clear()
    assert client.post("/api/auth/register", json={"first_name": "x", "email": ADMIN, "password": PASSWORD,
                                                    "password_confirm": PASSWORD, "accept_terms": True}).status_code == 201
    assert login(client, email=ADMIN).status_code == 403
    assert client.get("/api/admin/dashboard").status_code == 401


def test_an_administrator_without_two_factor_can_only_ask_what_is_missing(client, admin_env) -> None:
    _signed_in_admin(client)

    session = client.get("/api/admin/session")
    overview = client.get("/api/admin/dashboard")
    users = client.get("/api/admin/users")

    assert session.json() == {"is_admin": True, "mfa_enabled": False, "mfa_verified": False, "mfa_recent": False}
    assert overview.status_code == 403 and overview.json()["error"]["code"] == "mfa_setup_required"
    assert users.status_code == 403 and users.json()["error"]["code"] == "mfa_setup_required"


def test_the_session_probe_is_closed_to_everyone_who_is_not_an_administrator(client, admin_env) -> None:
    assert client.get("/api/admin/session").status_code == 401
    sign_in(client)

    resp = client.get("/api/admin/session")

    assert resp.status_code == 403 and "is_admin" not in resp.text


def test_the_session_probe_follows_the_second_factor_of_this_session(client, admin_env) -> None:
    info = _signed_in_admin(client)
    secret, _ = _enable_mfa(client, info["csrf"])

    assert client.get("/api/admin/session").json() == {"is_admin": True, "mfa_enabled": True, "mfa_verified": True, "mfa_recent": True}
    client.cookies.clear()
    login(client, email=ADMIN)
    assert client.get("/api/admin/session").json() == {"is_admin": True, "mfa_enabled": True, "mfa_verified": False, "mfa_recent": False}


def test_enrolling_a_second_factor_needs_the_password_again(client, admin_env) -> None:
    info = _signed_in_admin(client)
    headers = csrf_headers(info["csrf"])

    assert client.post("/api/auth/mfa/setup", headers=headers).status_code == 422
    wrong = client.post("/api/auth/mfa/setup", headers=headers, json={"password": "not the password"})
    assert wrong.status_code in (400, 401, 403)
    assert client.get("/api/auth/mfa").json()["enabled"] is False
    assert client.post("/api/auth/mfa/setup", headers=headers, json={"password": PASSWORD}).status_code == 200


# --- the second factor is per SESSION --------------------------------------------------------------


def test_configured_two_factor_is_not_proof_that_it_was_passed_in_this_session(client, admin_env) -> None:
    _mount(client)
    info = _signed_in_admin(client)
    _enable_mfa(client, info["csrf"])
    assert client.get(GATED).status_code == 200  # enabling it proved possession in this session

    client.cookies.clear()  # a different browser / a stolen password
    fresh = login(client, email=ADMIN)
    assert fresh.status_code == 200
    blocked = client.get(GATED)

    assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "mfa_required"
    assert client.post(f"/api/admin/users/{_victim(client)['id']}/ban", headers=csrf_headers(fresh.json()["csrf_token"])).status_code == 403
    assert client.get("/api/admin/audit").status_code == 403
    assert client.get("/api/admin/dashboard").status_code == 403
    assert client.get("/api/admin/session").status_code == 200  # the probe tells the page which step is next


def test_passing_the_code_unlocks_only_that_session(client, admin_env) -> None:
    _mount(client)
    info = _signed_in_admin(client)
    secret, _ = _enable_mfa(client, info["csrf"])
    first_cookie = client.cookies.get("sag_session")
    client.cookies.clear()
    second = login(client, email=ADMIN).json()
    second_cookie = client.cookies.get("sag_session")

    ok = client.post("/api/auth/mfa/verify", headers=csrf_headers(second["csrf_token"]), json={"code": _code(secret, 1)})
    assert ok.status_code == 200
    assert client.get(GATED).status_code == 200

    client.cookies.clear()
    client.cookies.set("sag_session", first_cookie)
    assert client.get(GATED).status_code == 200  # the first session was verified at setup
    client.cookies.clear()
    third = login(client, email=ADMIN)
    assert third.status_code == 200 and client.cookies.get("sag_session") not in (first_cookie, second_cookie)
    assert client.get(GATED).status_code == 403  # a third session starts unverified


def test_the_verification_goes_stale(client, admin_env) -> None:
    _mount(client)
    info = _signed_in_admin(client)
    _enable_mfa(client, info["csrf"])
    assert client.get("/api/admin/audit").status_code == 200

    for row in client.auth_store.sessions.values():
        row["mfa_verified_at"] = datetime.now(timezone.utc) - timedelta(hours=13)

    assert client.get("/api/admin/audit").json()["error"]["code"] == "mfa_required"


def test_a_recovery_code_counts_as_the_second_factor_once(client, admin_env) -> None:
    _mount(client)
    info = _signed_in_admin(client)
    _, codes = _enable_mfa(client, info["csrf"])
    client.cookies.clear()
    fresh = login(client, email=ADMIN).json()

    assert client.post("/api/auth/mfa/verify", headers=csrf_headers(fresh["csrf_token"]), json={"code": codes[0]}).status_code == 200
    assert client.get(GATED).status_code == 200
    client.cookies.clear()
    again = login(client, email=ADMIN).json()
    assert client.post("/api/auth/mfa/verify", headers=csrf_headers(again["csrf_token"]), json={"code": codes[0]}).status_code == 400


def test_a_wrong_code_gives_nothing_and_is_throttled(client, admin_env, monkeypatch) -> None:
    _mount(client)
    info = _signed_in_admin(client)
    _enable_mfa(client, info["csrf"])
    client.cookies.clear()
    fresh = login(client, email=ADMIN).json()
    monkeypatch.setenv("AUTH_RATE_LIMIT_ENABLED", "true")
    get_settings.cache_clear()

    codes = [client.post("/api/auth/mfa/verify", headers=csrf_headers(fresh["csrf_token"]), json={"code": f"{n:06d}"}).status_code
             for n in range(12)]

    assert codes[:10] == [400] * 10 and codes[10:] == [429, 429]
    assert client.get(GATED).status_code == 403


# --- what the operations do -------------------------------------------------------------------------


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

    assert client.get("/api/admin/dashboard").status_code == 403


def test_sign_up_helper_is_unused_here() -> None:
    assert sign_up is not None


# --- the allowlist: parsing and live application -------------------------------------------------------


def _settings(raw: str):
    from app.config import Settings

    return Settings(_env_file=None, ADMIN_EMAILS=raw)


def test_admin_emails_are_trimmed_lowercased_and_empty_entries_dropped() -> None:
    assert _settings("  Boss@Example.com , ,second@example.com,,").admin_emails_list == ["boss@example.com", "second@example.com"]
    assert _settings("").admin_emails_list == []
    assert _settings(" , ,").admin_emails_list == []


@pytest.mark.parametrize("junk", ["boss", "@example.com", "boss@", "a b@example.com", "boss@@example.com", "boss@example", "*@example.com", "example.com"])
def test_a_malformed_entry_is_ignored_instead_of_matching_something(junk: str) -> None:
    s = _settings(f"good@example.com,{junk}")

    assert s.admin_emails_list == ["good@example.com"] and s.admin_emails_ignored == 1


def test_there_is_no_partial_or_domain_matching() -> None:
    from app.api.deps import is_admin

    s = _settings("boss@example.com")
    verified = datetime.now(timezone.utc)
    base = {"email_verified_at": verified, "is_banned": False, "deleted_at": None}

    assert is_admin({**base, "email": "BOSS@example.com"}, s)
    for other in ("boss@example.com.evil.test", "xboss@example.com", "boss@sub.example.com", "someone@example.com", "boss+tag@example.com"):
        assert not is_admin({**base, "email": other}, s), other


def test_an_empty_allowlist_closes_the_administration_to_everyone() -> None:
    from app.api.deps import is_admin

    user = {"email": "boss@example.com", "email_verified_at": datetime.now(timezone.utc), "is_banned": False, "deleted_at": None}

    assert not is_admin(user, _settings(""))
    assert not is_admin(user, _settings("  ,  "))


def test_unverified_banned_and_deleted_accounts_are_never_administrators() -> None:
    from app.api.deps import is_admin

    s = _settings("boss@example.com")
    ok = {"email": "boss@example.com", "email_verified_at": datetime.now(timezone.utc), "is_banned": False, "deleted_at": None}

    assert is_admin(ok, s)
    assert not is_admin({**ok, "email_verified_at": None}, s)
    assert not is_admin({**ok, "is_banned": True}, s)
    assert not is_admin({**ok, "deleted_at": datetime.now(timezone.utc)}, s)
    assert not is_admin({**ok, "email": None}, s)


def test_removing_an_email_from_the_allowlist_ends_access_without_touching_the_account(client, admin_env, monkeypatch) -> None:
    _mount(client)
    info = _signed_in_admin(client)
    _enable_mfa(client, info["csrf"])
    assert client.get(GATED).status_code == 200

    monkeypatch.setenv("ADMIN_EMAILS", "somebody-else@example.com")  # the .env changed and the backend was recreated
    get_settings.cache_clear()

    assert client.get(GATED).status_code == 403
    assert client.get("/api/admin/session").status_code == 403
    assert client.get("/api/auth/me").status_code == 200  # an ordinary account, still signed in
    assert client.get("/api/auth/me").json()["is_admin"] is False


def test_the_session_of_a_former_administrator_does_not_keep_the_second_factor_valid_for_a_new_admin_role(client, admin_env, monkeypatch) -> None:
    _mount(client)
    info = _signed_in_admin(client)
    _enable_mfa(client, info["csrf"])
    monkeypatch.setenv("ADMIN_EMAILS", "")
    get_settings.cache_clear()
    assert client.get(GATED).status_code == 403

    monkeypatch.setenv("ADMIN_EMAILS", ADMIN)  # promoted again later - the old, still-valid session is simply admin again,
    get_settings.cache_clear()                 # but only with the second factor it really passed
    assert client.get(GATED).status_code == 200
    client.cookies.clear()
    login(client, email=ADMIN)
    assert client.get(GATED).json()["error"]["code"] == "mfa_required"
