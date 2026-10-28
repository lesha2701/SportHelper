"""Moving existing (Telegram-era) accounts to email + password, and linking
Telegram back as an optional notification channel."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from app.config import get_settings
from app.repositories import accounts as accounts_repo
from app.security.tokens import hash_token
from app.services import claim as claim_service
from tests.test_teams_api import _create_coach_profile, _create_team
from tests.auth_helpers import (
    PASSWORD,
    csrf_headers,
    link_token,
    login,
    mails_to,
    register,
    sign_in,
    sign_up,
    verify_latest,
)


def _legacy_user(client, telegram_id: int = 777, first_name: str = "Пётр"):
    """What an account created through the old Telegram login looks like:
    no email, no password, but a Telegram id (and, below, real data)."""
    return client.auth_store.new_user(telegram_id=telegram_id, first_name=first_name, username="petr", active_mode="player")


def _claim_token_from_bot(client, user) -> str:
    return asyncio.run(claim_service.issue_claim_token(None, client.auth_store.user_view(user), get_settings()))


def _claim_body(token: str, **overrides) -> dict:
    body = {"token": token, "email": "petr@example.com", "password": PASSWORD, "password_confirm": PASSWORD, "accept_terms": True}
    body.update(overrides)
    return body


def test_legacy_account_cannot_log_in_without_an_email_and_password(client) -> None:
    _legacy_user(client)

    assert login(client, email="petr@example.com").status_code == 401


def test_bot_issues_a_claim_link_only_for_unmigrated_accounts(client) -> None:
    legacy = client.auth_store.user_view(_legacy_user(client))
    migrated = client.auth_store.user_view(
        client.auth_store.new_user(telegram_id=888, email="x@example.com", email_verified_at=datetime.now(timezone.utc))
    )
    banned = client.auth_store.user_view(client.auth_store.new_user(telegram_id=889, is_banned=True))

    assert claim_service.is_claimable(legacy)
    assert not claim_service.is_claimable(migrated) and not claim_service.is_claimable(banned)
    assert not claim_service.is_claimable(None)


def test_claim_keeps_the_same_account_and_all_its_data(client) -> None:
    legacy = _legacy_user(client)
    original_id = str(legacy["id"])
    # (Data created back in the Telegram days is set up in the next test.)
    token = _claim_token_from_bot(client, legacy)

    inspect = client.post("/api/auth/claim/inspect", json={"token": token})
    assert inspect.json() == {"valid": True, "first_name": "Пётр"}

    resp = client.post("/api/auth/claim", json=_claim_body(token))
    assert resp.status_code == 200 and resp.json()["email"] == "petr@example.com"
    # The email is NOT attached until its owner confirms it...
    assert legacy["email"] is None
    assert login(client, email="petr@example.com").status_code == 401
    verify_latest(client, "petr@example.com")

    # ...after which the very same user (same id, same Telegram) can sign in.
    signed_in = login(client, email="petr@example.com")
    assert signed_in.status_code == 200
    assert signed_in.json()["id"] == original_id
    assert legacy["telegram_id"] == 777 and legacy["active_mode"] == "player"
    assert legacy["terms_accepted_at"] is not None
    assert len(client.auth_store.users) == 1  # nothing was created or merged


def test_claimed_account_keeps_its_profiles_and_relations(client) -> None:
    legacy = _legacy_user(client)
    legacy_token = "legacy-session"
    # A session for the legacy row stands in for the old Telegram login, so we can create data under it.
    from app.security.tokens import hash_token as h
    from uuid import uuid4

    sid = uuid4()
    client.auth_store.sessions[sid] = {
        "id": sid, "user_id": legacy["id"], "token_hash": h(legacy_token), "created_at": datetime.now(timezone.utc),
        "last_seen_at": datetime.now(timezone.utc), "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "revoked_at": None, "mfa_verified_at": None, "user_agent": None, "ip_address": None,
    }
    _create_coach_profile(client, legacy_token)
    _create_team(client, legacy_token, name="Ястребы")
    client.auth_store.sessions.pop(sid)

    token = _claim_token_from_bot(client, legacy)
    client.post("/api/auth/claim", json=_claim_body(token))
    verify_latest(client, "petr@example.com")
    login(client, email="petr@example.com")

    me_profile = client.get("/api/profile/me").json()
    assert me_profile["coach"]["full_name"] == "Coach"
    teams = client.get("/api/teams/mine").json()
    assert [t["name"] for t in teams] == ["Ястребы"]


def test_claim_token_is_single_use(client) -> None:
    legacy = _legacy_user(client)
    token = _claim_token_from_bot(client, legacy)

    assert client.post("/api/auth/claim", json=_claim_body(token)).status_code == 200
    again = client.post("/api/auth/claim", json=_claim_body(token, email="other@example.com"))

    assert again.status_code == 400 and again.json()["error"]["code"] == "invalid_token"
    assert client.post("/api/auth/claim/inspect", json={"token": token}).json() == {"valid": False, "first_name": None}


def test_claim_token_expires(client) -> None:
    legacy = _legacy_user(client)
    token = _claim_token_from_bot(client, legacy)
    for stored in client.auth_store.tokens:
        stored["expires_at"] = datetime.now(timezone.utc) - timedelta(seconds=1)

    assert client.post("/api/auth/claim/inspect", json={"token": token}).json()["valid"] is False
    assert client.post("/api/auth/claim", json=_claim_body(token)).status_code == 400


def test_a_new_bot_link_replaces_the_previous_one(client) -> None:
    legacy = _legacy_user(client)
    first = _claim_token_from_bot(client, legacy)
    second = _claim_token_from_bot(client, legacy)

    assert client.post("/api/auth/claim", json=_claim_body(first)).status_code == 400
    assert client.post("/api/auth/claim", json=_claim_body(second)).status_code == 200


def test_claim_cannot_take_an_address_that_belongs_to_someone_else(client) -> None:
    sign_up(client, email="petr@example.com")  # a registered user already owns it
    legacy = _legacy_user(client)
    token = _claim_token_from_bot(client, legacy)

    resp = client.post("/api/auth/claim", json=_claim_body(token))

    assert resp.status_code == 409 and resp.json()["error"]["code"] == "email_taken"
    # The link was not burnt by the failed attempt: the owner can retry with another address.
    assert client.post("/api/auth/claim", json=_claim_body(token, email="petr.new@example.com")).status_code == 200


def test_claim_validates_the_password_terms_and_email(client) -> None:
    token = _claim_token_from_bot(client, _legacy_user(client))

    assert client.post("/api/auth/claim", json=_claim_body(token, password="short", password_confirm="short")).status_code == 422
    assert client.post("/api/auth/claim", json=_claim_body(token, accept_terms=False)).status_code == 422
    assert client.post("/api/auth/claim", json=_claim_body(token, email="nope")).status_code == 422
    assert client.post("/api/auth/claim", json=_claim_body(token, password_confirm="different thing")).status_code == 422
    assert client.post("/api/auth/claim", json=_claim_body(token)).status_code == 200  # still usable after the mistakes


def test_nobody_else_can_claim_a_migrated_account(client) -> None:
    legacy = _legacy_user(client)
    token = _claim_token_from_bot(client, legacy)
    client.post("/api/auth/claim", json=_claim_body(token))
    verify_latest(client, "petr@example.com")

    stale = _claim_token_from_bot(client, legacy)  # even a fresh token can't re-claim a verified account
    assert client.post("/api/auth/claim/inspect", json={"token": stale}).json()["valid"] is False
    assert client.post("/api/auth/claim", json=_claim_body(stale, email="thief@example.com")).status_code == 400


def test_accounts_are_never_merged_by_name_or_unverified_email(client) -> None:
    legacy = _legacy_user(client, first_name="Алиса")

    register(client)  # a different person who is also called Алиса

    users = [u for u in client.auth_store.users.values()]
    assert len(users) == 2 and {u["id"] for u in users} != {legacy["id"]}
    assert legacy["email"] is None


def test_no_account_gets_a_default_or_shared_password(client) -> None:
    _legacy_user(client, 1)
    _legacy_user(client, 2)

    assert all(u["password_hash"] is None for u in client.auth_store.users.values())


# --- Telegram as an optional notification channel ------------------------------------


def test_website_user_can_link_and_unlink_telegram(client) -> None:
    info = sign_in(client)
    headers = csrf_headers(info["csrf"])

    started = client.post("/api/auth/telegram/link", headers=headers)
    assert started.status_code == 200
    assert started.json()["bot_url"].startswith("https://t.me/TestFlowBot?start=link_")
    token = started.json()["bot_url"].split("start=link_")[1]

    # What the bot does once the user taps "confirm":
    status, user = asyncio.run(accounts_repo.link_telegram(None, hash_token(token), 424242, "alice_tg"))
    assert status == "ok" and user["telegram_id"] == 424242
    assert client.get("/api/auth/me").json()["telegram_linked"] is True
    # The token is single-use.
    assert asyncio.run(accounts_repo.link_telegram(None, hash_token(token), 424242, "x"))[0] == "invalid"

    client.post("/api/auth/telegram/unlink", headers=headers)
    assert client.get("/api/auth/me").json()["telegram_linked"] is False


def test_a_telegram_account_cannot_be_linked_to_two_users(client) -> None:
    client.auth_store.new_user(telegram_id=424242, email="owner@example.com", email_verified_at=datetime.now(timezone.utc))
    info = sign_in(client)
    token = client.post("/api/auth/telegram/link", headers=csrf_headers(info["csrf"])).json()["bot_url"].split("start=link_")[1]

    status, _ = asyncio.run(accounts_repo.link_telegram(None, hash_token(token), 424242, None))

    assert status == "telegram_taken"
    assert client.get("/api/auth/me").json()["telegram_linked"] is False


def test_telegram_linking_is_unavailable_without_a_bot_and_requires_login(client, monkeypatch) -> None:
    assert client.post("/api/auth/telegram/link").status_code == 401

    monkeypatch.setenv("TELEGRAM_BOT_USERNAME", "")
    get_settings.cache_clear()
    info = sign_in(client)
    assert client.post("/api/auth/telegram/link", headers=csrf_headers(info["csrf"])).status_code == 503


def test_telegram_switched_off_blocks_linking_even_when_the_bot_is_configured(client, monkeypatch) -> None:
    monkeypatch.setenv("TELEGRAM_ENABLED", "false")
    get_settings.cache_clear()
    info = sign_in(client)

    response = client.post("/api/auth/telegram/link", headers=csrf_headers(info["csrf"]))

    assert response.status_code == 503


def test_telegram_is_off_unless_explicitly_enabled() -> None:
    from app.config import Settings

    assert Settings(_env_file=None, TELEGRAM_BOT_TOKEN="1:abc").telegram_active is False  # token alone is not enough
    assert Settings(_env_file=None, TELEGRAM_ENABLED=True).telegram_active is False  # nor is the flag alone
    assert Settings(_env_file=None, TELEGRAM_ENABLED=True, TELEGRAM_BOT_TOKEN="1:abc").telegram_active is True


def test_the_site_works_without_telegram_configured(client, monkeypatch) -> None:
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "")
    monkeypatch.setenv("TELEGRAM_BOT_USERNAME", "")
    get_settings.cache_clear()

    info = sign_in(client)

    assert client.get("/api/auth/me").status_code == 200 and info["csrf"]


def test_bot_names_the_account_a_telegram_link_would_attach_to(client) -> None:
    info = sign_in(client)
    token = client.post("/api/auth/telegram/link", headers=csrf_headers(info["csrf"])).json()["bot_url"].split("start=link_")[1]

    label = asyncio.run(claim_service.owner_of_link_token(None, token))

    assert label == "a***e@example.com"  # recognisable to the owner, not a full address leak
    assert asyncio.run(claim_service.owner_of_link_token(None, "not-a-token")) is None


def test_email_masking_handles_short_names() -> None:
    assert claim_service.mask_email("ab@x.ru") == "a***@x.ru"
    assert claim_service.mask_email("alice@example.com") == "a***e@example.com"


def test_the_site_learns_from_the_server_whether_telegram_is_offered(client, monkeypatch) -> None:
    assert client.get("/api/features").json()["telegram"] is True  # no login needed

    monkeypatch.setenv("TELEGRAM_ENABLED", "false")
    get_settings.cache_clear()
    assert client.get("/api/features").json()["telegram"] is False

    monkeypatch.setenv("TELEGRAM_ENABLED", "true")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "")
    get_settings.cache_clear()
    assert client.get("/api/features").json()["telegram"] is False  # enabled but not configured
