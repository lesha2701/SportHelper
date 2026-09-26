from __future__ import annotations

from tests.test_teams_api import _create_coach_profile, _create_team


def test_search_requires_auth(client) -> None:
    assert client.get("/api/search", params={"q": "яст"}).status_code == 401


def test_search_finds_own_team_and_ignores_too_short_queries(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)
    team = _create_team(client, token, name="Ястребы")

    found = client.get("/api/search", params={"q": "ястр"}, headers=headers).json()
    assert [(r["type"], r["id"], r["title"]) for r in found] == [("team", team["id"], "Ястребы")]

    assert client.get("/api/search", params={"q": "я"}, headers=headers).json() == []
    assert client.get("/api/search", params={"q": "  "}, headers=headers).json() == []
