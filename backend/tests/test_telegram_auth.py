from __future__ import annotations

import pytest

from app.security.telegram_auth import InvalidInitData, extract_user, verify_init_data
from tests.conftest import build_init_data

BOT_TOKEN = "123456:test-bot-token"


def test_verify_init_data_accepts_valid_signature() -> None:
    init_data = build_init_data(BOT_TOKEN, user_id=42, first_name="Anna", username="anna")

    fields = verify_init_data(init_data, BOT_TOKEN, max_age_seconds=86400)

    user = extract_user(fields)
    assert user.id == 42
    assert user.first_name == "Anna"
    assert user.username == "anna"


def test_verify_init_data_rejects_tampered_hash() -> None:
    init_data = build_init_data(BOT_TOKEN)
    tampered = init_data.replace("hash=", "hash=deadbeef")

    with pytest.raises(InvalidInitData):
        verify_init_data(tampered, BOT_TOKEN, max_age_seconds=86400)


def test_verify_init_data_rejects_wrong_bot_token() -> None:
    init_data = build_init_data(BOT_TOKEN)

    with pytest.raises(InvalidInitData):
        verify_init_data(init_data, "999999:other-token", max_age_seconds=86400)


def test_verify_init_data_rejects_expired_auth_date() -> None:
    stale_auth_date = 1_000_000_000  # far in the past
    init_data = build_init_data(BOT_TOKEN, auth_date=stale_auth_date)

    with pytest.raises(InvalidInitData):
        verify_init_data(init_data, BOT_TOKEN, max_age_seconds=86400)


def test_verify_init_data_rejects_missing_hash() -> None:
    with pytest.raises(InvalidInitData):
        verify_init_data("auth_date=123&user=%7B%7D", BOT_TOKEN, max_age_seconds=86400)


def test_verify_init_data_rejects_empty_payload() -> None:
    with pytest.raises(InvalidInitData):
        verify_init_data("", BOT_TOKEN, max_age_seconds=86400)
