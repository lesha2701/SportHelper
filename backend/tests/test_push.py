"""Push notifications: the provider calls, what is sent to whom, and the device routes."""
from __future__ import annotations

import base64
import json

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa

from app.config import Settings
from app.integrations.push import PushMessage, PushSender
from app.services import push as push_service

MESSAGE = PushMessage(title="Тренировка завтра", body="В 18:00", data={"category": "training_reminder", "entity_id": "x"})


def _ec_pem() -> str:
    key = ec.generate_private_key(ec.SECP256R1())
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()


def _rsa_pem() -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()


def _settings(**extra) -> Settings:
    base = dict(
        APNS_KEY_ID="KEY123", APNS_TEAM_ID="TEAM123", APNS_BUNDLE_ID="ru.sportarenaglobal.app", APNS_PRIVATE_KEY=_ec_pem(),
        FCM_SERVICE_ACCOUNT_JSON=json.dumps({"project_id": "demo", "client_email": "svc@demo.iam", "private_key": _rsa_pem()}),
    )
    return Settings(_env_file=None, **{**base, **extra})


def _decode(part: str) -> dict:
    return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))


def _sender(settings: Settings, handler) -> PushSender:
    return PushSender(settings, httpx.AsyncClient(transport=httpx.MockTransport(handler)))


async def test_apns_request_is_signed_and_carries_the_message() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200)

    sender = _sender(_settings(), handler)
    assert await sender.send("ios", "a" * 64, MESSAGE) == "sent"
    request = seen[0]
    assert str(request.url) == "https://api.push.apple.com/3/device/" + "a" * 64
    assert request.headers["apns-topic"] == "ru.sportarenaglobal.app"
    assert request.headers["apns-push-type"] == "alert"
    header, claims, _signature = request.headers["authorization"].removeprefix("bearer ").split(".")
    assert _decode(header) == {"alg": "ES256", "kid": "KEY123"}
    assert _decode(claims)["iss"] == "TEAM123"
    body = json.loads(request.content)
    assert body["aps"]["alert"] == {"title": "Тренировка завтра", "body": "В 18:00"}
    assert body["category"] == "training_reminder"


async def test_apns_sandbox_host_and_token_reuse() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200)

    sender = _sender(_settings(APNS_SANDBOX="true"), handler)
    await sender.send("ios", "b" * 64, MESSAGE)
    await sender.send("ios", "c" * 64, MESSAGE)
    assert seen[0].url.host == "api.sandbox.push.apple.com"
    assert seen[0].headers["authorization"] == seen[1].headers["authorization"]  # signed once, not per push


@pytest.mark.parametrize(
    ("status", "reason", "expected"),
    [(410, "Unregistered", "dead"), (400, "BadDeviceToken", "dead"), (403, "InvalidProviderToken", "failed"), (503, "ServiceUnavailable", "failed")],
)
async def test_apns_answers(status: int, reason: str, expected: str) -> None:
    sender = _sender(_settings(), lambda request: httpx.Response(status, json={"reason": reason}))
    assert await sender.send("ios", "d" * 64, MESSAGE) == expected


async def test_fcm_gets_an_access_token_once_then_sends() -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "ya29.token", "expires_in": 3600})
        return httpx.Response(200, json={"name": "projects/demo/messages/1"})

    sender = _sender(_settings(), handler)
    assert await sender.send("android", "fcm-token-1", MESSAGE) == "sent"
    assert await sender.send("android", "fcm-token-2", MESSAGE) == "sent"
    assert [c.url.host for c in calls] == ["oauth2.googleapis.com", "fcm.googleapis.com", "fcm.googleapis.com"]
    send = calls[1]
    assert str(send.url) == "https://fcm.googleapis.com/v1/projects/demo/messages:send"
    assert send.headers["authorization"] == "Bearer ya29.token"
    message = json.loads(send.content)["message"]
    assert message["token"] == "fcm-token-1"
    assert message["notification"] == {"title": "Тренировка завтра", "body": "В 18:00"}
    assert message["data"]["category"] == "training_reminder"


async def test_fcm_unregistered_token_is_dead() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
        return httpx.Response(404, json={"error": {"status": "NOT_FOUND"}})

    assert await _sender(_settings(), handler).send("android", "gone-token", MESSAGE) == "dead"


async def test_a_network_failure_is_failed_not_raised() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    assert await _sender(_settings(), handler).send("ios", "e" * 64, MESSAGE) == "failed"


def test_nothing_is_configured_by_default() -> None:
    sender = PushSender(Settings(_env_file=None))
    assert not sender.any_configured
    assert not sender.configured_for("ios") and not sender.configured_for("android")


def test_a_broken_service_account_switches_android_off_without_failing() -> None:
    assert not PushSender(Settings(_env_file=None, FCM_SERVICE_ACCOUNT_JSON="{not json")).fcm_configured
    assert not PushSender(Settings(_env_file=None, FCM_SERVICE_ACCOUNT_JSON='{"project_id": "x"}')).fcm_configured


class _Sender:
    """Remembers what it was asked to send; a token starting with `dead` is reported dead."""

    def __init__(self, ios: bool = True, android: bool = True) -> None:
        self.ios, self.android = ios, android
        self.sent: list[tuple[str, str]] = []

    any_configured = True

    def configured_for(self, platform: str) -> bool:
        return self.ios if platform == "ios" else self.android

    async def send(self, platform: str, token: str, message: PushMessage) -> str:
        self.sent.append((platform, token))
        return "dead" if token.startswith("dead") else "sent"


async def test_every_device_of_the_recipient_is_pushed_and_dead_ones_are_forgotten(monkeypatch: pytest.MonkeyPatch) -> None:
    forgotten: list[str] = []

    async def list_for_user(conn, user_id):
        return [
            {"platform": "ios", "token": "ios-token"},
            {"platform": "android", "token": "android-token"},
            {"platform": "android", "token": "dead-token"},
        ]

    async def delete_by_token(conn, token):
        forgotten.append(token)

    monkeypatch.setattr(push_service.push_devices_repo, "list_for_user", list_for_user)
    monkeypatch.setattr(push_service.push_devices_repo, "delete_by_token", delete_by_token)
    sender = _Sender()
    notification = {"id": "n1", "user_id": "u1", "category": "booking_decided", "title": "T", "body": "B", "entity_type": "booking", "entity_id": "b1"}
    reached = await push_service.push_notification(None, notification, Settings(_env_file=None), sender)  # type: ignore[arg-type]
    assert reached == 2
    assert [t for _, t in sender.sent] == ["ios-token", "android-token", "dead-token"]
    assert forgotten == ["dead-token"]


async def test_a_platform_without_credentials_is_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    async def list_for_user(conn, user_id):
        return [{"platform": "ios", "token": "ios-token"}, {"platform": "android", "token": "android-token"}]

    monkeypatch.setattr(push_service.push_devices_repo, "list_for_user", list_for_user)
    sender = _Sender(ios=False)
    notification = {"id": "n1", "user_id": "u1", "category": "x", "title": "T", "body": "B", "entity_type": "e", "entity_id": "i"}
    await push_service.push_notification(None, notification, Settings(_env_file=None), sender)  # type: ignore[arg-type]
    assert sender.sent == [("android", "android-token")]


async def test_without_any_credentials_the_database_is_not_even_asked() -> None:
    notification = {"id": "n1", "user_id": "u1", "category": "x", "title": "T", "body": "B", "entity_type": "e", "entity_id": "i"}
    assert await push_service.push_notification(None, notification, Settings(_env_file=None)) == 0  # conn=None would blow up if used


# --- the routes ---


@pytest.fixture
def devices(monkeypatch: pytest.MonkeyPatch):
    """An in-memory stand-in for the repository: token -> (user, platform, version)."""
    from app.repositories import push_devices as repo

    store: dict[str, tuple] = {}

    async def register(conn, *, user_id, platform, token, app_version):
        store[token] = (user_id, platform, app_version)

    async def unregister(conn, *, user_id, token):
        if token in store and store[token][0] == user_id:
            del store[token]

    monkeypatch.setattr(repo, "register", register)
    monkeypatch.setattr(repo, "unregister", unregister)
    return store


def test_a_signed_in_user_registers_and_removes_a_device(logged_in_client, devices) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    body = {"platform": "android", "token": "fcm-device-token", "app_version": "1.2.0"}
    assert client.put("/api/devices", headers=headers, json=body).status_code == 204
    assert client.put("/api/devices", headers=headers, json=body).status_code == 204  # idempotent
    assert [(p, v) for _, p, v in devices.values()] == [("android", "1.2.0")]
    assert client.post("/api/devices/remove", headers=headers, json={"token": "fcm-device-token"}).status_code == 204
    assert devices == {}


def test_devices_need_a_signed_in_user_and_a_known_platform(logged_in_client, devices) -> None:
    client, token = logged_in_client
    body = {"platform": "android", "token": "fcm-device-token"}
    assert client.put("/api/devices", json=body).status_code == 401
    assert client.put("/api/devices", headers={"Authorization": f"Bearer {token}"}, json={**body, "platform": "windows"}).status_code == 422
    assert client.put("/api/devices", headers={"Authorization": f"Bearer {token}"}, json={**body, "token": "x"}).status_code == 422
    assert devices == {}


def test_nobody_can_remove_somebody_elses_device(logged_in_client, login_as, devices) -> None:
    client, token = logged_in_client
    client.put("/api/devices", headers={"Authorization": f"Bearer {token}"}, json={"platform": "ios", "token": "apns-device-token"})
    other = login_as(900002, first_name="Other")
    client.post("/api/devices/remove", headers={"Authorization": f"Bearer {other}"}, json={"token": "apns-device-token"})
    assert "apns-device-token" in devices
