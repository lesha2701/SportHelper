from __future__ import annotations

from app.core.rate_limit import RateLimiter


def test_allows_requests_within_the_limit():
    limiter = RateLimiter(limit_per_minute=3)
    assert limiter.check("1.2.3.4") is True
    assert limiter.check("1.2.3.4") is True
    assert limiter.check("1.2.3.4") is True


def test_rejects_requests_over_the_limit_within_the_same_window():
    limiter = RateLimiter(limit_per_minute=2)
    assert limiter.check("1.2.3.4") is True
    assert limiter.check("1.2.3.4") is True
    assert limiter.check("1.2.3.4") is False
    assert limiter.check("1.2.3.4") is False


def test_keys_are_tracked_independently():
    limiter = RateLimiter(limit_per_minute=1)
    assert limiter.check("1.2.3.4") is True
    assert limiter.check("5.6.7.8") is True
    assert limiter.check("1.2.3.4") is False
    assert limiter.check("5.6.7.8") is False


def test_window_resets_after_sixty_seconds(monkeypatch):
    limiter = RateLimiter(limit_per_minute=1)
    fake_now = [1000.0]
    monkeypatch.setattr("app.core.rate_limit.time.monotonic", lambda: fake_now[0])

    assert limiter.check("1.2.3.4") is True
    assert limiter.check("1.2.3.4") is False

    fake_now[0] += 61
    assert limiter.check("1.2.3.4") is True
