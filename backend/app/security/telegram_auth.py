"""Verification of Telegram Mini App `initData`.

Algorithm per https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app:

    data_check_string = "\n".join(sorted(f"{k}={v}" for k, v in fields if k != "hash"))
    secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
    expected_hash = HMAC_SHA256(key=secret_key, msg=data_check_string).hexdigest()
    expected_hash must equal the "hash" field (constant-time compare)

`auth_date` (unix timestamp of when Telegram generated initData) is also
checked against a configurable max age to reject stale/replayed payloads.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from urllib.parse import parse_qsl


class InvalidInitData(Exception):
    """Raised when initData is missing required fields, has a bad signature,
    or has expired."""


@dataclass(frozen=True, slots=True)
class TelegramUser:
    id: int
    first_name: str
    last_name: str | None
    username: str | None
    language_code: str | None
    photo_url: str | None


def _parse_fields(init_data: str) -> dict[str, str]:
    if not init_data:
        raise InvalidInitData("initData is empty")
    pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=False)
    if not pairs:
        raise InvalidInitData("initData could not be parsed")
    return dict(pairs)


def verify_init_data(init_data: str, bot_token: str, max_age_seconds: int) -> dict[str, str]:
    """Validate signature and freshness, return the parsed field dict on success."""
    if not bot_token:
        raise InvalidInitData("bot token is not configured")

    fields = _parse_fields(init_data)

    received_hash = fields.get("hash")
    if not received_hash:
        raise InvalidInitData("initData missing hash field")

    data_check_string = "\n".join(
        f"{key}={value}" for key, value in sorted(fields.items()) if key != "hash"
    )

    secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    expected_hash = hmac.new(
        secret_key, data_check_string.encode("utf-8"), hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected_hash, received_hash):
        raise InvalidInitData("initData signature mismatch")

    auth_date_raw = fields.get("auth_date")
    if not auth_date_raw or not auth_date_raw.isdigit():
        raise InvalidInitData("initData missing auth_date")

    age = time.time() - int(auth_date_raw)
    if age > max_age_seconds:
        raise InvalidInitData("initData has expired")
    if age < -60:
        raise InvalidInitData("initData auth_date is in the future")

    return fields


def extract_user(fields: dict[str, str]) -> TelegramUser:
    raw_user = fields.get("user")
    if not raw_user:
        raise InvalidInitData("initData missing user field")
    try:
        payload = json.loads(raw_user)
    except json.JSONDecodeError as exc:
        raise InvalidInitData("initData user field is not valid JSON") from exc

    if "id" not in payload or "first_name" not in payload:
        raise InvalidInitData("initData user field missing required keys")

    return TelegramUser(
        id=int(payload["id"]),
        first_name=str(payload["first_name"]),
        last_name=payload.get("last_name"),
        username=payload.get("username"),
        language_code=payload.get("language_code"),
        photo_url=payload.get("photo_url"),
    )
