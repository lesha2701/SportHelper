from __future__ import annotations

from uuid import uuid4

from tests.test_ai_api import _create_player_profile
from tests.test_bookings_api import _list_coach_with_slot
from tests.test_teams_api import _create_coach_profile


def test_player_can_view_own_profile(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_player_profile(client, token)
    me = client.get("/api/auth/me", headers=headers).json()

    resp = client.get(f"/api/players/{me['id']}/profile", headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["full_name"] == "Игрок"


def test_own_profile_404_when_not_filled_in_yet(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    me = client.get("/api/auth/me", headers=headers).json()
    resp = client.get(f"/api/players/{me['id']}/profile", headers=headers)
    assert resp.status_code == 404


def test_unrelated_user_gets_403_for_a_random_id(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    resp = client.get(f"/api/players/{uuid4()}/profile", headers=headers)
    assert resp.status_code == 403


def test_unrelated_coach_cannot_view_player_profile(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)

    athlete_token = login_as(892001, first_name="Athlete")
    athlete_headers = {"Authorization": f"Bearer {athlete_token}"}
    _create_player_profile(client, athlete_token)
    athlete = client.get("/api/auth/me", headers=athlete_headers).json()

    resp = client.get(f"/api/players/{athlete['id']}/profile", headers={"Authorization": f"Bearer {coach_token}"})
    assert resp.status_code == 403


def test_coach_can_view_player_profile_once_booking_requested(logged_in_client, login_as) -> None:
    """The coach must be able to see the athlete's profile while triaging a
    pending request, not just after accepting it."""
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    listing_id, slot = _list_coach_with_slot(client, coach_token)

    athlete_token = login_as(892002, first_name="Athlete")
    athlete_headers = {"Authorization": f"Bearer {athlete_token}"}
    _create_player_profile(client, athlete_token, sport="Баскетбол")
    athlete = client.get("/api/auth/me", headers=athlete_headers).json()

    booking = client.post(
        "/api/bookings", headers=athlete_headers, json={"listing_id": listing_id, "starts_at": slot, "format": "online"}
    ).json()
    assert booking["status"] == "pending"

    resp = client.get(f"/api/players/{athlete['id']}/profile", headers=coach_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["sport"] == "Баскетбол"

    # Still visible after the coach confirms it.
    client.post(f"/api/bookings/{booking['id']}/confirm", headers=coach_headers)
    resp2 = client.get(f"/api/players/{athlete['id']}/profile", headers=coach_headers)
    assert resp2.status_code == 200
