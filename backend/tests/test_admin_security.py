"""Whole-surface security checks for the administration: every route, every kind of caller. If someone adds an admin
route and forgets its protection - or an unauthenticated route that was not meant to be public - these fail."""
from __future__ import annotations

import re
import uuid

import asyncpg
import pytest
from fastapi.routing import APIRoute

import app.main as app_main
from app.api import deps
from tests.admin_world import ADMIN_EMAIL, Browser, add_user, live_client, pg, publish_listing, set_admins, sql, sql_value, world  # noqa: F401
from tests.auth_helpers import PASSWORD, link_token

_ANY_ID = "00000000-0000-4000-8000-000000000001"

# Routes that may be called without a session. Everything else needs one. Adding to this list is a deliberate decision.
PUBLIC_ROUTES = {
    ("POST", "/api/auth/claim"), ("POST", "/api/auth/claim/inspect"), ("POST", "/api/auth/confirm-email-change"),
    ("POST", "/api/auth/forgot-password"), ("POST", "/api/auth/login"), ("POST", "/api/auth/logout"), ("POST", "/api/auth/register"),
    ("POST", "/api/auth/resend-verification"), ("POST", "/api/auth/reset-password"), ("POST", "/api/auth/verify-email"),
    ("POST", "/api/auth/verify-email/inspect"), ("POST", "/api/auth/verify-email/set-password"),
    ("GET", "/api/coach-listings"), ("GET", "/api/coach-listings/{listing_id}"), ("GET", "/api/coach-listings/{listing_id}/slots"),
    ("GET", "/api/coaches/{coach_user_id}/listings"), ("GET", "/api/coaches/{coach_user_id}/profile"), ("GET", "/api/coaches/{coach_user_id}/reviews"),
    ("GET", "/api/features"), ("GET", "/api/files/{file_id}"), ("GET", "/api/health"), ("GET", "/api/profile/media/{user_id}"),
}
_AUTH_DEPENDENCIES = {
    deps.get_current_user, deps.get_auth_context, deps.require_admin, deps.require_admin_mfa, deps.require_admin_write,
    deps.require_admin_recent_mfa,
}


def _calls(dependant) -> set:
    found = {dependant.call}
    for sub in dependant.dependencies:
        found |= _calls(sub)
    return found


def _routes():
    return [r for r in app_main.create_app().routes if isinstance(r, APIRoute)]


def _admin_routes():
    return [(m, r) for r in _routes() if r.path.startswith("/api/admin") for m in sorted(r.methods - {"HEAD", "OPTIONS"})]


def _url(path: str) -> str:
    return re.sub(r"\{[^}]+\}", _ANY_ID, path)


def _body(method: str) -> dict | None:
    return {"reason": "проверка доступа", "confirm": True, "days": 1, "status": "resolved", "resolution": "проверка доступа"} if method != "GET" else None


# --- nothing is public by accident -----------------------------------------------------------------------------------


def test_only_the_intended_routes_can_be_called_without_signing_in() -> None:
    unauthenticated = {(m, r.path) for r in _routes() for m in r.methods - {"HEAD", "OPTIONS"} if not (_calls(r.dependant) & _AUTH_DEPENDENCIES)}

    assert unauthenticated == PUBLIC_ROUTES, (
        f"unexpectedly public: {sorted(unauthenticated - PUBLIC_ROUTES)}; no longer public (update the list): {sorted(PUBLIC_ROUTES - unauthenticated)}"
    )


def test_every_admin_route_is_protected_and_every_change_is_rate_limited_and_audited_by_construction() -> None:
    routes = _admin_routes()
    assert len(routes) >= 24

    for method, route in routes:
        calls = _calls(route.dependant)
        if route.path == "/api/admin/session":
            assert deps.require_admin in calls
            continue
        assert deps.require_admin_mfa in calls, f"{method} {route.path}: the second factor is not required"
        if method != "GET":
            assert deps.require_admin_write in calls, f"{method} {route.path}: changes must be rate limited"
        if route.path.endswith("/delete"):
            assert deps.require_admin_recent_mfa in calls, f"{route.path}: irreversible, needs a recent code"


def test_no_admin_route_exists_for_editing_or_removing_the_audit_trail_or_for_granting_admin_rights() -> None:
    for method, route in _admin_routes():
        if "/audit" in route.path:
            assert method == "GET", f"{method} {route.path}"
        assert not re.search(r"admin(s)?\b|grant|promote|role", route.path.removeprefix("/api/admin")), route.path
    assert not any(r.path.startswith("/api") and re.search(r"promote|make-admin|grant", r.path) for r in _routes())


# --- the matrix: every admin route x every kind of caller --------------------------------------------------------------


def test_every_admin_route_refuses_everyone_it_should(world) -> None:
    ordinary = Browser(world.client, "ordinary@example.com", "Обычный")
    former_admin = Browser(world.client, "former@example.com", "Бывший", role=None)  # never on the allowlist
    checked = 0
    for method, route in _admin_routes():
        url, body = _url(route.path), _body(method)
        world.client.cookies.clear()
        assert world.client.request(method, url, json=body).status_code == 401, ("guest", method, route.path)
        assert ordinary.call(method, url, json=body).status_code == 403, ("ordinary user", method, route.path)
        assert former_admin.call(method, url, json=body).status_code == 403, ("not on the list", method, route.path)
        locked = world.admin.fresh_session().call(method, url, json=body)
        if route.path == "/api/admin/session":
            assert locked.status_code == 200
        else:
            assert locked.status_code == 403 and locked.json()["error"]["code"] == "mfa_required", ("no second factor", method, route.path)
        checked += 1
    assert checked >= 24


def test_every_admin_change_refuses_a_cookie_request_without_the_csrf_token(world) -> None:
    world.admin.fresh_unlocked_session()
    for method, route in _admin_routes():
        if method == "GET":
            continue
        world.client.cookies.clear()
        for name, value in world.admin.cookies.items():
            world.client.cookies.set(name, value)
        forged = world.client.request(method, _url(route.path), json=_body(method))  # as a page on another site would send it
        assert forged.status_code == 403 and forged.json()["error"]["code"] == "csrf_failed", (method, route.path)


def test_admin_answers_are_never_cached(world) -> None:
    for path in ("/api/admin/session", "/api/admin/dashboard", "/api/admin/users", "/api/admin/media", "/api/admin/listings",
                 "/api/admin/trainings", "/api/admin/complaints", "/api/admin/audit"):
        response = world.admin.call("GET", path)
        assert response.status_code == 200, path
        assert "no-store" in response.headers.get("cache-control", ""), path


def test_nothing_the_browser_can_set_makes_a_user_an_administrator(world) -> None:
    ordinary = Browser(world.client, "ordinary@example.com", "Обычный")
    forged_headers = {"X-Admin": "true", "X-Is-Admin": "1", "X-Role": "admin", "X-Forwarded-User": ADMIN_EMAIL, "X-User-Email": ADMIN_EMAIL,
                      "Authorization": "Bearer admin", "X-Admin-Token": "x"}
    world.client.cookies.set("is_admin", "true")
    world.client.cookies.set("role", "admin")

    for path in ("/api/admin/session", "/api/admin/dashboard", "/api/admin/users"):
        for params in ({}, {"is_admin": "true", "admin": "1", "role": "admin", "email": ADMIN_EMAIL, "user_id": world.admin.user_id}):
            response = ordinary.call("GET", path, headers=forged_headers, params=params)
            assert response.status_code == 403, (path, params)
    me = ordinary.ok("GET", "/api/auth/me")
    assert me["is_admin"] is False
    # And a request body cannot promote either:
    assert ordinary.call("PUT", "/api/profile/player", json={"full_name": "x", "sport": "y", "is_admin": True}).status_code in (200, 422)
    assert ordinary.ok("GET", "/api/auth/me")["is_admin"] is False


def test_the_list_of_administrators_is_never_sent_to_anyone_but_who_they_are_themselves(world) -> None:
    ordinary = Browser(world.client, "ordinary@example.com", "Обычный")
    texts = [
        ordinary.call("GET", "/api/auth/me").text, ordinary.call("GET", "/api/auth/mfa").text, ordinary.call("GET", "/api/profile/me").text,
        ordinary.call("GET", "/api/admin/session").text, ordinary.call("GET", "/api/admin/users").text,
    ]

    assert all(ADMIN_EMAIL not in text for text in texts)
    assert ordinary.ok("GET", "/api/auth/me")["is_admin"] is False
    assert world.admin.ok("GET", "/api/auth/me")["is_admin"] is True


def test_an_unverified_registration_with_an_administrators_address_gets_nothing(world) -> None:
    world.client.cookies.clear()
    impostor = world.client.post("/api/auth/register", json={"first_name": "Самозванец", "email": ADMIN_EMAIL, "password": "impostor passphrase here",
                                                             "password_confirm": "impostor passphrase here", "accept_terms": True})

    assert impostor.status_code in (201, 409)  # the address is taken, so no second account can exist for it
    assert world.client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": "impostor passphrase here"}).status_code in (401, 403)
    assert world.client.get("/api/admin/session").status_code == 401
    assert sql_value(world.dsn, "SELECT count(*) FROM users WHERE lower(email) = $1", ADMIN_EMAIL) == 1  # still only the real one


# --- the account lifecycle of an administrator -------------------------------------------------------------------------------


def test_a_blocked_administrator_loses_everything_at_once_but_the_session_check_is_not_the_only_thing(world) -> None:
    sql(world.dsn, "UPDATE users SET is_banned = TRUE WHERE id = $1::uuid", world.admin.user_id)

    for method, route in _admin_routes():
        response = world.admin.call(method, _url(route.path), json=_body(method))
        assert response.status_code == 403, (method, route.path)


def test_removing_the_address_from_the_allowlist_closes_every_admin_route_but_not_the_account(world) -> None:
    assert world.admin.call("GET", "/api/admin/dashboard").status_code == 200

    set_admins(world, "someone-else@example.com")  # .env changed, backend recreated

    for method, route in _admin_routes():
        assert world.admin.call(method, _url(route.path), json=_body(method)).status_code == 403, (method, route.path)
    assert world.admin.ok("GET", "/api/auth/me")["is_admin"] is False
    assert world.admin.ok("GET", "/api/profile/me") is not None  # the person can still use the site


def test_an_administrators_old_session_stops_working_after_logout_and_after_a_password_change(world) -> None:
    old_cookies = dict(world.admin.cookies)
    world.admin.ok("POST", "/api/auth/logout")

    world.client.cookies.clear()
    for name, value in old_cookies.items():
        world.client.cookies.set(name, value)
    assert world.client.get("/api/admin/session").status_code == 401  # a replayed cookie after sign-out

    world.admin.fresh_unlocked_session()
    current = dict(world.admin.cookies)
    world.client.cookies.clear()
    login = world.client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": PASSWORD})  # a second device / a thief with the password
    other_device = dict(world.client.cookies)
    assert login.status_code == 200
    world.admin.cookies = current
    changed = world.admin.call("POST", "/api/auth/change-password", json={"current_password": PASSWORD, "new_password": "a brand new passphrase!", "new_password_confirm": "a brand new passphrase!"})
    assert changed.status_code == 200, changed.text

    world.client.cookies.clear()
    for name, value in other_device.items():
        world.client.cookies.set(name, value)
    assert world.client.get("/api/admin/session").status_code == 401  # the other session did not survive the new password
    assert world.admin.call("GET", "/api/admin/session").status_code == 200  # the one that changed it carries on


def test_changing_the_email_does_not_carry_admin_rights_to_a_new_address_until_it_is_confirmed(world) -> None:
    world.admin.ok("POST", "/api/auth/change-email", json={"new_email": "new-boss@example.com", "password": PASSWORD})

    assert world.admin.ok("GET", "/api/auth/me")["is_admin"] is True  # still the confirmed address, still on the list
    token = link_token([m for m in world.client.outbox if m.to == "new-boss@example.com"][-1])
    world.client.cookies.clear()
    assert world.client.post("/api/auth/confirm-email-change", json={"token": token}).status_code == 200

    again = world.client.post("/api/auth/login", json={"email": "new-boss@example.com", "password": PASSWORD})
    assert again.status_code == 200
    assert world.client.get("/api/auth/me").json()["is_admin"] is False  # the new address is not on the allowlist
    set_admins(world, "new-boss@example.com")
    assert world.client.get("/api/auth/me").json()["is_admin"] is True


def test_someone_else_cannot_take_over_the_administrators_address_by_changing_their_own_email_to_it(world) -> None:
    ordinary = Browser(world.client, "ordinary@example.com", "Обычный")

    response = ordinary.call("POST", "/api/auth/change-email", json={"new_email": ADMIN_EMAIL, "password": PASSWORD})

    assert response.status_code in (200, 202, 409)
    assert ordinary.ok("GET", "/api/auth/me")["is_admin"] is False
    assert sql_value(world.dsn, "SELECT email FROM users WHERE id = $1::uuid", ordinary.user_id) == "ordinary@example.com"
    assert ordinary.call("GET", "/api/admin/session").status_code == 403


# --- the audit trail cannot be rewritten --------------------------------------------------------------------------------------


def _try(dsn: str, statement: str) -> str:
    async def run():
        conn = await asyncpg.connect(dsn)
        try:
            await conn.execute(statement)
            return "executed"
        except asyncpg.PostgresError as exc:
            return type(exc).__name__
        finally:
            await conn.close()

    import asyncio

    return asyncio.run(run())


def test_the_database_itself_refuses_to_edit_delete_or_truncate_audit_entries(world) -> None:
    victim = add_user(world.dsn, "victim@example.com")
    world.admin.call("POST", f"/api/admin/users/{victim}/ban", json={"reason": "Нарушение правил площадки"})
    assert sql_value(world.dsn, "SELECT count(*) FROM admin_audit_log") >= 1

    for statement in ("UPDATE admin_audit_log SET reason = 'ничего не было'", "DELETE FROM admin_audit_log", "TRUNCATE admin_audit_log"):
        assert _try(world.dsn, statement) == "IntegrityConstraintViolationError", statement
    assert sql_value(world.dsn, "SELECT count(*) FROM admin_audit_log WHERE reason = 'ничего не было'") == 0


def test_audit_entries_never_contain_secrets(world) -> None:
    victim = add_user(world.dsn, "victim@example.com")
    world.admin.call("POST", f"/api/admin/users/{victim}/ban", json={"reason": "Нарушение правил площадки"})
    publish = Browser(world.client, "coach@example.com", "Тренер", "coach")
    listing = publish_listing(publish)
    world.admin.call("POST", f"/api/admin/listings/{listing['id']}/hide", json={"reason": "нарушение правил"})

    text = str(world.admin.ok("GET", "/api/admin/audit", params={"limit": 200})).lower()

    for secret in ("password", "token", "secret", "cookie", "hash", "csrf", PASSWORD.lower()):
        assert secret not in text, secret


def test_unlocking_the_panel_and_enrolling_a_factor_are_recorded(world) -> None:
    actions = [e["action"] for e in world.admin.ok("GET", "/api/admin/audit", params={"limit": 50})["items"]]

    assert "mfa_enabled" in actions


def test_audit_filters_and_paging(world) -> None:
    victim = add_user(world.dsn, "victim@example.com")
    world.admin.call("POST", f"/api/admin/users/{victim}/ban", json={"reason": "Нарушение правил площадки"})
    world.admin.call("POST", f"/api/admin/users/{victim}/unban", json={"reason": "Ошибка модератора"})
    world.admin.call("POST", f"/api/admin/users/{world.admin.user_id}/ban", json={"reason": "Себя нельзя"})
    audit = lambda **p: world.admin.ok("GET", "/api/admin/audit", params=p)  # noqa: E731

    assert [e["action"] for e in audit(action="ban")["items"]] == ["ban", "ban"] and audit(action="ban")["total"] == 2
    assert [e["result"] for e in audit(result="denied")["items"]] == ["denied"]
    assert {e["target_id"] for e in audit(target_type="user", q=victim)["items"]} == {victim}
    assert audit(q="ошибка модератора")["total"] == 1 and audit(q=ADMIN_EMAIL)["total"] >= 3 and audit(q="%")["total"] == 0
    assert len(audit(limit=2)["items"]) == 2 and audit(limit=2, offset=2)["items"]
    for bad in ({"result": "maybe"}, {"limit": 500}, {"offset": -1}):
        assert world.admin.call("GET", "/api/admin/audit", params=bad).status_code == 422
    newest_first = [e["created_at"] for e in audit()["items"]]
    assert newest_first == sorted(newest_first, reverse=True)


# --- throttling ---------------------------------------------------------------------------------------------------------------


def test_a_stolen_admin_session_cannot_make_changes_at_machine_speed(world, monkeypatch) -> None:
    from app.config import get_settings

    monkeypatch.setenv("AUTH_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("ADMIN_WRITE_LIMIT_PER_MINUTE", "3")
    get_settings.cache_clear()
    targets = [add_user(world.dsn, f"t{i}@example.com") for i in range(6)]

    statuses = [world.admin.call("POST", f"/api/admin/users/{t}/ban", json={"reason": "Нарушение правил"}).status_code for t in targets]

    assert statuses[:3] == [200, 200, 200] and set(statuses[3:]) == {429}
    assert world.admin.call("GET", "/api/admin/users").status_code == 200  # looking is not limited by it
    assert sql_value(world.dsn, "SELECT count(*) FROM users WHERE is_banned") == 3


def test_ids_that_are_not_ids_never_reach_the_database(world) -> None:
    for path in ("/api/admin/users/not-a-uuid", "/api/admin/media/1; DROP TABLE users", "/api/admin/complaints/%27%20OR%201=1", f"/api/admin/listings/{uuid.uuid4()}x"):
        assert world.admin.call("GET", path).status_code in (404, 422), path
    assert sql_value(world.dsn, "SELECT count(*) FROM users") == 1
