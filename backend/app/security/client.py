"""Who is calling: the client IP (proxy-aware, spoof-resistant) and a short device label."""
from __future__ import annotations

import ipaddress
import re

from fastapi import Request

from app.config import Settings

_IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address


def _parse(value: str | None) -> _IPAddress | None:
    if not value:
        return None
    try:
        return ipaddress.ip_address(value.strip().strip("[]"))
    except ValueError:
        return None


def _is_trusted_proxy(address: _IPAddress, settings: Settings) -> bool:
    return any(address in network for network in settings.trusted_proxy_networks)


def client_address(request: Request, settings: Settings) -> _IPAddress | None:
    """The real client address.

    X-Forwarded-For is only honoured when the connection really comes from a
    trusted proxy (TRUSTED_PROXY_CIDRS) AND TRUST_PROXY_HEADERS is on. The list
    is then read from the right, skipping proxies we trust: the first address
    that is not one of ours is the client, so anything a visitor puts at the
    left of the header ("X-Forwarded-For: 1.2.3.4") can never be chosen.
    Malformed values are ignored rather than used as keys."""
    peer = _parse(request.client.host if request.client else None)
    if peer is None:
        return None
    if not settings.trust_proxy_headers or not _is_trusted_proxy(peer, settings):
        return peer
    forwarded = [_parse(part) for part in request.headers.get("x-forwarded-for", "").split(",")]
    for address in reversed([a for a in forwarded if a is not None]):
        if not _is_trusted_proxy(address, settings):
            return address
    return peer


def client_ip(request: Request, settings: Settings) -> str:
    """Printable address, kept with a session so the owner can recognise it."""
    address = client_address(request, settings)
    return str(address) if address is not None else "unknown"


def rate_limit_key(request: Request, settings: Settings) -> str:
    """The key requests are counted under. An IPv6 visitor controls a whole /64,
    so counting individual addresses would let them rotate around every limit:
    the /64 is the unit instead."""
    address = client_address(request, settings)
    if address is None:
        return "unknown"
    if isinstance(address, ipaddress.IPv6Address):
        return str(ipaddress.ip_network(f"{address}/64", strict=False))
    return str(address)


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
