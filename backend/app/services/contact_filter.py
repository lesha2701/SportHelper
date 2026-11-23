"""Contacts in free text: phones, e-mails, links and messengers' handles. Hidden before a payment in matching, rejected in articles, masked in comments."""
from __future__ import annotations

import re

HIDDEN = "[контакт скрыт]"

_PATTERNS = [
    re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"),
    re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE),
    re.compile(r"\b(?:t\.me|wa\.me|vk\.com|vk\.cc|instagram\.com|youtube\.com)/\S*", re.IGNORECASE),
    re.compile(r"(?<![\w@])@[A-Za-z0-9_]{3,}"),
    re.compile(r"(?<!\d)(?:\+?\d[\s().-]*){10,}(?!\d)"),
]


def contains_contact(text: str | None) -> bool:
    return bool(text) and any(pattern.search(text) for pattern in _PATTERNS)


def mask_contacts(text: str | None) -> str | None:
    if not text:
        return text
    for pattern in _PATTERNS:
        text = pattern.sub(HIDDEN, text)
    return text
