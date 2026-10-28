"""Where a trainer wants a manual payout sent: validation, masking and (de)encryption of the recipient details.

* Methods: SBP by phone number, or a bank transfer by account details. Never a card: a bank-card number (any 13-19 digit run
  that passes the Luhn check) or a CVV is refused in every field, and the site has no field for them.
* The details are personal data: they are stored encrypted (Fernet, key derived from the server secret), fixed per request, and a list
  only ever shows the masked `hint`. A finance administrator sees them in full on an explicit, audited action."""
from __future__ import annotations

import json
import re
from typing import Any

from app.config import Settings
from app.core.exceptions import APIError
from app.security import totp

METHODS = ("sbp", "bank_transfer")
_CONTROL = re.compile(r"[\x00-\x1f\x7f<>]")
_PHONE_DIGITS = re.compile(r"\D")


def _fail(message: str, field: str | None = None) -> APIError:
    return APIError(message, code="invalid_payout_details", status_code=422, field=field)


def luhn_valid(digits: str) -> bool:
    total = 0
    for index, char in enumerate(reversed(digits)):
        n = int(char)
        if index % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def looks_like_card_number(text: str) -> bool:
    """Any run of 13-19 digits (spaces and dashes between them allowed). Deliberately NOT only Luhn-valid ones: a mistyped card
    number must be refused too, and nothing else a person types here (a name, a bank) has that many digits."""
    for match in re.finditer(r"(?:\d[ -]?){13,}", text):
        digits = re.sub(r"\D", "", match.group(0))
        if 13 <= len(digits) <= 19:
            return True
    return False


def _text(value: Any, field: str, *, minimum: int, maximum: int, required: bool = True, check_card: bool = True) -> str:
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise _fail("Заполните поле.", field)
        return ""
    if not isinstance(value, str):
        raise _fail("Некорректное значение.", field)
    cleaned = " ".join(value.split())
    if _CONTROL.search(cleaned) or not (minimum <= len(cleaned) <= maximum):
        raise _fail("Некорректное значение.", field)
    if check_card and looks_like_card_number(cleaned):
        raise _fail("Номер банковской карты указывать нельзя: используйте СБП или банковские реквизиты.", field)
    return cleaned


def normalize_phone(value: Any) -> str:
    if not isinstance(value, str):
        raise _fail("Укажите номер телефона.", "phone")
    digits = _PHONE_DIGITS.sub("", value)
    if len(digits) == 11 and digits[0] in "78":
        digits = digits[1:]
    if len(digits) != 10 or digits[0] != "9":
        raise _fail("Номер телефона должен быть российским мобильным: +7 9XX XXX-XX-XX.", "phone")
    return "+7" + digits


def validate(method: str, raw: Any) -> dict[str, str]:
    if method not in METHODS:
        raise _fail("Выберите способ получения.", "method")
    if not isinstance(raw, dict):
        raise _fail("Укажите реквизиты.")
    allowed = {"sbp": {"phone", "bank", "recipient"}, "bank_transfer": {"recipient", "bank", "bik", "account", "inn"}}[method]
    unknown = set(raw) - allowed
    if unknown:
        raise _fail("Лишние поля в реквизитах.")
    details: dict[str, str] = {
        "recipient": _text(raw.get("recipient"), "recipient", minimum=3, maximum=150),
        "bank": _text(raw.get("bank"), "bank", minimum=2, maximum=100),
    }
    if method == "sbp":
        details["phone"] = normalize_phone(raw.get("phone"))
        return details
    bik = _text(raw.get("bik"), "bik", minimum=9, maximum=9)
    account = _text(raw.get("account"), "account", minimum=20, maximum=20, check_card=False)
    if not bik.isdigit() or not account.isdigit():
        raise _fail("БИК — 9 цифр, расчётный счёт — 20 цифр.", "account")
    details.update(bik=bik, account=account)
    inn = _text(raw.get("inn"), "inn", minimum=10, maximum=12, required=False)
    if inn:
        if not inn.isdigit() or len(inn) not in (10, 12):
            raise _fail("ИНН — 10 или 12 цифр.", "inn")
        details["inn"] = inn
    return details


def hint(method: str, details: dict[str, str]) -> str:
    """A safe, short description for lists ("СБП · +7 ••• •••-••-12 · Сбербанк")."""
    if method == "sbp":
        phone = details["phone"]
        return f"СБП · +7 ••• •••-••-{phone[-2:]} · {details['bank']}"
    return f"Банковский перевод · счёт ••••{details['account'][-4:]} · {details['bank']}"


def encrypt(details: dict[str, str], settings: Settings) -> str:
    return totp.encrypt_secret(json.dumps(details, ensure_ascii=True), settings.jwt_secret)


def decrypt(token: str, settings: Settings) -> dict[str, str] | None:
    plain = totp.decrypt_secret(token, settings.jwt_secret)
    return json.loads(plain) if plain else None
