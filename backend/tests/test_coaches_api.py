from __future__ import annotations

from uuid import uuid4

from tests.test_bookings_api import _list_coach_with_slot, _listing_payload
from tests.test_teams_api import _create_coach_profile


def test_get_coach_public_profile(logged_in_client) -> None:
    client, coach_token = logged_in_client
    headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token, sport="Теннис")
    me = client.get("/api/auth/me", headers=headers).json()

    resp = client.get(f"/api/coaches/{me['id']}/profile", headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["user_id"] == me["id"]
    assert body["sport"] == "Теннис"
    assert body["average_rating"] is None
    assert body["review_count"] == 0


def test_get_coach_public_profile_404_for_non_coach(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    resp = client.get(f"/api/coaches/{uuid4()}/profile", headers=headers)
    assert resp.status_code == 404


def test_list_coach_public_listings_only_shows_published_ones(logged_in_client) -> None:
    client, coach_token = logged_in_client
    headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    me = client.get("/api/auth/me", headers=headers).json()

    listing_id, _ = _list_coach_with_slot(client, coach_token)
    client.post("/api/coach-listings", headers=headers, json=_listing_payload(title="Черновик", is_listed=False))

    resp = client.get(f"/api/coaches/{me['id']}/listings", headers=headers)
    assert resp.status_code == 200
    titles = [item["title"] for item in resp.json()]
    assert titles == ["Тренировки"]
    assert resp.json()[0]["id"] == listing_id


def test_list_coach_public_reviews(logged_in_client, login_as, monkeypatch) -> None:
    client, coach_token = logged_in_client
    headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    me = client.get("/api/auth/me", headers=headers).json()

    listing_id, slot = _list_coach_with_slot(client, coach_token)
    athlete_token = login_as(891101, first_name="Athlete")
    athlete_headers = {"Authorization": f"Bearer {athlete_token}"}
    booking = client.post(
        "/api/bookings", headers=athlete_headers, json={"listing_id": listing_id, "starts_at": slot, "format": "online"}
    ).json()

    import app.repositories.bookings as bookings_module

    monkeypatch.setattr(bookings_module, "is_completed", lambda booking: True)
    client.post(
        f"/api/bookings/{booking['id']}/reviews", headers=athlete_headers, json={"rating": 4, "text": "Хорошо"}
    )

    resp = client.get(f"/api/coaches/{me['id']}/reviews", headers=headers)
    assert resp.status_code == 200
    reviews = resp.json()
    assert len(reviews) == 1
    assert reviews[0]["rating"] == 4
    assert reviews[0]["text"] == "Хорошо"
    assert reviews[0]["athlete_first_name"] == "Athlete"

    # And the profile's aggregate now reflects it.
    profile = client.get(f"/api/coaches/{me['id']}/profile", headers=headers).json()
    assert profile["average_rating"] == 4.0
    assert profile["review_count"] == 1
