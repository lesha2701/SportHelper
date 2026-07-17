from __future__ import annotations

from datetime import date, timedelta

from tests.test_teams_api import _add_player_to_team, _create_coach_profile, _create_team, _member_user_id

_TOMORROW = (date.today() + timedelta(days=1)).isoformat()

_BASE_MATCH_PAYLOAD = {
    "opponent_name": "Соседи",
    "match_date": _TOMORROW,
    "start_time": "15:00:00",
    "location": "Стадион №2",
    "is_home": True,
    "tournament": "Кубок города",
}


def test_only_coach_staff_can_create_match(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(840001, first_name="Player")
    _add_player_to_team(client, coach_token, team["id"], player_token)

    response = client.post(
        f"/api/teams/{team['id']}/matches",
        headers={"Authorization": f"Bearer {player_token}"},
        json=_BASE_MATCH_PAYLOAD,
    )
    assert response.status_code == 403


def test_create_and_get_match(logged_in_client) -> None:
    client, coach_token = logged_in_client
    headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    create_resp = client.post(f"/api/teams/{team['id']}/matches", headers=headers, json=_BASE_MATCH_PAYLOAD)
    assert create_resp.status_code == 200
    match = create_resp.json()
    assert match["opponent_name"] == "Соседи"
    assert match["status"] == "scheduled"
    assert match["result"] is None

    get_resp = client.get(f"/api/matches/{match['id']}", headers=headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == match["id"]


def test_any_team_member_can_view_match(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(840002, first_name="Player")
    _add_player_to_team(client, coach_token, team["id"], player_token)

    match = client.post(f"/api/teams/{team['id']}/matches", headers=coach_headers, json=_BASE_MATCH_PAYLOAD).json()

    response = client.get(f"/api/matches/{match['id']}", headers={"Authorization": f"Bearer {player_token}"})
    assert response.status_code == 200


def test_outsider_cannot_view_match(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)
    match = client.post(f"/api/teams/{team['id']}/matches", headers=coach_headers, json=_BASE_MATCH_PAYLOAD).json()

    outsider_token = login_as(840003, first_name="Outsider")
    response = client.get(f"/api/matches/{match['id']}", headers={"Authorization": f"Bearer {outsider_token}"})
    assert response.status_code == 403


def test_set_roster(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(840004, first_name="Player")
    _add_player_to_team(client, coach_token, team["id"], player_token)
    player_id = _member_user_id(client, team["id"], coach_token, 840004)

    match = client.post(f"/api/teams/{team['id']}/matches", headers=coach_headers, json=_BASE_MATCH_PAYLOAD).json()

    response = client.put(f"/api/matches/{match['id']}/roster", headers=coach_headers, json={"user_ids": [player_id]})
    assert response.status_code == 200
    roster_ids = {m["user_id"] for m in response.json()["roster"]}
    assert roster_ids == {player_id}


def test_set_roster_rejects_non_member(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)
    match = client.post(f"/api/teams/{team['id']}/matches", headers=coach_headers, json=_BASE_MATCH_PAYLOAD).json()

    outsider_token = login_as(840005, first_name="Outsider")
    outsider = client.get("/api/auth/me", headers={"Authorization": f"Bearer {outsider_token}"}).json()

    response = client.put(f"/api/matches/{match['id']}/roster", headers=coach_headers, json={"user_ids": [outsider["id"]]})
    assert response.status_code == 404


def test_set_result_computes_win_loss_draw(logged_in_client) -> None:
    client, coach_token = logged_in_client
    headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)
    match = client.post(f"/api/teams/{team['id']}/matches", headers=headers, json=_BASE_MATCH_PAYLOAD).json()

    win_resp = client.post(
        f"/api/matches/{match['id']}/result", headers=headers, json={"our_score": 3, "opponent_score": 1, "comment": "Отличная игра"}
    )
    assert win_resp.status_code == 200
    assert win_resp.json()["result"] == "win"
    assert win_resp.json()["status"] == "completed"
    assert win_resp.json()["comment"] == "Отличная игра"

    draw_resp = client.post(
        f"/api/matches/{match['id']}/result", headers=headers, json={"our_score": 2, "opponent_score": 2, "comment": None}
    )
    assert draw_resp.json()["result"] == "draw"

    loss_resp = client.post(
        f"/api/matches/{match['id']}/result", headers=headers, json={"our_score": 0, "opponent_score": 1, "comment": None}
    )
    assert loss_resp.json()["result"] == "loss"


def test_non_coach_cannot_set_result(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)
    match = client.post(f"/api/teams/{team['id']}/matches", headers=coach_headers, json=_BASE_MATCH_PAYLOAD).json()

    player_token = login_as(840007, first_name="Player")
    _add_player_to_team(client, coach_token, team["id"], player_token)

    response = client.post(
        f"/api/matches/{match['id']}/result",
        headers={"Authorization": f"Bearer {player_token}"},
        json={"our_score": 1, "opponent_score": 0, "comment": None},
    )
    assert response.status_code == 403


def test_update_match_status(logged_in_client) -> None:
    client, coach_token = logged_in_client
    headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)
    match = client.post(f"/api/teams/{team['id']}/matches", headers=headers, json=_BASE_MATCH_PAYLOAD).json()

    update_payload = {**_BASE_MATCH_PAYLOAD, "status": "cancelled"}
    response = client.put(f"/api/matches/{match['id']}", headers=headers, json=update_payload)
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"


def test_delete_match_soft_deletes(logged_in_client) -> None:
    client, coach_token = logged_in_client
    headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)
    match = client.post(f"/api/teams/{team['id']}/matches", headers=headers, json=_BASE_MATCH_PAYLOAD).json()

    delete_resp = client.delete(f"/api/matches/{match['id']}", headers=headers)
    assert delete_resp.status_code == 204

    get_resp = client.get(f"/api/matches/{match['id']}", headers=headers)
    assert get_resp.status_code == 404


def test_list_team_matches_omits_roster(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(840008, first_name="Player")
    _add_player_to_team(client, coach_token, team["id"], player_token)
    player_id = _member_user_id(client, team["id"], coach_token, 840008)

    match = client.post(f"/api/teams/{team['id']}/matches", headers=coach_headers, json=_BASE_MATCH_PAYLOAD).json()
    client.put(f"/api/matches/{match['id']}/roster", headers=coach_headers, json={"user_ids": [player_id]})

    list_resp = client.get(f"/api/teams/{team['id']}/matches", headers=coach_headers)
    assert list_resp.status_code == 200
    assert list_resp.json()[0]["roster"] == []
