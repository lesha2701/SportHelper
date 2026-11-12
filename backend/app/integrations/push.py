"""Sending a push to one phone: APNs for iPhone, FCM (HTTP v1) for Android.

Both talk to the provider directly with a signed token, so there is no extra library: the signing is `cryptography`, which is
already a dependency, and APNs needs HTTP/2 (httpx with the `h2` package). A side without credentials is simply "not configured":
nothing is sent and nothing fails.

The answer for one phone is one of three words (`SENT`, `DEAD`, `FAILED`):
  * DEAD   - the provider says this token will never work again (the app was removed, the token was replaced): forget it;
  * FAILED - anything else (the provider is down, our credentials are wrong): keep the token, try the next notification;
  * a push is a courtesy copy of a notification the bell already shows, so a failure is logged and never retried or escalated.
"""
from __future__ import annotations

import base64
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

from app.config import Settings

logger = logging.getLogger("teamflow.push")

PushOutcome = Literal["sent", "dead", "failed"]

APNS_HOST = "https://api.push.apple.com"
APNS_SANDBOX_HOST = "https://api.sandbox.push.apple.com"
FCM_TOKEN_URL = "https://oauth2.googleapis.com/token"
FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"

# APNs refuses a provider token older than an hour and asks not to be given a new one more than every 20 minutes.
_APNS_JWT_LIFETIME = 50 * 60
# Reasons after which the token will never work (APNs answers 400 with these, or 410).
_APNS_DEAD_REASONS = {"BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic", "ExpiredToken"}


@dataclass(frozen=True)
class PushMessage:
    title: str
    body: str
    # Everything the app needs to open the right screen. Values are strings: FCM only accepts that.
    data: dict[str, str] = field(default_factory=dict)


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _pem(text: str) -> bytes:
    # Environment files keep a multi-line key on one line with literal "\n".
    return text.replace("\\n", "\n").strip().encode()


class PushSender:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self._settings = settings
        self._client = client
        self._apns_jwt: tuple[str, float] | None = None
        self._fcm_token: tuple[str, float] | None = None
        self._fcm_account: dict[str, Any] | None = None
        if settings.fcm_service_account_json.strip():
            try:
                account = json.loads(settings.fcm_service_account_json)
                if all(account.get(k) for k in ("project_id", "client_email", "private_key")):
                    self._fcm_account = account
                else:
                    logger.error("FCM_SERVICE_ACCOUNT_JSON has no project_id / client_email / private_key: Android push is off")
            except ValueError:
                logger.error("FCM_SERVICE_ACCOUNT_JSON is not valid JSON: Android push is off")

    @property
    def apns_configured(self) -> bool:
        s = self._settings
        return bool(s.apns_key_id and s.apns_team_id and s.apns_bundle_id and s.apns_private_key.strip())

    @property
    def fcm_configured(self) -> bool:
        return self._fcm_account is not None

    def configured_for(self, platform: str) -> bool:
        return self.apns_configured if platform == "ios" else self.fcm_configured if platform == "android" else False

    @property
    def any_configured(self) -> bool:
        return self.apns_configured or self.fcm_configured

    async def send(self, platform: str, token: str, message: PushMessage) -> PushOutcome:
        """Never raises: the caller is delivering a notification that is already safe in the bell."""
        try:
            if platform == "ios":
                return await self._send_apns(token, message)
            if platform == "android":
                return await self._send_fcm(token, message)
        except Exception:  # noqa: BLE001 - a network or signing problem must not stop the other phones or the other notifications
            logger.exception("Push to a %s device failed", platform)
        return "failed"

    async def _http(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        timeout = self._settings.push_timeout_seconds
        if self._client is not None:
            return await self._client.request(method, url, timeout=timeout, **kwargs)
        # APNs speaks HTTP/2 only; Google accepts it too.
        async with httpx.AsyncClient(http2=True, timeout=timeout) as client:
            return await client.request(method, url, **kwargs)

    # --- APNs ---

    def _apns_provider_token(self) -> str:
        now = time.time()
        if self._apns_jwt is not None and now - self._apns_jwt[1] < _APNS_JWT_LIFETIME:
            return self._apns_jwt[0]
        s = self._settings
        header = _b64url(json.dumps({"alg": "ES256", "kid": s.apns_key_id}, separators=(",", ":")).encode())
        claims = _b64url(json.dumps({"iss": s.apns_team_id, "iat": int(now)}, separators=(",", ":")).encode())
        key = serialization.load_pem_private_key(_pem(s.apns_private_key), password=None)
        der = key.sign(f"{header}.{claims}".encode(), ec.ECDSA(hashes.SHA256()))
        r, sig_s = decode_dss_signature(der)
        token = f"{header}.{claims}.{_b64url(r.to_bytes(32, 'big') + sig_s.to_bytes(32, 'big'))}"
        self._apns_jwt = (token, now)
        return token

    async def _send_apns(self, token: str, message: PushMessage) -> PushOutcome:
        if not self.apns_configured:
            return "failed"
        s = self._settings
        payload = {**message.data, "aps": {"alert": {"title": message.title, "body": message.body}, "sound": "default"}}
        host = APNS_SANDBOX_HOST if s.apns_sandbox else APNS_HOST
        response = await self._http(
            "POST",
            f"{host}/3/device/{token}",
            headers={
                "authorization": f"bearer {self._apns_provider_token()}",
                "apns-topic": s.apns_bundle_id,
                "apns-push-type": "alert",
                "apns-priority": "10",
            },
            content=json.dumps(payload, ensure_ascii=False).encode(),
        )
        if response.status_code == 200:
            return "sent"
        reason = ""
        try:
            reason = response.json().get("reason", "")
        except ValueError:
            pass
        if response.status_code == 410 or reason in _APNS_DEAD_REASONS:
            return "dead"
        if reason in {"ExpiredProviderToken", "InvalidProviderToken"}:
            self._apns_jwt = None  # sign a fresh one next time
        logger.warning("APNs refused a push: %s %s", response.status_code, reason)
        return "failed"

    # --- FCM ---

    async def _fcm_access_token(self) -> str:
        now = time.time()
        if self._fcm_token is not None and self._fcm_token[1] > now + 60:
            return self._fcm_token[0]
        account = self._fcm_account or {}
        header = _b64url(json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")).encode())
        claims = _b64url(
            json.dumps(
                {"iss": account["client_email"], "scope": FCM_SCOPE, "aud": FCM_TOKEN_URL, "iat": int(now), "exp": int(now) + 3600},
                separators=(",", ":"),
            ).encode()
        )
        key = serialization.load_pem_private_key(_pem(account["private_key"]), password=None)
        signature = key.sign(f"{header}.{claims}".encode(), padding.PKCS1v15(), hashes.SHA256())
        assertion = f"{header}.{claims}.{_b64url(signature)}"
        response = await self._http(
            "POST",
            FCM_TOKEN_URL,
            data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion},
        )
        response.raise_for_status()
        body = response.json()
        self._fcm_token = (body["access_token"], now + int(body.get("expires_in", 3600)))
        return body["access_token"]

    async def _send_fcm(self, token: str, message: PushMessage) -> PushOutcome:
        if self._fcm_account is None:
            return "failed"
        payload = {
            "message": {
                "token": token,
                "notification": {"title": message.title, "body": message.body},
                "data": message.data,
                "android": {"priority": "HIGH", "notification": {"channel_id": "default"}},
            }
        }
        response = await self._http(
            "POST",
            f"https://fcm.googleapis.com/v1/projects/{self._fcm_account['project_id']}/messages:send",
            headers={"authorization": f"Bearer {await self._fcm_access_token()}"},
            json=payload,
        )
        if response.status_code == 200:
            return "sent"
        status = ""
        try:
            status = response.json().get("error", {}).get("status", "")
        except ValueError:
            pass
        if response.status_code == 404 or status == "UNREGISTERED":
            return "dead"
        if response.status_code == 401:
            self._fcm_token = None
        logger.warning("FCM refused a push: %s %s", response.status_code, status)
        return "failed"
