"""Bearer tokens, client IPs behind a proxy, rate-limit bypasses, log/response hygiene."""
from __future__ import annotations

import io
import logging
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.config import Settings, get_settings, production_problems
from app.core.logging import RedactingFilter, redact
from app.security.client import client_address, client_ip, rate_limit_key
from tests.auth_helpers import PASSWORD, csrf_headers, login, register, sign_in, sign_up


class _FromPeer:
    """ASGI wrapper that sets the TCP peer (`request.client`) the app sees."""

    def __init__(self, app, peer: tuple[str, int]):
        self.app, self.peer = app, peer

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            scope = {**scope, "client": self.peer}
        await self.app(scope, receive, send)


def _app_client(monkeypatch, *, peer: tuple[str, int] = ("127.0.0.1", 50000), **env) -> TestClient:
    """A fresh app (and TestClient with a chosen TCP peer) under different settings,
    reusing the fake repositories the `client` fixture already installed."""
    import app.api.deps as deps
    import app.main as main_module

    for key, value in env.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()
    app = main_module.create_app()

    async def no_db():
        yield None

    app.dependency_overrides[deps.get_db] = no_db
    return TestClient(_FromPeer(app, peer))


def _request(peer: str | None, forwarded: str | None = None) -> Request:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded is not None else []
    scope = {"type": "http", "method": "GET", "path": "/", "headers": headers, "client": (peer, 1234) if peer else None}
    return Request(scope)


def _settings(**env) -> Settings:
    return Settings(_env_file=None, **env)


# --- Bearer ----------------------------------------------------------------------------------------


def test_bearer_is_ignored_unless_explicitly_enabled(client, login_as, monkeypatch) -> None:
    token = login_as(7001)
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200  # suite default: on

    with _app_client(monkeypatch, BEARER_AUTH_ENABLED="false") as locked:
        assert locked.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401
        assert locked.get("/api/profile/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_cookie_login_keeps_working_when_bearer_is_off(client, monkeypatch) -> None:
    sign_up(client)

    with _app_client(monkeypatch, BEARER_AUTH_ENABLED="false") as locked:
        resp = locked.post("/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD})
        assert resp.status_code == 200
        assert locked.get("/api/auth/me").status_code == 200  # the cookie, not a header


def test_a_bearer_session_cannot_be_used_to_skip_csrf_for_cookie_requests(client, monkeypatch) -> None:
    info = sign_in(client)
    cookie = client.cookies.get("sag_session")

    with _app_client(monkeypatch, BEARER_AUTH_ENABLED="false") as locked:
        locked.cookies.set("sag_session", cookie)
        # Sending the token as a (now ignored) bearer header must not turn the request into a "no CSRF needed" one.
        resp = locked.post("/api/profile/active-mode", json={"mode": "player"}, headers={"Authorization": f"Bearer {cookie}"})
        assert resp.status_code == 403 and resp.json()["error"]["code"] == "csrf_failed"
        ok = locked.post("/api/profile/active-mode", json={"mode": "player"}, headers=csrf_headers(info["csrf"]))
        assert ok.status_code == 409  # authenticated and past CSRF ("create the profile first")


def test_the_server_never_hands_the_session_token_to_page_scripts(client) -> None:
    info = sign_in(client)
    token = client.cookies.get("sag_session")

    for response in (client.get("/api/auth/me"), client.get("/api/auth/sessions"), login(client)):
        assert token not in response.text
    assert info["csrf"] != token and token not in info["csrf"]
    assert "HttpOnly" in login(client).headers["set-cookie"]


def test_session_listing_exposes_ids_not_tokens(client) -> None:
    sign_in(client)
    token = client.cookies.get("sag_session")

    listing = client.get("/api/auth/sessions").text

    assert token not in listing and "token" not in listing.lower()


# --- API docs ----------------------------------------------------------------------------------------


_PROD_ENV = dict(JWT_SECRET="p" * 40, APP_BASE_URL="https://sportarenaglobal.ru", CORS_ORIGINS="https://sportarenaglobal.ru")


def test_swagger_is_off_in_production_and_on_in_the_sandbox(client, monkeypatch) -> None:
    with _app_client(monkeypatch, APP_MODE="main", **_PROD_ENV) as prod:
        assert [prod.get(p).status_code for p in ("/docs", "/redoc", "/openapi.json")] == [404, 404, 404]
    with _app_client(monkeypatch, APP_MODE="sandbox") as dev:
        assert [dev.get(p).status_code for p in ("/docs", "/openapi.json")] == [200, 200]
    with _app_client(monkeypatch, APP_MODE="main", API_DOCS_ENABLED="true", **_PROD_ENV) as forced:
        assert forced.get("/openapi.json").status_code == 200


# --- response headers ---------------------------------------------------------------------------------


def test_responses_carry_hardening_headers_and_account_data_is_never_cached(client) -> None:
    sign_in(client)

    me = client.get("/api/auth/me")
    health = client.get("/api/health")

    assert me.headers["cache-control"] == "no-store"
    for response in (me, health):
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["x-frame-options"] == "DENY"
        assert response.headers["referrer-policy"] == "no-referrer"


# --- logs ------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "secret"),
    [
        ("GET /verify-email?token=AbCdEf0123456789xyz HTTP/1.1", "AbCdEf0123456789xyz"),
        ("headers: Authorization: Bearer 0123456789abcdefghijkl", "0123456789abcdefghijkl"),
        ("Cookie: __Host-sag_session=Zm9vYmFyMTIzNDU2Nzg5; theme=dark", "Zm9vYmFyMTIzNDU2Nzg5"),
        ("Cookie: sag_session=Zm9vYmFyMTIzNDU2Nzg5", "Zm9vYmFyMTIzNDU2Nzg5"),
        ('body {"password": "hunter2hunter2", "email": "a@b.co"}', "hunter2hunter2"),
        ("X-CSRF-Token: 0123456789abcdef0123456789abcdef", "0123456789abcdef0123456789abcdef"),
        ("token=AbCdEf0123456789xyz&next=/", "AbCdEf0123456789xyz"),
    ],
)
def test_secrets_are_masked_wherever_they_show_up_in_a_log_line(raw, secret) -> None:
    assert secret not in redact(raw)
    assert "[redacted]" in redact(raw)


def test_ordinary_log_lines_are_untouched() -> None:
    line = "Applying patch 0031_web_auth.sql (version 31) for user alice@example.com"
    assert redact(line) == line


def test_the_logging_filter_masks_tokens_in_every_handler_output() -> None:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.addFilter(RedactingFilter())
    log = logging.getLogger("test.redaction")
    log.addHandler(handler)
    log.propagate = False
    try:
        log.error("request failed: GET /api/x?token=%s with Bearer %s", "tok_SECRETSECRET123", "bear_SECRETSECRET123456")
    finally:
        log.removeHandler(handler)

    assert "SECRETSECRET" not in stream.getvalue() and "[redacted]" in stream.getvalue()


def test_the_development_email_printout_keeps_its_link_but_only_outside_production() -> None:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.addFilter(RedactingFilter())
    log = logging.getLogger("test.devmail")
    log.addHandler(handler)
    log.propagate = False
    try:
        log.warning("link: http://x/verify-email?token=DEVLINKTOKEN123456", extra={"devmail": True})
    finally:
        log.removeHandler(handler)

    assert "DEVLINKTOKEN123456" in stream.getvalue()


async def test_in_production_without_smtp_the_message_body_is_never_logged(caplog) -> None:
    from app.services.email import OutgoingEmail, send_email

    settings = _settings(APP_MODE="main", SMTP_HOST="")
    with caplog.at_level(logging.DEBUG):
        sent = await send_email(OutgoingEmail("a@b.co", "Тема", "http://x/verify-email?token=PRODSECRET123456"), settings)

    assert sent is False
    assert "PRODSECRET" not in caplog.text and "NOT sent" in caplog.text


# --- client IP behind a reverse proxy ------------------------------------------------------------------------


def test_forwarded_header_is_ignored_unless_proxy_trust_is_on() -> None:
    settings = _settings(TRUST_PROXY_HEADERS="false")
    assert client_ip(_request("172.18.0.5", "203.0.113.9"), settings) == "172.18.0.5"


def test_forwarded_header_is_believed_only_from_a_trusted_proxy() -> None:
    settings = _settings(TRUST_PROXY_HEADERS="true")

    assert client_ip(_request("172.18.0.5", "203.0.113.9"), settings) == "203.0.113.9"  # docker network: Caddy
    # A direct connection from the internet cannot claim to be someone else.
    assert client_ip(_request("198.51.100.77", "1.2.3.4"), settings) == "198.51.100.77"


def test_a_visitor_cannot_choose_their_own_address_by_prepending_to_the_header() -> None:
    settings = _settings(TRUST_PROXY_HEADERS="true")
    # Caddy appends the address it saw; whatever the visitor sent stays further left.
    request = _request("172.18.0.5", "9.9.9.9, 8.8.8.8, 203.0.113.9")

    assert client_ip(request, settings) == "203.0.113.9"
    assert rate_limit_key(request, settings) == "203.0.113.9"


def test_trusted_proxies_in_the_chain_are_skipped() -> None:
    settings = _settings(TRUST_PROXY_HEADERS="true")

    assert client_ip(_request("172.18.0.5", "203.0.113.9, 10.0.0.7"), settings) == "203.0.113.9"


@pytest.mark.parametrize("junk", ["", "garbage", "999.1.1.1", "203.0.113.9; DROP TABLE users", "<script>"])
def test_malformed_forwarded_values_are_never_used_as_an_identity(junk) -> None:
    settings = _settings(TRUST_PROXY_HEADERS="true")

    assert client_ip(_request("172.18.0.5", junk), settings) == "172.18.0.5"


def test_an_ipv6_visitor_is_counted_per_64_so_rotating_addresses_does_not_dodge_limits() -> None:
    settings = _settings(TRUST_PROXY_HEADERS="true")
    a = rate_limit_key(_request("172.18.0.5", "2001:db8:1:2::1"), settings)
    b = rate_limit_key(_request("172.18.0.5", "2001:db8:1:2:ffff:ffff:ffff:ffff"), settings)
    other = rate_limit_key(_request("172.18.0.5", "2001:db8:1:3::1"), settings)

    assert a == b == "2001:db8:1:2::/64" and other != a
    assert client_ip(_request("172.18.0.5", "2001:db8:1:2::1"), settings) == "2001:db8:1:2::1"  # the session keeps the full address


def test_the_proxy_list_is_configurable_and_a_missing_peer_is_safe() -> None:
    settings = _settings(TRUST_PROXY_HEADERS="true", TRUSTED_PROXY_CIDRS="203.0.113.0/24")

    assert client_ip(_request("203.0.113.5", "198.51.100.8"), settings) == "198.51.100.8"
    assert client_ip(_request("172.18.0.5", "198.51.100.8"), settings) == "172.18.0.5"  # no longer trusted
    assert client_address(_request(None), settings) is None and client_ip(_request(None), settings) == "unknown"


# --- rate limits cannot be dodged ----------------------------------------------------------------------------------


def test_the_global_limiter_cannot_be_dodged_with_fake_or_rotating_session_tokens(client, monkeypatch) -> None:
    with _app_client(monkeypatch, RATE_LIMIT_PER_MINUTE="5") as limited:
        codes = []
        for n in range(9):  # every request carries a different bogus token / cookie
            codes.append(limited.get("/api/teams/mine", headers={"Authorization": f"Bearer fake-token-{n}"}).status_code)
        for n in range(3):
            limited.cookies.set("sag_session", f"fake-cookie-{n}")
            codes.append(limited.get("/api/teams/mine").status_code)

    assert codes[:5] == [401] * 5
    assert set(codes[5:]) == {429}


def test_auth_limits_ignore_a_forged_forwarded_header_from_a_direct_connection(client, monkeypatch) -> None:
    # TCP peer is a public address, so X-Forwarded-For is untrusted: rotating it buys nothing.
    with _app_client(monkeypatch, peer=("198.51.100.77", 4000), TRUST_PROXY_HEADERS="true", AUTH_RATE_LIMIT_ENABLED="true") as direct:
        codes = [
            direct.post("/api/auth/login", json={"email": f"user{n}@example.com", "password": "x"},
                        headers={"X-Forwarded-For": f"203.0.113.{n}"}).status_code
            for n in range(32)
        ]

    assert codes[:30] == [401] * 30 and codes[30:] == [429, 429]


def test_auth_limits_follow_the_real_client_behind_the_proxy(client, monkeypatch) -> None:
    # TCP peer is Caddy (private address), which reports the visitor: two visitors don't share a budget.
    with _app_client(monkeypatch, peer=("172.18.0.5", 4000), TRUST_PROXY_HEADERS="true", AUTH_RATE_LIMIT_ENABLED="true") as proxied:
        def attempts(visitor: str, count: int) -> list[int]:
            return [proxied.post("/api/auth/login", json={"email": f"{visitor}{n}@example.com", "password": "x"},
                                 headers={"X-Forwarded-For": visitor}).status_code for n in range(count)]

        assert attempts("203.0.113.1", 32)[30:] == [429, 429]  # this visitor is throttled...
        assert attempts("203.0.113.2", 3) == [401, 401, 401]  # ...another one is not


def test_register_unused_helpers() -> None:
    assert register is not None and uuid4() is not None


def test_blank_optional_switches_in_an_env_file_mean_automatic(tmp_path) -> None:
    env = tmp_path / "blank.env"
    env.write_text("COOKIE_SECURE=\nAPI_DOCS_ENABLED=\nAPP_BASE_URL=https://example.com\nAPP_MODE=main\n")

    settings = Settings(_env_file=str(env))

    assert settings.secure_cookies is True and settings.docs_enabled is False
    assert settings.cookie_secure is None and settings.api_docs_enabled is None


@pytest.mark.parametrize("name", [".env.example", ".env.production.example"])
def test_the_shipped_example_env_files_load_and_are_safe_by_default(name) -> None:
    from pathlib import Path

    settings = Settings(_env_file=str(Path(__file__).resolve().parents[2] / name))

    assert settings.password_min_length == 12
    assert settings.trust_proxy_headers is (name == ".env.production.example")
    assert settings.bearer_auth_enabled is (name == ".env.example")


# --- production configuration is checked at startup ------------------------------------------------------


def _prod(**env) -> Settings:
    base = dict(APP_MODE="main", JWT_SECRET="x" * 40, APP_BASE_URL="https://sportarenaglobal.ru",
                CORS_ORIGINS="https://sportarenaglobal.ru", SMTP_HOST="smtp.example.com", TRUST_PROXY_HEADERS="true")
    return Settings(_env_file=None, **{**base, **env})


def test_a_proper_production_configuration_is_clean() -> None:
    assert production_problems(_prod()) == ([], [])


@pytest.mark.parametrize(
    ("override", "needle"),
    [
        ({"JWT_SECRET": "change-me-to-a-long-random-string"}, "JWT_SECRET"),
        ({"JWT_SECRET": "too-short"}, "JWT_SECRET"),
        ({"APP_BASE_URL": "http://sportarenaglobal.ru"}, "APP_BASE_URL"),
        ({"COOKIE_SECURE": "false"}, "COOKIE_SECURE"),
        ({"CORS_ORIGINS": "*"}, "CORS_ORIGINS"),
        ({"COOKIE_SAMESITE": "none", "COOKIE_SECURE": "false"}, "COOKIE"),
    ],
)
def test_unsafe_production_settings_are_fatal(override, needle) -> None:
    fatal, _ = production_problems(_prod(**override))

    assert any(needle in message for message in fatal), fatal


def test_risky_but_workable_production_settings_only_warn() -> None:
    fatal, warnings = production_problems(_prod(SMTP_HOST="", TRUST_PROXY_HEADERS="false", BEARER_AUTH_ENABLED="true"))

    assert fatal == []
    joined = " ".join(warnings)
    assert "SMTP_HOST" in joined and "TRUST_PROXY_HEADERS" in joined and "BEARER_AUTH_ENABLED" in joined


def test_nothing_is_enforced_outside_production() -> None:
    assert production_problems(Settings(_env_file=None, APP_MODE="sandbox", JWT_SECRET="short")) == ([], [])


def test_the_backend_refuses_to_start_with_an_unsafe_production_configuration(client, monkeypatch) -> None:
    with pytest.raises(RuntimeError, match="unsafe production configuration"):
        with _app_client(monkeypatch, APP_MODE="main", JWT_SECRET="change-me-to-a-long-random-string"):
            pass


def test_the_config_checker_script_fails_on_a_placeholder_secret_and_passes_a_real_one(tmp_path) -> None:
    import subprocess
    import sys
    from pathlib import Path

    script = Path(__file__).resolve().parents[1] / "scripts" / "check_production_config.py"
    good = tmp_path / "good.env"
    good.write_text("APP_MODE=main\nJWT_SECRET=" + "k" * 40 + "\nAPP_BASE_URL=https://example.org\nCORS_ORIGINS=https://example.org\n"
                    "SMTP_HOST=smtp.example.org\nTRUST_PROXY_HEADERS=true\n")
    bad = tmp_path / "bad.env"
    bad.write_text("APP_MODE=main\nJWT_SECRET=change-me-to-a-long-random-string\nAPP_BASE_URL=https://example.org\n")

    def run(env_file: Path):
        return subprocess.run([sys.executable, str(script)], capture_output=True, text=True,
                              env={"ENV_FILE": str(env_file), "PATH": "/usr/bin:/bin"})

    assert run(good).returncode == 0 and "OK" in run(good).stdout
    failed = run(bad)
    assert failed.returncode == 1 and "FATAL" in failed.stdout and "JWT_SECRET" in failed.stdout
