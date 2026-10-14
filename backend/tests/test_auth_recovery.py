from __future__ import annotations

from datetime import datetime, timedelta, timezone

from tests.auth_helpers import (
    OTHER_PASSWORD,
    PASSWORD,
    csrf_headers,
    link_token,
    login,
    mails_to,
    register,
    sign_in,
    sign_up,
)

NEUTRAL = "Если аккаунт с таким адресом существует, мы отправили письмо."


def _reset_mail(client, address: str):
    return [m for m in mails_to(client, address) if "восстановлен" in m.subject.lower()]


# --- forgot / reset password ------------------------------------------------------


def test_forgot_password_answer_is_identical_for_known_and_unknown_addresses(client) -> None:
    sign_up(client)

    known = client.post("/api/auth/forgot-password", json={"email": "alice@example.com"})
    unknown = client.post("/api/auth/forgot-password", json={"email": "nobody@example.com"})
    garbage = client.post("/api/auth/forgot-password", json={"email": "###"})

    assert known.status_code == unknown.status_code == garbage.status_code == 200
    assert known.json() == unknown.json() == garbage.json() == {"message": NEUTRAL}
    assert len(_reset_mail(client, "alice@example.com")) == 1
    assert mails_to(client, "nobody@example.com") == []


def test_reset_flow_sets_the_new_password_and_signs_everyone_out(client) -> None:
    sign_in(client)
    other_device = login(client)
    assert other_device.status_code == 200
    client.post("/api/auth/forgot-password", json={"email": "alice@example.com"})
    token = link_token(_reset_mail(client, "alice@example.com")[0])

    resp = client.post(
        "/api/auth/reset-password", json={"token": token, "password": OTHER_PASSWORD, "password_confirm": OTHER_PASSWORD}
    )

    assert resp.status_code == 200
    assert "set-cookie" not in resp.headers  # no automatic login: the user signs in afterwards
    assert client.get("/api/auth/me").status_code == 401  # the old sessions are dead
    assert login(client, password=PASSWORD).status_code == 401
    assert login(client, password=OTHER_PASSWORD).status_code == 200


def test_user_is_notified_by_email_when_the_password_changes(client) -> None:
    sign_up(client)
    client.post("/api/auth/forgot-password", json={"email": "alice@example.com"})
    token = link_token(_reset_mail(client, "alice@example.com")[0])

    client.post("/api/auth/reset-password", json={"token": token, "password": OTHER_PASSWORD, "password_confirm": OTHER_PASSWORD})

    notices = [m for m in mails_to(client, "alice@example.com") if "изменён" in m.subject.lower()]
    assert len(notices) == 1
    assert OTHER_PASSWORD not in notices[0].text


def test_reset_link_is_single_use(client) -> None:
    sign_up(client)
    client.post("/api/auth/forgot-password", json={"email": "alice@example.com"})
    token = link_token(_reset_mail(client, "alice@example.com")[0])
    body = {"token": token, "password": OTHER_PASSWORD, "password_confirm": OTHER_PASSWORD}

    assert client.post("/api/auth/reset-password", json=body).status_code == 200
    again = client.post("/api/auth/reset-password", json={**body, "password": "a third passphrase", "password_confirm": "a third passphrase"})

    assert again.status_code == 400 and again.json()["error"]["code"] == "invalid_token"
    assert login(client, password=OTHER_PASSWORD).status_code == 200  # the replay changed nothing


def test_reset_link_expires_after_thirty_minutes(client) -> None:
    sign_up(client)
    client.post("/api/auth/forgot-password", json={"email": "alice@example.com"})
    token = link_token(_reset_mail(client, "alice@example.com")[0])

    stored = [t for t in client.auth_store.tokens if t["purpose"] == "password_reset"][0]
    lifetime = stored["expires_at"] - stored["created_at"]
    assert timedelta(minutes=29) < lifetime <= timedelta(minutes=30, seconds=5)

    stored["expires_at"] = datetime.now(timezone.utc) - timedelta(seconds=1)
    resp = client.post("/api/auth/reset-password", json={"token": token, "password": OTHER_PASSWORD, "password_confirm": OTHER_PASSWORD})

    assert resp.status_code == 400
    assert login(client, password=PASSWORD).status_code == 200


def test_a_new_reset_request_invalidates_the_previous_link(client) -> None:
    sign_up(client)
    client.post("/api/auth/forgot-password", json={"email": "alice@example.com"})
    first = link_token(_reset_mail(client, "alice@example.com")[0])
    client.post("/api/auth/forgot-password", json={"email": "alice@example.com"})
    second = link_token(_reset_mail(client, "alice@example.com")[1])

    body = {"password": OTHER_PASSWORD, "password_confirm": OTHER_PASSWORD}
    assert client.post("/api/auth/reset-password", json={"token": first, **body}).status_code == 400
    assert client.post("/api/auth/reset-password", json={"token": second, **body}).status_code == 200


def test_weak_new_password_is_rejected_and_the_link_stays_usable(client) -> None:
    sign_up(client)
    client.post("/api/auth/forgot-password", json={"email": "alice@example.com"})
    token = link_token(_reset_mail(client, "alice@example.com")[0])

    weak = client.post("/api/auth/reset-password", json={"token": token, "password": "short", "password_confirm": "short"})
    mismatch = client.post("/api/auth/reset-password", json={"token": token, "password": OTHER_PASSWORD, "password_confirm": "nope nope nope"})
    ok = client.post("/api/auth/reset-password", json={"token": token, "password": OTHER_PASSWORD, "password_confirm": OTHER_PASSWORD})

    assert weak.status_code == 422 and mismatch.status_code == 422
    assert ok.status_code == 200


def test_reset_clears_a_lockout(client) -> None:
    sign_up(client)
    for _ in range(5):
        login(client, password="wrong wrong wrong")
    assert login(client).status_code == 429
    client.post("/api/auth/forgot-password", json={"email": "alice@example.com"})
    token = link_token(_reset_mail(client, "alice@example.com")[0])

    client.post("/api/auth/reset-password", json={"token": token, "password": OTHER_PASSWORD, "password_confirm": OTHER_PASSWORD})

    assert login(client, password=OTHER_PASSWORD).status_code == 200


def test_forgot_password_for_an_unconfirmed_account_resends_the_verification_instead(client) -> None:
    register(client)

    resp = client.post("/api/auth/forgot-password", json={"email": "alice@example.com"})

    assert resp.json() == {"message": NEUTRAL}
    assert _reset_mail(client, "alice@example.com") == []
    assert len(mails_to(client, "alice@example.com")) == 2  # registration + this one


def test_forgot_password_is_rate_limited_per_address_without_revealing_anything(client, monkeypatch) -> None:
    from app.config import get_settings

    monkeypatch.setenv("AUTH_RATE_LIMIT_ENABLED", "true")
    get_settings.cache_clear()
    sign_up(client)

    codes = [client.post("/api/auth/forgot-password", json={"email": "alice@example.com"}).status_code for _ in range(5)]

    assert codes == [200, 200, 200, 429, 429]
    assert len(_reset_mail(client, "alice@example.com")) == 3  # mail-bombing is capped


def test_reset_with_a_garbage_token_is_refused(client) -> None:
    resp = client.post("/api/auth/reset-password", json={"token": "x", "password": OTHER_PASSWORD, "password_confirm": OTHER_PASSWORD})

    assert resp.status_code == 400 and resp.json()["error"]["code"] == "invalid_token"


# --- change password (logged in) -----------------------------------------------------


def test_change_password_requires_the_current_password(client) -> None:
    info = sign_in(client)

    resp = client.post(
        "/api/auth/change-password",
        headers=csrf_headers(info["csrf"]),
        json={"current_password": "not my password", "new_password": OTHER_PASSWORD, "new_password_confirm": OTHER_PASSWORD},
    )

    assert resp.status_code == 403 and resp.json()["error"]["code"] == "invalid_password"
    assert login(client, password=PASSWORD).status_code == 200


def test_change_password_keeps_this_device_and_ends_the_others(client) -> None:
    info = sign_in(client)
    this_cookie = client.cookies.get("sag_session")
    # a second device
    login(client)
    other_cookie = client.cookies.get("sag_session")
    client.cookies.clear()
    client.cookies.set("sag_session", this_cookie)

    resp = client.post(
        "/api/auth/change-password",
        headers=csrf_headers(info["csrf"]),
        json={"current_password": PASSWORD, "new_password": OTHER_PASSWORD, "new_password_confirm": OTHER_PASSWORD},
    )

    assert resp.status_code == 200
    assert client.get("/api/auth/me").status_code == 200  # still signed in here
    client.cookies.clear()
    client.cookies.set("sag_session", other_cookie)
    assert client.get("/api/auth/me").status_code == 401  # signed out elsewhere
    client.cookies.clear()
    assert login(client, password=PASSWORD).status_code == 401
    assert login(client, password=OTHER_PASSWORD).status_code == 200
    assert any("изменён" in m.subject.lower() for m in mails_to(client, "alice@example.com"))


def test_change_password_rejects_reuse_and_weak_passwords(client) -> None:
    info = sign_in(client)
    headers = csrf_headers(info["csrf"])

    same = client.post("/api/auth/change-password", headers=headers,
                       json={"current_password": PASSWORD, "new_password": PASSWORD, "new_password_confirm": PASSWORD})
    weak = client.post("/api/auth/change-password", headers=headers,
                       json={"current_password": PASSWORD, "new_password": "short", "new_password_confirm": "short"})
    mismatch = client.post("/api/auth/change-password", headers=headers,
                           json={"current_password": PASSWORD, "new_password": OTHER_PASSWORD, "new_password_confirm": "different one"})

    assert (same.status_code, weak.status_code, mismatch.status_code) == (422, 422, 422)
    assert same.json()["error"]["field"] == "new_password"


def test_change_password_requires_a_session(client) -> None:
    resp = client.post("/api/auth/change-password", json={"current_password": "x", "new_password": "y", "new_password_confirm": "y"})

    assert resp.status_code == 401


# --- change email -----------------------------------------------------------------------


def test_email_change_needs_confirmation_from_the_new_address(client) -> None:
    info = sign_in(client)

    resp = client.post("/api/auth/change-email", headers=csrf_headers(info["csrf"]),
                       json={"new_email": "New.Alice@Example.com", "password": PASSWORD})

    assert resp.status_code == 200
    # The address is unchanged until the new one is confirmed.
    assert client.get("/api/auth/me").json()["email"] == "alice@example.com"
    confirm_mail = [m for m in mails_to(client, "new.alice@example.com")]
    assert len(confirm_mail) == 1
    # ...and the OLD address is warned that a change was requested.
    warning = [m for m in mails_to(client, "alice@example.com") if "смена email" in m.subject.lower()]
    assert len(warning) == 1 and "new.alice@example.com" in warning[0].text

    done = client.post("/api/auth/confirm-email-change", json={"token": link_token(confirm_mail[0])})

    assert done.status_code == 200 and done.json()["email"] == "new.alice@example.com"
    assert client.get("/api/auth/me").json()["email"] == "new.alice@example.com"
    client.cookies.clear()
    assert login(client, email="alice@example.com").status_code == 401
    assert login(client, email="new.alice@example.com").status_code == 200
    assert any("изменён" in m.subject.lower() for m in mails_to(client, "alice@example.com"))  # old address told


def test_email_change_token_is_single_use_and_expires(client) -> None:
    info = sign_in(client)
    client.post("/api/auth/change-email", headers=csrf_headers(info["csrf"]),
                json={"new_email": "second@example.com", "password": PASSWORD})
    token = link_token(mails_to(client, "second@example.com")[0])

    assert client.post("/api/auth/confirm-email-change", json={"token": token}).status_code == 200
    assert client.post("/api/auth/confirm-email-change", json={"token": token}).status_code == 400

    client.post("/api/auth/change-email", headers=csrf_headers(info["csrf"]),
                json={"new_email": "third@example.com", "password": PASSWORD})
    token2 = link_token(mails_to(client, "third@example.com")[0])
    for stored in client.auth_store.tokens:
        stored["expires_at"] = datetime.now(timezone.utc) - timedelta(seconds=1)
    assert client.post("/api/auth/confirm-email-change", json={"token": token2}).status_code == 400


def test_email_change_requires_the_password_and_a_free_address(client, login_as) -> None:
    login_as(2001)  # user2001@fixtures.example.com exists
    info = sign_in(client)
    headers = csrf_headers(info["csrf"])

    wrong = client.post("/api/auth/change-email", headers=headers, json={"new_email": "x@example.com", "password": "wrong password!"})
    taken = client.post("/api/auth/change-email", headers=headers, json={"new_email": "USER2001@fixtures.example.com", "password": PASSWORD})
    same = client.post("/api/auth/change-email", headers=headers, json={"new_email": "alice@example.com", "password": PASSWORD})
    invalid = client.post("/api/auth/change-email", headers=headers, json={"new_email": "nope", "password": PASSWORD})

    assert wrong.status_code == 403
    assert taken.status_code == 409 and taken.json()["error"]["code"] == "email_taken"
    assert same.status_code == 422 and invalid.status_code == 422


def test_email_taken_in_the_meantime_blocks_confirmation(client) -> None:
    info = sign_in(client)
    client.post("/api/auth/change-email", headers=csrf_headers(info["csrf"]),
                json={"new_email": "contested@example.com", "password": PASSWORD})
    token = link_token(mails_to(client, "contested@example.com")[0])
    client.auth_store.new_user(email="contested@example.com", email_verified_at=datetime.now(timezone.utc), password_hash="x")

    resp = client.post("/api/auth/confirm-email-change", json={"token": token})

    assert resp.status_code == 409
    assert client.get("/api/auth/me").json()["email"] == "alice@example.com"


def test_other_accounts_data_is_not_reachable_through_my_session(client, login_as) -> None:
    other_token = login_as(2002)
    other_id = client.get("/api/auth/me", headers={"Authorization": f"Bearer {other_token}"}).json()["id"]
    sign_in(client)

    # Players' profiles are visible only to coaches that share a team / booking.
    assert client.get(f"/api/players/{other_id}/profile").status_code == 403
    assert client.get(f"/api/players/{other_id}/reviews").status_code == 403
    # The user id is always taken from the session, never from the client.
    mine = client.get("/api/auth/me").json()["id"]
    assert mine != other_id
    assert sign_up is not None
