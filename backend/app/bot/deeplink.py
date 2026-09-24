"""Builds Mini App URLs (query-string deep links) for bot messages — shared
between the /start invite flow and the background notification sender."""
from __future__ import annotations

from urllib.parse import urlencode, urlparse, urlunparse


def build_mini_app_url(mini_app_url: str, params: dict[str, str]) -> str:
    if not params:
        return mini_app_url
    parts = urlparse(mini_app_url)
    query = urlencode(params)
    return urlunparse(parts._replace(query=query))
