"""Shared helpers for the account/auth API tests."""
from __future__ import annotations

import re
import json
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient

PASSWORD = "correct horse battery"  # a passphrase: no capitals/digits/symbols required
OTHER_PASSWORD = "another quiet harbour"


def consents_for(role: str) -> list[dict]:
    """Every box the role must tick, with the documents/editions the form would report."""
    from app.services.legal import CONSENTS_BY_ROLE, DOCUMENTS

    return [
        {"key": consent.key, "documents": [{"key": key, "version": DOCUMENTS[key].version} for key in consent.documents]}
        for consent in CONSENTS_BY_ROLE[role]
    ]


def register_payload(**overrides) -> dict:
    payload = {
        "first_name": "Алиса",
        "last_name": "Иванова",
        "email": "alice@example.com",
        "password": PASSWORD,
        "password_confirm": PASSWORD,
        "role": "player",
    }
    payload.update(overrides)
    if "consents" not in payload:
        payload["consents"] = consents_for(payload["role"])
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
    return register_request(client, register_payload(**overrides))


def register_request(client: TestClient, payload: dict):
    if payload.get("role") == "coach":
        return client.post("/api/auth/register-coach", data={
            "payload": json.dumps(payload),
            "details": json.dumps({"sport": "Теннис", "qualification": "Лицензия тренера", "experience": "Три года работы", "about": "", "links": []}),
        }, files=[("documents", ("license.pdf", b"%PDF-1.4\nfixture", "application/pdf"))])
    return client.post("/api/auth/register", json=payload)


def verify_latest(client: TestClient, address: str, password: str = PASSWORD) -> None:
    """Confirms the address from the latest email, entering the registration password as the page asks."""
    token = link_token(mails_to(client, address)[-1])
    resp = client.post("/api/auth/verify-email", json={"token": token, "password": password})
    assert resp.status_code == 200, resp.text


def sign_up(client: TestClient, **overrides) -> dict:
    """Registers and verifies an account; returns the registration payload."""
    payload = register_payload(**overrides)
    resp = register_request(client, payload)
    assert resp.status_code == 201, resp.text
    verify_latest(client, resp.json()["email"], payload["password"])
    if payload["role"] == "coach":
        # Existing role tests exercise an approved coach; approval workflow has separate tests.
        if hasattr(client, "auth_store"):
            user = client.auth_store.find_by_email(payload["email"])
            client.auth_store.coach_applications[user["id"]]["status"] = "approved"
        else:
            import asyncio
            import asyncpg
            from app.config import get_settings
            async def approve():
                conn = await asyncpg.connect(get_settings().database_url)
                try:
                    await conn.execute("UPDATE coach_applications SET status='approved' WHERE user_id=(SELECT id FROM users WHERE email=$1)", payload["email"])
                finally:
                    await conn.close()
            asyncio.run(approve())
    return payload


def login(client: TestClient, email: str = "alice@example.com", password: str = PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def sign_in(client: TestClient, **overrides) -> dict:
    """Sign up + log in with the cookie; returns {'csrf': ..., 'user': ...}."""
    before = set(client.auth_store.sessions)
    payload = sign_up(client, **overrides)
    # Confirming the address already opened a session; start from the explicit login these tests are about.
    client.cookies.clear()
    for key in set(client.auth_store.sessions) - before:
        del client.auth_store.sessions[key]
    resp = login(client, payload["email"], payload["password"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return {"csrf": body["csrf_token"], "user": body, "payload": payload}


def csrf_headers(csrf: str) -> dict:
    return {"X-CSRF-Token": csrf}
