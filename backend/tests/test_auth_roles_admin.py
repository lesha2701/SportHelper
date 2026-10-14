"""Roles (one account, several roles), admin rights, and the MFA gate."""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

from fastapi import Depends

from app.api.deps import require_admin, require_admin_mfa
from app.config import get_settings
from app.security import totp
from tests.auth_helpers import PASSWORD, csrf_headers, login, sign_in

ADMIN = "boss@example.com"


def _admin_env(monkeypatch) -> None:
    monkeypatch.setenv("ADMIN_EMAILS", f" {ADMIN.upper()} , other@example.com")
    get_settings.cache_clear()


def _mount_gated_routes(client) -> None:
    @client.app.get("/api/_test/admin")
    async def admin_only(ctx=Depends(require_admin)):
        return {"ok": True}

    @client.app.get("/api/_test/finance")
    async def finance(ctx=Depends(require_admin_mfa)):
        return {"ok": True}


def _code(secret: str, offset_steps: int = 0) -> str:
    return totp._hotp(secret, totp.current_step() + offset_steps)


# --- one account, several roles ---------------------------------------------------------


def test_one_account_can_be_player_and_coach_without_registering_twice(client) -> None:
    info = sign_in(client, role="coach")
    headers = csrf_headers(info["csrf"])
    assert client.get("/api/auth/me").json()["preferred_role"] == "coach"

    coach = client.put("/api/profile/coach", headers=headers,
                       json={"full_name": "Алиса Тренер", "sport": "Теннис", "experience_years": 3})
    player = client.put("/api/profile/player", headers=headers, json={"full_name": "Алиса", "sport": "Теннис"})
    switched = client.post("/api/profile/active-mode", headers=headers, json={"mode": "player"})

    assert coach.status_code == player.status_code == switched.status_code == 200
    profile = client.get("/api/profile/me").json()
    assert profile["coach"] and profile["player"] and profile["active_mode"] == "player"
    assert len([u for u in client.auth_store.users.values()]) == 1


def test_role_choice_at_signup_is_optional_and_validated(client) -> None:
    from tests.auth_helpers import register

    assert register(client, role=None, email="a@example.com").status_code == 201
    assert register(client, role="admin", email="b@example.com").status_code == 422
    assert register(client, role="superuser", email="c@example.com").status_code == 422


# --- administrators ----------------------------------------------------------------------


def test_nobody_can_make_themselves_admin_through_the_api(client) -> None:
    info = sign_in(client)
    headers = csrf_headers(info["csrf"])

    for path, body in (
        ("/api/profile/player", {"full_name": "x", "sport": "y", "is_admin": True, "role": "admin"}),
        ("/api/profile/active-mode", {"mode": "admin", "is_admin": True}),
    ):
        client.put(path, headers=headers, json=body) if "player" in path else client.post(path, headers=headers, json=body)
    registered = client.post("/api/auth/register", json={
        "first_name": "Evil", "email": "evil@example.com", "password": PASSWORD, "password_confirm": PASSWORD,
        "accept_terms": True, "is_admin": True, "role": "player",
    })

    assert registered.status_code == 201
    assert client.get("/api/auth/me").json()["is_admin"] is False
    assert all(u.get("is_admin") is None for u in client.auth_store.users.values())


def test_admin_comes_only_from_server_configuration(client, monkeypatch) -> None:
    _admin_env(monkeypatch)
    _mount_gated_routes(client)
    sign_in(client, email=ADMIN)

    assert client.get("/api/auth/me").json()["is_admin"] is True
    assert client.get("/api/_test/admin").status_code == 200


def test_ordinary_users_are_refused_admin_routes(client) -> None:
    _mount_gated_routes(client)
    sign_in(client)

    assert client.get("/api/auth/me").json()["is_admin"] is False
    assert client.get("/api/_test/admin").status_code == 403
    assert client.get("/api/_test/finance").status_code == 403


def test_an_unconfirmed_admin_address_grants_nothing(client, monkeypatch) -> None:
    from tests.auth_helpers import register

    _admin_env(monkeypatch)
    _mount_gated_routes(client)
    register(client, email=ADMIN)  # registered but never verified -> cannot even sign in

    assert login(client, email=ADMIN).status_code == 403
    assert client.get("/api/_test/admin").status_code == 401
    user = client.auth_store.find_by_email(ADMIN)
    from app.api.deps import is_admin

    assert not is_admin(client.auth_store.user_view(user), get_settings())


# --- MFA ----------------------------------------------------------------------------------


def test_financial_routes_require_mfa_setup_then_a_code_per_session(client, monkeypatch) -> None:
    _admin_env(monkeypatch)
    _mount_gated_routes(client)
    info = sign_in(client, email=ADMIN)
    headers = csrf_headers(info["csrf"])

    # 1. An admin without a second factor is refused and told to set it up.
    blocked = client.get("/api/_test/finance")
    assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "mfa_setup_required"

    # 2. Set it up: scan the secret, confirm with a code, keep the recovery codes.
    setup = client.post("/api/auth/mfa/setup", headers=headers).json()
    assert setup["otpauth_uri"].startswith("otpauth://totp/") and setup["secret"] in setup["otpauth_uri"]
    assert client.post("/api/auth/mfa/enable", headers=headers, json={"code": "000000"}).status_code == 400
    enabled = client.post("/api/auth/mfa/enable", headers=headers, json={"code": _code(setup["secret"])})
    assert enabled.status_code == 200 and len(enabled.json()["recovery_codes"]) == 8
    assert client.get("/api/_test/finance").status_code == 200  # this session just passed the factor

    # 3. A NEW session (new device) must pass the factor again.
    client.cookies.clear()
    fresh = login(client, email=ADMIN).json()
    gated = client.get("/api/_test/finance")
    assert gated.status_code == 403 and gated.json()["error"]["code"] == "mfa_required"
    wrong = client.post("/api/auth/mfa/verify", headers=csrf_headers(fresh["csrf_token"]), json={"code": "123456"})
    assert wrong.status_code == 400
    # The code of the step used at enable-time can't be replayed; the next one works.
    replay = client.post("/api/auth/mfa/verify", headers=csrf_headers(fresh["csrf_token"]), json={"code": _code(setup["secret"])})
    assert replay.status_code == 400
    ok = client.post("/api/auth/mfa/verify", headers=csrf_headers(fresh["csrf_token"]), json={"code": _code(setup["secret"], 1)})
    assert ok.status_code == 200
    assert client.get("/api/_test/finance").status_code == 200


def test_mfa_verification_expires_with_the_configured_window(client, monkeypatch) -> None:
    _admin_env(monkeypatch)
    _mount_gated_routes(client)
    info = sign_in(client, email=ADMIN)
    headers = csrf_headers(info["csrf"])
    secret = client.post("/api/auth/mfa/setup", headers=headers).json()["secret"]
    client.post("/api/auth/mfa/enable", headers=headers, json={"code": _code(secret)})
    assert client.get("/api/_test/finance").status_code == 200

    for row in client.auth_store.sessions.values():
        row["mfa_verified_at"] = datetime.now(timezone.utc) - timedelta(hours=13)

    assert client.get("/api/_test/finance").json()["error"]["code"] == "mfa_required"


def test_recovery_codes_work_once(client, monkeypatch) -> None:
    _admin_env(monkeypatch)
    info = sign_in(client, email=ADMIN)
    headers = csrf_headers(info["csrf"])
    secret = client.post("/api/auth/mfa/setup", headers=headers).json()["secret"]
    codes = client.post("/api/auth/mfa/enable", headers=headers, json={"code": _code(secret)}).json()["recovery_codes"]

    assert client.post("/api/auth/mfa/verify", headers=headers, json={"code": codes[0]}).status_code == 200
    assert client.post("/api/auth/mfa/verify", headers=headers, json={"code": codes[0]}).status_code == 400
    assert client.post("/api/auth/mfa/verify", headers=headers, json={"code": codes[1].upper()}).status_code == 200


def test_mfa_secret_is_encrypted_at_rest_and_recovery_codes_hashed(client, monkeypatch) -> None:
    _admin_env(monkeypatch)
    info = sign_in(client, email=ADMIN)
    headers = csrf_headers(info["csrf"])
    secret = client.post("/api/auth/mfa/setup", headers=headers).json()["secret"]
    codes = client.post("/api/auth/mfa/enable", headers=headers, json={"code": _code(secret)}).json()["recovery_codes"]

    stored = next(iter(client.auth_store.mfa.values()))
    assert secret not in stored["secret_encrypted"]
    assert all(code not in stored["recovery_hashes"] for code in codes)


def test_disabling_mfa_needs_the_password_and_a_code(client, monkeypatch) -> None:
    _admin_env(monkeypatch)
    info = sign_in(client, email=ADMIN)
    headers = csrf_headers(info["csrf"])
    secret = client.post("/api/auth/mfa/setup", headers=headers).json()["secret"]
    client.post("/api/auth/mfa/enable", headers=headers, json={"code": _code(secret)})

    no_code = client.post("/api/auth/mfa/disable", headers=headers, json={"password": PASSWORD, "code": "000000"})
    no_password = client.post("/api/auth/mfa/disable", headers=headers, json={"password": "wrong wrong wrong", "code": _code(secret, 1)})
    assert no_code.status_code == 400 and no_password.status_code == 403
    assert client.get("/api/auth/mfa").json()["enabled"] is True

    ok = client.post("/api/auth/mfa/disable", headers=headers, json={"password": PASSWORD, "code": _code(secret, 1)})
    assert ok.status_code == 200 and client.get("/api/auth/mfa").json()["enabled"] is False


def test_mfa_is_only_offered_to_administrators(client) -> None:
    info = sign_in(client)

    assert client.get("/api/auth/mfa").json() == {"is_admin": False, "enabled": False, "session_verified": False}
    assert client.post("/api/auth/mfa/setup", headers=csrf_headers(info["csrf"])).status_code == 403


def test_totp_matches_the_rfc_6238_test_vector() -> None:
    # RFC 6238 appendix B (SHA-1, secret "12345678901234567890"), T=59s -> 94287082 -> last 6 digits.
    import base64

    secret = base64.b32encode(b"12345678901234567890").decode().rstrip("=")
    assert totp.verify_code(secret, "287082", now=59) == 1
    assert totp.verify_code(secret, "287082", now=59, last_used_step=1) is None  # replay refused
    assert totp.verify_code(secret, "000000", now=59) is None
    assert time.time() > 0
