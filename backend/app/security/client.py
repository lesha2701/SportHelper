"""Who is calling: client IP (proxy-aware) and a short device label."""
from __future__ import annotations

import re

from fastapi import Request

from app.config import Settings


def client_ip(request: Request, settings: Settings) -> str:
    if settings.trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for", "")
        # The reverse proxy appends the address it saw as the LAST element;
        # earlier ones are client-supplied and can be forged.
        parts = [part.strip() for part in forwarded.split(",") if part.strip()]
        if parts:
            return parts[-1]
    return request.client.host if request.client else "unknown"


_BROWSERS = (
    ("Edg/", "Edge"),
    ("OPR/", "Opera"),
    ("YaBrowser/", "Яндекс Браузер"),
    ("Firefox/", "Firefox"),
    ("Chrome/", "Chrome"),
    ("Safari/", "Safari"),
)
_SYSTEMS = (
    ("iPhone", "iPhone"),
    ("iPad", "iPad"),
    ("Android", "Android"),
    ("Windows", "Windows"),
    ("Mac OS X", "macOS"),
    ("Macintosh", "macOS"),
    ("Linux", "Linux"),
)


def describe_device(user_agent: str | None) -> str:
    if not user_agent:
        return "Неизвестное устройство"
    browser = next((name for needle, name in _BROWSERS if needle in user_agent), None)
    system = next((name for needle, name in _SYSTEMS if needle in user_agent), None)
    if browser and system:
        return f"{browser} · {system}"
    return browser or system or re.sub(r"\s+", " ", user_agent)[:40]
