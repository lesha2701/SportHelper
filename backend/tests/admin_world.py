"""A real administration backend for tests: real PostgreSQL, real sign-in, an enrolled administrator."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.config import get_settings
from app.services import activity as activity_service
from tests.live_helpers import AdminBrowser, Browser, sql, sql_value
from tests.test_auth_postgres import live_client, pg  # noqa: F401  (fixtures re-exported for the tests that import this module)

ADMIN_EMAIL = "boss@example.com"


@pytest.fixture
def world(live_client, pg, monkeypatch):  # noqa: F811
    monkeypatch.setenv("ADMIN_EMAILS", ADMIN_EMAIL)
    get_settings.cache_clear()
    activity_service.forget_all()
    admin = AdminBrowser(live_client, ADMIN_EMAIL, "Админ", role=None).enable_mfa()
    return SimpleNamespace(client=live_client, dsn=pg, admin=admin, monkeypatch=monkeypatch)


def set_admins(world, *emails: str) -> None:
    """Changes ADMIN_EMAILS the way a redeploy does: new environment, settings re-read."""
    world.monkeypatch.setenv("ADMIN_EMAILS", ",".join(emails))
    get_settings.cache_clear()


def today(dsn: str):
    return sql_value(dsn, "SELECT (now() AT TIME ZONE 'UTC')::date")


def add_user(dsn: str, email: str, *, days_ago: int = 0, banned: bool = False, deleted: bool = False, verified: bool = True) -> str:
    return str(
        sql_value(
            dsn,
            """
            INSERT INTO users (email, email_verified_at, first_name, is_banned, deleted_at, created_at)
            VALUES ($1, CASE WHEN $6 THEN now() END, $2, $3, CASE WHEN $4 THEN now() END,
                    ((now() AT TIME ZONE 'UTC')::date - $5::int + time '12:00') AT TIME ZONE 'UTC')
            RETURNING id
            """,
            email, email.split("@")[0], banned, deleted, days_ago, verified,
        )
    )


_LISTING = {
    "description": "Индивидуально", "is_listed": False, "price_per_session": 2500, "currency": "RUB", "offers_online": True,
    "offers_offline": True, "location": "Москва", "session_duration_minutes": 60,
}


def publish_listing(coach: Browser, title: str = "Теннис для взрослых", *, listed: bool = True) -> dict:
    """A coach profile plus a listing (published by default, with a weekly window so it can be booked)."""
    from datetime import date, timedelta

    coach.ok("PUT", "/api/profile/coach", json={"full_name": f"Тренер {title}", "sport": "Теннис", "experience_years": 5, "specialization": None, "description": None})
    listing = coach.ok("POST", "/api/coach-listings", json={**_LISTING, "title": title})
    monday = date.today() + timedelta(days=(7 - date.today().weekday()) % 7 or 7)
    coach.ok("PUT", f"/api/coach-listings/{listing['id']}/availability", json=[{"weekday": monday.weekday(), "start_time": "10:00:00", "end_time": "12:00:00"}])
    if listed:
        listing = coach.ok("PUT", f"/api/coach-listings/{listing['id']}", json={**_LISTING, "title": title, "is_listed": True})
    return listing


def upload(browser: Browser, path: str, data: bytes, name: str = "photo.jpg", content_type: str = "image/jpeg"):
    """A multipart upload as the website does it (cookie + CSRF header)."""
    return browser.call("POST", path, files={"file": (name, data, content_type)})


__all__ = ["ADMIN_EMAIL", "AdminBrowser", "Browser", "add_user", "live_client", "pg", "publish_listing", "set_admins", "sql", "sql_value", "today", "upload", "world"]
