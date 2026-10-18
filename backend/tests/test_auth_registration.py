from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from tests.auth_helpers import (
    PASSWORD,
    link_token,
    login,
    mails_to,
    register,
    register_payload,
    sign_up,
    verify_latest,
)


def test_registration_creates_unverified_account_and_sends_one_email(client) -> None:
    resp = register(client)

    assert resp.status_code == 201
    assert resp.json() == {"email": "alice@example.com", "verification_sent": True}
    assert len(mails_to(client, "alice@example.com")) == 1
    user = client.auth_store.find_by_email("alice@example.com")
    assert user["email_verified_at"] is None
    assert user["first_name"] == "Алиса"
    assert user["preferred_role"] == "player"
    # Registration alone never signs anyone in.
    assert "set-cookie" not in resp.headers
    assert client.get("/api/auth/me").status_code == 401


def test_password_is_stored_only_as_an_argon2id_hash(client) -> None:
    register(client)

    stored = client.auth_store.find_by_email("alice@example.com")["password_hash"]
    assert stored.startswith("$argon2id$")
    assert PASSWORD not in stored


def test_same_password_gets_a_different_hash_each_time(client) -> None:
    register(client, email="a@example.com")
    register(client, email="b@example.com")

    hashes = {client.auth_store.find_by_email(e)["password_hash"] for e in ("a@example.com", "b@example.com")}
    assert len(hashes) == 2  # per-user random salt


def test_email_is_normalised_and_unique_ignoring_case(client) -> None:
    sign_up(client, email="Alice@Example.COM ")

    assert client.auth_store.find_by_email("alice@example.com") is not None
    duplicate = register(client, email="ALICE@example.com")

    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "email_taken"
    assert duplicate.json()["error"]["field"] == "email"
    assert len([u for u in client.auth_store.users.values() if u["email"]]) == 1


@pytest.mark.parametrize("bad", ["", "not-an-email", "a@", "@b.com", "a b@c.com", "x" * 300 + "@example.com"])
def test_invalid_email_is_rejected_with_a_field_error(client, bad) -> None:
    resp = register(client, email=bad)

    assert resp.status_code == 422
    assert resp.json()["error"]["field"] == "email"


@pytest.mark.parametrize(
    ("password", "code"),
    [
        ("short-pass1", "password_too_short"),  # 11 characters
        ("password1234", "password_common"),
        ("aaaaaaaaaaaaaaaa", "password_common"),
        ("qwertyuiop", "password_too_short"),
        ("x" * 600, "password_too_long"),
        ("            ", "password_blank"),
        ("alice@example.com", "password_personal"),
    ],
)
def test_weak_passwords_are_rejected(client, password, code) -> None:
    resp = register(client, password=password)

    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == code
    assert client.auth_store.find_by_email("alice@example.com") is None


def test_no_arbitrary_composition_rules_and_unicode_passphrases_work(client) -> None:
    # All lowercase letters, no digits, no symbols: accepted.
    assert register(client, email="a@example.com", password="tqzvxkwpmrnbs").status_code == 201
    # Spaces, Cyrillic, emoji: accepted, and long.
    assert register(client, email="b@example.com", password="Мой пароль — это целая фраза 🏐 и всё").status_code == 201
    assert register(client, email="c@example.com", password="long passphrase " * 20).status_code == 201


def test_passwords_must_match(client) -> None:
    resp = client.post("/api/auth/register", json=register_payload(password_confirm="different passphrase"))

    assert resp.status_code == 422
    assert resp.json()["error"]["field"] == "password_confirm"


def test_first_name_is_required_and_trimmed(client) -> None:
    assert register(client, first_name="   ").status_code == 422

    assert register(client, first_name="  Алиса   Мария ").status_code == 201
    assert client.auth_store.find_by_email("alice@example.com")["first_name"] == "Алиса Мария"


def test_consent_is_recorded(client) -> None:
    register(client)

    user = client.auth_store.find_by_email("alice@example.com")
    assert user["terms_accepted_at"] is not None
    assert user["terms_version"] == "2026-10-20"  # the edition of the agreement that was ticked


def test_verification_link_confirms_the_email_and_unlocks_login(client) -> None:
    register(client)
    before = login(client)
    assert before.status_code == 403
    assert before.json()["error"]["code"] == "email_not_verified"

    resp = client.post("/api/auth/verify-email", json={"token": link_token(mails_to(client, "alice@example.com")[0]), "password": PASSWORD})

    assert resp.status_code == 200
    assert resp.json() == {"verified": True, "email": "alice@example.com"}
    assert client.auth_store.find_by_email("alice@example.com")["email_verified_at"] is not None
    assert login(client).status_code == 200


def test_verification_token_is_single_use(client) -> None:
    register(client)
    token = link_token(mails_to(client, "alice@example.com")[0])

    assert client.post("/api/auth/verify-email", json={"token": token, "password": PASSWORD}).status_code == 200
    again = client.post("/api/auth/verify-email", json={"token": token, "password": PASSWORD})

    assert again.status_code == 400
    assert again.json()["error"]["code"] == "invalid_token"


def test_expired_verification_token_is_refused(client) -> None:
    register(client)
    token = link_token(mails_to(client, "alice@example.com")[0])
    for stored in client.auth_store.tokens:
        stored["expires_at"] = datetime.now(timezone.utc) - timedelta(seconds=1)

    resp = client.post("/api/auth/verify-email", json={"token": token, "password": PASSWORD})

    assert resp.status_code == 400
    assert client.auth_store.find_by_email("alice@example.com")["email_verified_at"] is None


def test_garbage_and_tampered_tokens_are_refused(client) -> None:
    register(client)
    token = link_token(mails_to(client, "alice@example.com")[0])

    for bad in ("", "nope", token[:-1] + ("A" if token[-1] != "A" else "B"), token + "x"):
        assert client.post("/api/auth/verify-email", json={"token": bad, "password": PASSWORD}).status_code == 400


def test_tokens_are_stored_hashed_never_in_clear(client) -> None:
    register(client)
    token = link_token(mails_to(client, "alice@example.com")[0])

    assert all(token not in stored["token_hash"] and len(stored["token_hash"]) == 64 for stored in client.auth_store.tokens)


def test_resend_sends_a_fresh_link_and_kills_the_old_one(client) -> None:
    register(client)
    first = link_token(mails_to(client, "alice@example.com")[0])

    resp = client.post("/api/auth/resend-verification", json={"email": "ALICE@example.com"})

    assert resp.status_code == 200
    assert len(mails_to(client, "alice@example.com")) == 2
    second = link_token(mails_to(client, "alice@example.com")[1])
    assert first != second
    assert client.post("/api/auth/verify-email", json={"token": first, "password": PASSWORD}).status_code == 400
    assert client.post("/api/auth/verify-email", json={"token": second, "password": PASSWORD}).status_code == 200


def test_resend_does_not_reveal_whether_an_address_exists(client) -> None:
    register(client)

    known = client.post("/api/auth/resend-verification", json={"email": "alice@example.com"})
    unknown = client.post("/api/auth/resend-verification", json={"email": "nobody@example.com"})
    garbage = client.post("/api/auth/resend-verification", json={"email": "not an email"})

    assert known.status_code == unknown.status_code == garbage.status_code == 200
    assert known.json() == unknown.json() == garbage.json()
    assert mails_to(client, "nobody@example.com") == []


def test_resend_is_a_no_op_for_a_verified_account(client) -> None:
    sign_up(client)
    sent_before = len(client.outbox)

    resp = client.post("/api/auth/resend-verification", json={"email": "alice@example.com"})

    assert resp.status_code == 200
    assert len(client.outbox) == sent_before


def test_reregistering_an_unconfirmed_email_replaces_the_old_attempt(client) -> None:
    register(client, password="first passphrase here")
    first_token = link_token(mails_to(client, "alice@example.com")[0])

    second = register(client, password="second passphrase there", first_name="Новое")

    assert second.status_code == 201
    assert len([u for u in client.auth_store.users.values() if u["email"]]) == 1  # no squatting, no duplicate
    assert client.post("/api/auth/verify-email", json={"token": first_token, "password": PASSWORD}).status_code == 400
    verify_latest(client, "alice@example.com", "second passphrase there")
    assert login(client, password="first passphrase here").status_code == 401
    assert login(client, password="second passphrase there").status_code == 200


def test_registration_is_rate_limited_per_ip(client, monkeypatch) -> None:
    from app.config import get_settings

    monkeypatch.setenv("AUTH_RATE_LIMIT_ENABLED", "true")
    get_settings.cache_clear()

    codes = [register(client, email=f"user{i}@example.com").status_code for i in range(12)]

    assert codes[:10] == [201] * 10
    assert codes[10:] == [429, 429]
    limited = register(client, email="late@example.com")
    assert limited.json()["error"]["code"] == "rate_limited"
    assert int(limited.headers["Retry-After"]) > 0


def test_verification_email_contains_the_site_link_and_no_password(client) -> None:
    register(client)

    mail = mails_to(client, "alice@example.com")[0]
    assert mail.text.count("http://localhost:5173/verify-email?token=") == 1
    assert PASSWORD not in mail.text and mail.html is not None and PASSWORD not in mail.html


def test_where_the_visitor_was_heading_survives_the_confirmation_email(client) -> None:
    resp = register(client, next="/?book=listing-42")
    assert resp.status_code == 201

    mail = mails_to(client, "alice@example.com")[0]
    assert "&next=%2F%3Fbook%3Dlisting-42" in mail.text
    assert mail.text.split("token=")[1].split("&")[0] == link_token(mail)

    client.post("/api/auth/resend-verification", json={"email": "alice@example.com", "next": "/coaches?listing=7"})
    assert "&next=%2Fcoaches%3Flisting%3D7" in mails_to(client, "alice@example.com")[1].text


@pytest.mark.parametrize(
    "hostile", ["https://evil.example/", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/ok\r\nX: y", "/<script>"]
)
def test_a_hostile_next_is_never_put_into_the_email(client, hostile) -> None:
    assert register(client, next=hostile).status_code == 201

    assert "next=" not in mails_to(client, "alice@example.com")[0].text


def test_an_oversized_next_is_rejected_outright(client) -> None:
    assert register(client, next="/" + "x" * 600).status_code == 422
