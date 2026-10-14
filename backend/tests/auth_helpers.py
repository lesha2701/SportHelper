"""Shared helpers for the account/auth API tests."""
from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient

PASSWORD = "correct horse battery"  # a passphrase: no capitals/digits/symbols required
OTHER_PASSWORD = "another quiet harbour"


def register_payload(**overrides) -> dict:
    payload = {
        "first_name": "Алиса",
        "last_name": "Иванова",
        "email": "alice@example.com",
        "password": PASSWORD,
        "password_confirm": PASSWORD,
        "accept_terms": True,
        "role": "player",
    }
    payload.update(overrides)
    if "password" in overrides and "password_confirm" not in overrides:
        payload["password_confirm"] = overrides["password"]
    return payload


def link_token(mail) -> str:
    """The one-time token inside the first link of an outgoing email."""
    match = re.search(r"https?://\S+", mail.text)
    assert match, f"no link in email: {mail.text!r}"
    query = parse_qs(urlparse(match.group(0)).query)
    return query["token"][0]


def mails_to(client: TestClient, address: str) -> list:
    return [m for m in client.outbox if m.to == address]


def register(client: TestClient, **overrides):
    return client.post("/api/auth/register", json=register_payload(**overrides))


def verify_latest(client: TestClient, address: str) -> None:
    token = link_token(mails_to(client, address)[-1])
    resp = client.post("/api/auth/verify-email", json={"token": token})
    assert resp.status_code == 200, resp.text


def sign_up(client: TestClient, **overrides) -> dict:
    """Registers and verifies an account; returns the registration payload."""
    payload = register_payload(**overrides)
    resp = client.post("/api/auth/register", json=payload)
    assert resp.status_code == 201, resp.text
    verify_latest(client, resp.json()["email"])
    return payload


def login(client: TestClient, email: str = "alice@example.com", password: str = PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def sign_in(client: TestClient, **overrides) -> dict:
    """Sign up + log in with the cookie; returns {'csrf': ..., 'user': ...}."""
    payload = sign_up(client, **overrides)
    resp = login(client, payload["email"], payload["password"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return {"csrf": body["csrf_token"], "user": body, "payload": payload}


def csrf_headers(csrf: str) -> dict:
    return {"X-CSRF-Token": csrf}
