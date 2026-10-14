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


class SlidingWindowLimiter:
    """Per-key sliding-window counter with a different (limit, window) per
    call - used for the auth endpoints (login, register, password reset ...),
    which need much tighter limits than the app-wide 300/min. In memory like
    the limiter above, so it resets on restart and is per process."""

    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = {}

    def hit(self, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        """Records an attempt. Returns (allowed, retry_after_seconds)."""
        now = time.monotonic()
        cutoff = now - window_seconds
        hits = [t for t in self._hits.get(key, []) if t > cutoff]
        if len(hits) >= limit:
            self._hits[key] = hits
            return False, max(1, int(hits[0] + window_seconds - now) + 1)
        hits.append(now)
        self._hits[key] = hits
        if len(self._hits) > 20000:  # bound memory under a key-spraying attack
            self._prune(now)
        return True, 0

    def _prune(self, now: float) -> None:
        for key in [k for k, v in self._hits.items() if not v or v[-1] < now - 86400]:
            del self._hits[key]
