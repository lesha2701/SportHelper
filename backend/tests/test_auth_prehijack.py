"""Pre-hijacking: someone registers a victim's address with a password of their
own and waits for the victim to confirm it. Confirming must never activate that
password; and the normal sign-up must keep working."""
from __future__ import annotations

from tests.auth_helpers import OTHER_PASSWORD, PASSWORD, link_token, login, mails_to, register

VICTIM = "victim@example.com"
ATTACKER_PASSWORD = "attacker chosen passphrase"


def _token(client, address: str = VICTIM) -> str:
    return link_token(mails_to(client, address)[-1])


def _verify(client, token: str, password: str):
    return client.post("/api/auth/verify-email", json={"token": token, "password": password})


def _set_password(client, token: str, password: str, confirm: str | None = None):
    return client.post("/api/auth/verify-email/set-password",
                       json={"token": token, "password": password, "password_confirm": confirm or password})


# --- the attack ----------------------------------------------------------------------------------


def test_the_victim_clicking_confirm_does_not_activate_the_attackers_password(client) -> None:
    assert register(client, email=VICTIM, password=ATTACKER_PASSWORD, first_name="Attacker").status_code == 201
    token = _token(client)  # lands in the VICTIM's mailbox

    # The victim opens the link and cannot supply a password they never chose.
    wrong = _verify(client, token, "whatever the victim might type")

    assert wrong.status_code == 403 and wrong.json()["error"]["code"] == "password_mismatch"
    assert client.auth_store.find_by_email(VICTIM)["email_verified_at"] is None  # still not active
    assert login(client, email=VICTIM, password=ATTACKER_PASSWORD).status_code == 403  # attacker can't sign in either


def test_the_victim_can_take_the_account_by_setting_their_own_password_and_the_attackers_dies(client) -> None:
    register(client, email=VICTIM, password=ATTACKER_PASSWORD)
    token = _token(client)

    done = _set_password(client, token, OTHER_PASSWORD)

    assert done.status_code == 200 and done.json()["verified"] is True
    assert login(client, email=VICTIM, password=ATTACKER_PASSWORD).status_code == 401  # the attacker's password no longer works
    assert login(client, email=VICTIM, password=OTHER_PASSWORD).status_code == 200


def test_the_attacker_gains_nothing_without_the_mailbox(client) -> None:
    register(client, email=VICTIM, password=ATTACKER_PASSWORD)

    # They know the password but not the link, so they can neither confirm nor set a new password.
    for guess in ("", "x" * 40, "AAAA" * 20):
        assert _verify(client, guess, ATTACKER_PASSWORD).status_code == 400
        assert _set_password(client, guess, OTHER_PASSWORD).status_code == 400
    assert login(client, email=VICTIM, password=ATTACKER_PASSWORD).status_code == 403


def test_a_mismatch_does_not_burn_the_link_so_the_owner_can_still_use_it(client) -> None:
    register(client, email=VICTIM, password=ATTACKER_PASSWORD)
    token = _token(client)

    assert _verify(client, token, "nope nope nope nope").status_code == 403
    assert _verify(client, token, "still not it, sorry").status_code == 403

    assert _set_password(client, token, OTHER_PASSWORD).status_code == 200


def test_the_real_owner_registering_after_the_attacker_takes_over_the_attempt(client) -> None:
    register(client, email=VICTIM, password=ATTACKER_PASSWORD, first_name="Attacker")
    attacker_link = _token(client)

    assert register(client, email=VICTIM, password=PASSWORD, first_name="Victim").status_code == 201

    assert _verify(client, attacker_link, ATTACKER_PASSWORD).status_code == 400  # the attacker's link is dead
    assert _verify(client, _token(client), ATTACKER_PASSWORD).status_code == 403  # and so is their password
    assert _verify(client, _token(client), PASSWORD).status_code == 200
    assert login(client, email=VICTIM, password=ATTACKER_PASSWORD).status_code == 401
    assert login(client, email=VICTIM, password=PASSWORD).json()["first_name"] == "Victim"


def test_forgot_password_on_a_hijacked_registration_leads_to_setting_a_new_one(client) -> None:
    register(client, email=VICTIM, password=ATTACKER_PASSWORD)
    client.post("/api/auth/forgot-password", json={"email": VICTIM})  # the victim notices something is off

    assert _set_password(client, _token(client), OTHER_PASSWORD).status_code == 200
    assert login(client, email=VICTIM, password=ATTACKER_PASSWORD).status_code == 401


# --- normal sign-up still works -------------------------------------------------------------------


def test_normal_sign_up_confirms_with_the_password_just_typed(client) -> None:
    assert register(client).status_code == 201

    assert _verify(client, _token(client, "alice@example.com"), PASSWORD).status_code == 200
    assert login(client).status_code == 200


def test_the_confirmation_page_can_describe_the_link_without_spending_it(client) -> None:
    register(client)
    token = _token(client, "alice@example.com")

    first = client.post("/api/auth/verify-email/inspect", json={"token": token}).json()
    second = client.post("/api/auth/verify-email/inspect", json={"token": token}).json()

    assert first == second == {"valid": True, "email": "a***e@example.com", "first_name": "Алиса"}
    assert _verify(client, token, PASSWORD).status_code == 200  # still unspent
    assert client.post("/api/auth/verify-email/inspect", json={"token": token}).json()["valid"] is False
    assert client.post("/api/auth/verify-email/inspect", json={"token": "garbage"}).json() == {
        "valid": False, "email": None, "first_name": None}


def test_a_new_password_must_pass_the_same_policy(client) -> None:
    register(client, email=VICTIM, password=ATTACKER_PASSWORD)
    token = _token(client)

    assert _set_password(client, token, "short").status_code == 422
    assert _set_password(client, token, "password1234").status_code == 422
    assert _set_password(client, token, OTHER_PASSWORD, "different one entirely").status_code == 422
    assert _set_password(client, token, VICTIM).status_code == 422  # not the e-mail itself
    assert _set_password(client, token, OTHER_PASSWORD).status_code == 200  # the link survived the refusals


def test_confirmation_links_are_still_single_use_and_expire(client) -> None:
    from datetime import datetime, timedelta, timezone

    register(client)
    token = _token(client, "alice@example.com")
    assert _verify(client, token, PASSWORD).status_code == 200
    assert _verify(client, token, PASSWORD).status_code == 400
    assert _set_password(client, token, OTHER_PASSWORD).status_code == 400

    register(client, email="late@example.com")
    late = _token(client, "late@example.com")
    for stored in client.auth_store.tokens:
        stored["expires_at"] = datetime.now(timezone.utc) - timedelta(seconds=1)
    assert _verify(client, late, PASSWORD).status_code == 400
    assert _set_password(client, late, OTHER_PASSWORD).status_code == 400


def test_password_guesses_on_a_confirmation_link_are_throttled(client, monkeypatch) -> None:
    from app.config import get_settings

    register(client, email=VICTIM, password=ATTACKER_PASSWORD)
    token = _token(client)
    monkeypatch.setenv("AUTH_RATE_LIMIT_ENABLED", "true")
    get_settings.cache_clear()

    codes = [_verify(client, token, f"guess number {n}").status_code for n in range(10)]

    assert codes[:8] == [403] * 8 and codes[8:] == [429, 429]


def test_an_account_registered_by_a_claimed_telegram_user_needs_the_same_proof(client) -> None:
    from tests.test_auth_migration import _claim_body, _claim_token_from_bot, _legacy_user

    legacy = _legacy_user(client)
    claim = _claim_token_from_bot(client, legacy)
    client.post("/api/auth/claim", json=_claim_body(claim))
    token = _token(client, "petr@example.com")

    assert _verify(client, token, "not the claim password").status_code == 403
    assert _verify(client, token, PASSWORD).status_code == 200
