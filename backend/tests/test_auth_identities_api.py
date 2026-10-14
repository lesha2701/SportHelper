"""Linked external accounts (Yandex ID / VK ID groundwork): listing and unlinking."""
from __future__ import annotations

import asyncio

from app.services import identities as service
from app.services.identities import ExternalProfile
from tests.auth_helpers import csrf_headers, sign_in


def _link(client, user_email: str, profile: ExternalProfile) -> str:
    user = client.auth_store.find_by_email(user_email)
    return asyncio.run(service.link_identity(None, user["id"], profile))


def test_a_user_sees_only_their_own_linked_accounts(client, login_as) -> None:
    info = sign_in(client)
    _link(client, "alice@example.com", ExternalProfile("yandex", "Y-1", "a@yandex.ru", True, "Алиса"))
    login_as(8001)
    _link(client, "user8001@fixtures.example.com", ExternalProfile("vk", "V-1"))

    listed = client.get("/api/auth/identities").json()

    assert [i["provider"] for i in listed] == ["yandex"]
    assert listed[0]["display_name"] == "Алиса" and listed[0]["email"] == "a@yandex.ru"
    assert "provider_user_id" not in client.get("/api/auth/identities").text  # the external id isn't needed by the page
    assert info["csrf"]


def test_unlinking_needs_csrf_and_only_touches_the_callers_own_link(client) -> None:
    info = sign_in(client)
    _link(client, "alice@example.com", ExternalProfile("yandex", "Y-1"))

    assert client.delete("/api/auth/identities/yandex").status_code == 403  # no CSRF token
    ok = client.delete("/api/auth/identities/yandex", headers=csrf_headers(info["csrf"]))

    assert ok.status_code == 200 and client.get("/api/auth/identities").json() == []
    assert client.delete("/api/auth/identities/yandex", headers=csrf_headers(info["csrf"])).status_code == 404


def test_the_only_way_to_sign_in_cannot_be_removed(client) -> None:
    info = sign_in(client)
    user = client.auth_store.find_by_email("alice@example.com")
    user["password_hash"] = None  # an account that was created through a provider
    _link(client, "alice@example.com", ExternalProfile("yandex", "Y-1"))

    resp = client.delete("/api/auth/identities/yandex", headers=csrf_headers(info["csrf"]))

    assert resp.status_code == 409 and resp.json()["error"]["code"] == "last_login_method"
    assert len(client.get("/api/auth/identities").json()) == 1


def test_a_provider_created_account_can_set_a_password_through_recovery(client) -> None:
    from datetime import datetime, timezone

    user = client.auth_store.new_user(email="p@example.com", email_verified_at=datetime.now(timezone.utc), first_name="P")
    assert user["password_hash"] is None

    resp = client.post("/api/auth/forgot-password", json={"email": "p@example.com"})

    assert resp.status_code == 200
    assert any("восстановление" in m.subject.lower() for m in client.outbox if m.to == "p@example.com")


def test_identities_need_a_session(client) -> None:
    assert client.get("/api/auth/identities").status_code == 401
    assert client.delete("/api/auth/identities/yandex").status_code == 401
