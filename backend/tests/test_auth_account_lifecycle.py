"""Deleting an account (without destroying shared history) and guest access
to the public part of the site."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.config import get_settings
from app.services import background
from tests.auth_helpers import PASSWORD, csrf_headers, login, mails_to, sign_in
from tests.test_bookings_api import _list_coach_with_slot
from tests.test_teams_api import _create_coach_profile


# --- account deletion -----------------------------------------------------------------------


def test_deletion_request_requires_the_password_and_can_be_cancelled(client) -> None:
    info = sign_in(client)
    headers = csrf_headers(info["csrf"])

    wrong = client.post("/api/auth/account/delete", headers=headers, json={"password": "not my password"})
    assert wrong.status_code == 403
    assert client.get("/api/auth/me").json()["deletion_requested_at"] is None

    ok = client.post("/api/auth/account/delete", headers=headers, json={"password": PASSWORD})
    assert ok.status_code == 200 and "14" in ok.json()["message"]
    assert client.get("/api/auth/me").json()["deletion_requested_at"] is not None
    assert any("удаление" in m.subject.lower() for m in mails_to(client, "alice@example.com"))

    cancelled = client.post("/api/auth/account/delete/cancel", headers=headers)
    assert cancelled.status_code == 200
    assert client.get("/api/auth/me").json()["deletion_requested_at"] is None


def test_account_is_anonymised_only_after_the_grace_period(client) -> None:
    info = sign_in(client)
    client.post("/api/auth/account/delete", headers=csrf_headers(info["csrf"]), json={"password": PASSWORD})
    user = client.auth_store.find_by_email("alice@example.com")
    settings = get_settings()

    asyncio.run(background.process_account_deletions(None, settings))
    assert user["deleted_at"] is None  # still within the grace period

    user["deletion_requested_at"] = datetime.now(timezone.utc) - timedelta(days=settings.account_deletion_grace_days + 1)
    asyncio.run(background.process_account_deletions(None, settings))

    assert user["deleted_at"] is not None
    assert user["email"] is None and user["password_hash"] is None and user["telegram_id"] is None
    assert user["first_name"] == "Удалённый пользователь"
    # The row (and its id) survive so bookings, reviews and financial records stay intact.
    assert user["id"] in client.auth_store.users
    assert client.get("/api/auth/me").status_code == 401  # every session is gone
    assert login(client).status_code == 401


# --- the public part of the site -------------------------------------------------------------


def _published_coach(client, login_as):
    coach_token = login_as(3001, first_name="Coach")
    _create_coach_profile(client, coach_token, sport="Теннис")
    listing_id, slot = _list_coach_with_slot(client, coach_token)
    coach_id = client.get("/api/auth/me", headers={"Authorization": f"Bearer {coach_token}"}).json()["id"]
    client.cookies.clear()
    return coach_token, coach_id, listing_id, slot


def test_guests_can_browse_the_catalogue_without_an_account(client, login_as) -> None:
    _, coach_id, listing_id, slot = _published_coach(client, login_as)

    catalogue = client.get("/api/coach-listings")
    listing = client.get(f"/api/coach-listings/{listing_id}")
    day = slot[:10]
    slots = client.get(f"/api/coach-listings/{listing_id}/slots", params={"from_date": day, "to_date": day})
    profile = client.get(f"/api/coaches/{coach_id}/profile")
    coach_listings = client.get(f"/api/coaches/{coach_id}/listings")
    reviews = client.get(f"/api/coaches/{coach_id}/reviews")
    gallery = client.get(f"/api/profile/media/{coach_id}")

    for resp in (catalogue, listing, slots, profile, coach_listings, reviews, gallery):
        assert resp.status_code == 200, resp.text
    assert [c["id"] for c in catalogue.json()] == [listing_id]
    assert slots.json()[0]["starts_at"] == slot


def test_public_responses_contain_no_private_account_data(client, login_as) -> None:
    _, coach_id, listing_id, _ = _published_coach(client, login_as)

    bodies = " ".join(
        client.get(path).text
        for path in (
            "/api/coach-listings",
            f"/api/coach-listings/{listing_id}",
            f"/api/coaches/{coach_id}/profile",
            f"/api/coaches/{coach_id}/listings",
        )
    )

    assert "fixtures.example.com" not in bodies  # no emails
    for private_key in ("email", "password", "telegram", "last_login", "is_banned", "token"):
        assert private_key not in bodies


def test_only_public_files_can_be_downloaded_by_guests(client, login_as) -> None:
    owner_token = login_as(3003)
    owner_id = next(iter(client.auth_store.users))
    now = datetime.now(timezone.utc)
    client_files = {}

    import app.repositories.files as files_module

    for level, file_id in (("PUBLIC", uuid4()), ("PRIVATE", uuid4()), ("TEAM", uuid4())):
        client_files[level] = {
            "id": file_id, "owner_id": owner_id, "team_id": None, "entity_type": "user_avatar", "entity_id": owner_id,
            "disk_path": f"/x/{file_id}", "filename": "a.png", "mime_type": "image/png", "size_bytes": 3, "status": "ready",
            "access_level": level, "created_at": now, "updated_at": now, "deleted_at": None,
        }

    async def fake_get_file(conn, file_id):
        return next((f for f in client_files.values() if f["id"] == file_id), None)

    import pytest

    monkeypatch = pytest.MonkeyPatch()
    try:
        monkeypatch.setattr(files_module, "get_file", fake_get_file)
        client.cookies.clear()
        public = client.get(f"/api/files/{client_files['PUBLIC']['id']}")
        private = client.get(f"/api/files/{client_files['PRIVATE']['id']}")
        team = client.get(f"/api/files/{client_files['TEAM']['id']}")
        owner_private = client.get(
            f"/api/files/{client_files['PRIVATE']['id']}", headers={"Authorization": f"Bearer {owner_token}"}
        )
    finally:
        monkeypatch.undo()

    assert public.status_code == 200
    assert private.status_code == 401 and team.status_code == 401
    assert owner_private.status_code == 200
