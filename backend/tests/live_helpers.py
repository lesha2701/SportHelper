"""Helpers for tests that drive the REAL application (real PostgreSQL, real sessions, real MFA) as people would:
one `Browser` per signed-in person, SQL for seeding/inspecting, and TOTP/recovery codes for administrators."""
from __future__ import annotations

import asyncio
from typing import Any

import asyncpg

from app.security import totp
from tests.auth_helpers import PASSWORD, consents_for, link_token


class Browser:
    """One person's browser: its own cookie jar and CSRF token on the shared test client."""

    def __init__(self, client, email: str, first_name: str, role: str | None = "player", *, password: str = PASSWORD):
        self.client, self.email, self.cookies, self.csrf, self.password = client, email, {}, "", password
        client.cookies.clear()
        role = role or "player"  # the role is required at registration
        payload = {"first_name": first_name, "email": email, "password": password, "password_confirm": password,
                   "role": role, "consents": consents_for(role)}
        assert client.post("/api/auth/register", json=payload).status_code == 201
        assert client.post("/api/auth/verify-email", json={"token": link_token(client.outbox[-1]), "password": password}).status_code == 200
        self.login()

    def login(self) -> "Browser":
        """A brand-new session (new cookie, no second factor passed yet)."""
        self.client.cookies.clear()
        login = self.client.post("/api/auth/login", json={"email": self.email, "password": self.password})
        assert login.status_code == 200, login.text
        self.csrf = login.json()["csrf_token"]
        self.user_id = login.json()["id"]
        self.cookies = dict(self.client.cookies)
        return self

    def call(self, method: str, path: str, **kwargs):
        self.client.cookies.clear()
        for name, value in self.cookies.items():
            self.client.cookies.set(name, value)
        headers = {"X-CSRF-Token": self.csrf} if method != "GET" else {}
        headers.update(kwargs.pop("headers", {}))
        return self.client.request(method, path, headers=headers, **kwargs)

    def ok(self, method: str, path: str, **kwargs):
        response = self.call(method, path, **kwargs)
        assert response.status_code in (200, 201, 204), f"{method} {path} -> {response.status_code}: {response.text}"
        return response.json() if response.content else None


class AdminBrowser(Browser):
    """An administrator: enrols the second factor once, then unlocks every new session with a recovery code
    (TOTP codes can only be used once per 30-second step, which makes long scenarios flaky)."""

    secret: str = ""
    recovery_codes: list[str]

    def enable_mfa(self) -> "AdminBrowser":
        setup = self.call("POST", "/api/auth/mfa/setup", json={"password": self.password})
        assert setup.status_code == 200, setup.text
        self.secret = setup.json()["secret"]
        enabled = self.call("POST", "/api/auth/mfa/enable", json={"code": totp._hotp(self.secret, totp.current_step())})
        assert enabled.status_code == 200, enabled.text
        self.recovery_codes = enabled.json()["recovery_codes"]
        return self

    def unlock(self) -> "AdminBrowser":
        """Passes the second factor in the CURRENT session with a (single-use) recovery code."""
        response = self.call("POST", "/api/auth/mfa/verify", json={"code": self.recovery_codes.pop(0)})
        assert response.status_code == 200, response.text
        return self

    def fresh_session(self) -> "AdminBrowser":
        """Signs in again (a new session that has not passed the second factor)."""
        self.login()
        return self

    def fresh_unlocked_session(self) -> "AdminBrowser":
        return self.fresh_session().unlock()


def sql(dsn: str, query: str, *args: Any) -> list[asyncpg.Record]:
    async def run():
        conn = await asyncpg.connect(dsn)
        try:
            return await conn.fetch(query, *args)
        finally:
            await conn.close()

    return asyncio.run(run())


def sql_value(dsn: str, query: str, *args: Any) -> Any:
    rows = sql(dsn, query, *args)
    return rows[0][0] if rows else None
