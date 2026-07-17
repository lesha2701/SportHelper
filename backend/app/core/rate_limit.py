"""A simple in-memory, fixed-window rate limiter — no Redis, consistent
with the rest of the project's "Postgres + asyncio, nothing else" stance
on infrastructure. State lives on FastAPI's app.state (see main.py's
lifespan), so it naturally resets whenever the app restarts — including
between tests, which each get a fresh TestClient/lifespan cycle.

Keyed by client IP. Behind a reverse proxy (ngrok/cloudflared, per the
README's tunnel setup) every request shares that proxy's IP, so this
limits abuse per-deployment rather than truly per-visitor — a deliberate
simplification: parsing X-Forwarded-For safely requires knowing which
proxies are trusted, which is overkill for this project's scale.
"""
from __future__ import annotations

import time


class RateLimiter:
    def __init__(self, limit_per_minute: int):
        self._limit = limit_per_minute
        self._window_start: dict[str, float] = {}
        self._counts: dict[str, int] = {}

    def check(self, key: str) -> bool:
        """Returns True if the request is allowed, False if `key` has
        exceeded the limit within the current 60-second window."""
        now = time.monotonic()
        window_start = self._window_start.get(key)
        if window_start is None or now - window_start >= 60:
            self._window_start[key] = now
            self._counts[key] = 1
            return True
        self._counts[key] += 1
        return self._counts[key] <= self._limit
