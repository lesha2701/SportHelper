"""Switching real payments on is a decision the backend checks: it refuses to start with an unsafe or unfinished ЮKassa setup."""
from __future__ import annotations

import ipaddress

import pytest

from app.config import Settings, production_problems
from app.core.exceptions import APIError
from app.services import payments as payments_service

BASE = dict(APP_MODE="main", JWT_SECRET="x" * 40, APP_BASE_URL="https://sportarenaglobal.ru", CORS_ORIGINS="https://sportarenaglobal.ru",
            SMTP_HOST="smtp.example.com", TRUST_PROXY_HEADERS="true")
READY = dict(YOOKASSA_ENABLED="true", YOOKASSA_SHOP_ID="123456", YOOKASSA_SECRET_KEY="test_secret_value", YOOKASSA_SEND_RECEIPT="true",
             YOOKASSA_RETURN_URL="https://sportarenaglobal.ru/payments/return")


def _settings(**env) -> Settings:
    return Settings(_env_file=None, **{**BASE, **env})


def test_payments_are_off_and_the_site_starts_clean_by_default() -> None:
    s = _settings()
    assert (s.yookassa_enabled, s.payments_enabled, s.payments_configured) == (False, False, False)
    assert production_problems(s) == ([], [])


def test_keys_alone_never_switch_payments_on() -> None:
    s = _settings(YOOKASSA_SHOP_ID="123456", YOOKASSA_SECRET_KEY="test_secret_value")
    assert s.payments_configured is True and s.payments_enabled is False  # no new payments, but existing ones can still be followed
    assert production_problems(s) == ([], [])


def test_a_complete_setup_is_accepted() -> None:
    assert production_problems(_settings(**READY)) == ([], [])


@pytest.mark.parametrize(("override", "needle"), [
    ({"YOOKASSA_SHOP_ID": ""}, "YOOKASSA_SHOP_ID"),
    ({"YOOKASSA_SECRET_KEY": ""}, "YOOKASSA_SECRET_KEY"),
    ({"YOOKASSA_RETURN_URL": "http://sportarenaglobal.ru/payments/return"}, "https://"),
    ({"YOOKASSA_RETURN_URL": "https://evil.example/payments/return"}, "same site"),
    ({"YOOKASSA_API_URL": "http://api.yookassa.ru/v3"}, "YOOKASSA_API_URL"),
    ({"YOOKASSA_SEND_RECEIPT": "false"}, "fiscal"),                      # nobody answered the receipt question
    ({"TRUST_PROXY_HEADERS": "false"}, "TRUST_PROXY_HEADERS"),           # every webhook would look like the proxy's
])
def test_real_payments_cannot_be_switched_on_with_an_unfinished_setup(override, needle) -> None:
    fatal, _ = production_problems(_settings(**{**READY, **override}))
    assert any(needle in message for message in fatal), fatal


def test_the_receipt_question_can_be_closed_by_a_written_confirmation_instead_of_sending_receipts() -> None:
    fatal, _ = production_problems(_settings(**{**READY, "YOOKASSA_SEND_RECEIPT": "false", "YOOKASSA_FISCALIZATION_CONFIRMED": "true"}))
    assert fatal == []


def test_without_the_address_check_the_proxy_setting_does_not_matter() -> None:
    fatal, _ = production_problems(_settings(**{**READY, "TRUST_PROXY_HEADERS": "false", "YOOKASSA_WEBHOOK_IP_CHECK": "false"}))
    assert fatal == []


def test_the_secret_key_is_never_part_of_the_settings_text() -> None:
    assert "test_secret_value" not in repr(_settings(**READY).model_dump(exclude={"yookassa_secret_key"}))


def test_a_receipt_is_never_silently_skipped_when_fiscalisation_is_on() -> None:
    booking = {"listing_title": "Теннис", "currency": "RUB"}
    on = _settings(**READY)
    with pytest.raises(APIError) as raised:
        payments_service._receipt(on, booking, {"email": None}, 250000)
    assert raised.value.code == "receipt_email_required"
    receipt = payments_service._receipt(on, booking, {"email": "player@example.com"}, 250000)
    assert receipt["customer"] == {"email": "player@example.com"} and receipt["items"][0]["amount"] == {"value": "2500.00", "currency": "RUB"}
    assert payments_service._receipt(_settings(), booking, {"email": None}, 250000) is None  # off: no receipt, no question


@pytest.mark.parametrize("address", [ipaddress.ip_address("185.71.76.5"), ipaddress.ip_address("2a02:5180::1"), "::ffff:185.71.76.5"])
def test_the_source_check_accepts_real_address_objects_and_ipv4_in_ipv6_form(address) -> None:
    assert payments_service.ip_is_from_yookassa(address) is True


@pytest.mark.parametrize("address", [None, "2a02:5180::/64", ipaddress.ip_address("2001:db8::1")])
def test_the_source_check_refuses_anything_that_is_not_one_of_the_published_addresses(address) -> None:
    assert payments_service.ip_is_from_yookassa(address) is False
