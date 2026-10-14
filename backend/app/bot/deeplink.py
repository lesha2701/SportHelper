"""Builds website URLs (query-string deep links) for bot messages - shared
between the bot's /start replies and the background notification sender."""
from __future__ import annotations

from urllib.parse import urlencode, urlparse, urlunparse


def build_site_url(base_url: str, params: dict[str, str], path: str = "/") -> str:
    parts = urlparse(base_url)
    return urlunparse(parts._replace(path=path, query=urlencode(params) if params else ""))
