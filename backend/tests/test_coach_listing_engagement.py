from __future__ import annotations

from tests.test_coach_listings_api import _list_a_listing


def test_open_counts_once_per_guest_per_day_and_ignores_owner(logged_in_client) -> None:
    client, coach_token = logged_in_client
    listing = _list_a_listing(client, coach_token)
    url = f"/api/coach-listings/{listing['id']}/view"

    owner = client.post(url, headers={"Authorization": f"Bearer {coach_token}"})
    assert owner.status_code == 200
    assert owner.json()["views_count"] == 0

    first = client.post(url)
    assert first.status_code == 200
    assert first.json()["views_count"] == 1
    assert "listing_viewer" in first.headers.get("set-cookie", "")
    second = client.post(url)
    assert second.json()["views_count"] == 1

    mine = client.get("/api/coach-listings/me", headers={"Authorization": f"Bearer {coach_token}"}).json()
    assert mine[0]["views_count"] == 1


def test_unpublished_listing_cannot_be_viewed_or_saved(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    headers = {"Authorization": f"Bearer {coach_token}"}
    from tests.test_coach_listings_api import _create_coach_profile, _listing_payload

    _create_coach_profile(client, coach_token)
    listing = client.post("/api/coach-listings", headers=headers, json=_listing_payload()).json()
    player_token = login_as(881001)
    player_headers = {"Authorization": f"Bearer {player_token}"}
    assert client.put("/api/profile/player", headers=player_headers, json={"full_name": "Игрок", "sport": "Баскетбол"}).status_code == 200

    assert client.post(f"/api/coach-listings/{listing['id']}/view").status_code == 404
    assert client.put(f"/api/coach-listings/{listing['id']}/favorite", headers=player_headers).status_code == 404


def test_player_can_save_filter_and_remove_favorites(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    listing = _list_a_listing(client, coach_token)
    player_token = login_as(881002)
    headers = {"Authorization": f"Bearer {player_token}"}
    assert client.put("/api/profile/player", headers=headers, json={"full_name": "Игрок", "sport": "Баскетбол"}).status_code == 200
    favorite_url = f"/api/coach-listings/{listing['id']}/favorite"

    assert client.get("/api/coach-listings?favorite_only=true").status_code == 401
    assert client.put(favorite_url).status_code == 401
    assert client.get("/api/coach-listings?favorite_only=true", headers=headers).json() == []

    assert client.put(favorite_url, headers=headers).json() == {"is_favorite": True}
    assert client.put(favorite_url, headers=headers).status_code == 200
    favorites = client.get("/api/coach-listings?favorite_only=true", headers=headers).json()
    assert [item["id"] for item in favorites] == [listing["id"]]
    assert favorites[0]["is_favorite"] is True
    assert client.get(f"/api/coach-listings/{listing['id']}", headers=headers).json()["is_favorite"] is True
    assert client.get("/api/coach-listings?favorite_only=true", headers={"Authorization": f"Bearer {coach_token}"}).status_code == 403

    other_token = login_as(881003)
    other_headers = {"Authorization": f"Bearer {other_token}"}
    assert client.put("/api/profile/player", headers=other_headers, json={"full_name": "Другой игрок", "sport": "Баскетбол"}).status_code == 200
    assert client.get("/api/coach-listings?favorite_only=true", headers=other_headers).json() == []

    assert client.delete(favorite_url, headers=headers).status_code == 204
    assert client.get("/api/coach-listings?favorite_only=true", headers=headers).json() == []
