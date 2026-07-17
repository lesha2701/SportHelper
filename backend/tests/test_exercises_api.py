from __future__ import annotations

from tests.test_teams_api import _create_coach_profile, _create_team

_EXERCISE_PAYLOAD = {
    "sport": "Баскетбол",
    "name": "Броски со средней дистанции",
    "description": "10 бросков с 5 точек",
    "goal": "Точность броска",
    "sets": 5,
    "reps": 10,
    "duration_seconds": None,
    "rest_seconds": 60,
    "equipment": "Мячи",
    "difficulty": "amateur",
    "technique": None,
    "common_mistakes": None,
    "warnings": None,
    "coach_comment": None,
}


def test_create_exercise_requires_coach_profile(logged_in_client) -> None:
    client, token = logged_in_client
    response = client.post("/api/exercises", headers={"Authorization": f"Bearer {token}"}, json=_EXERCISE_PAYLOAD)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "coach_profile_required"


def test_create_and_list_own_exercise(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)

    create_resp = client.post("/api/exercises", headers=headers, json=_EXERCISE_PAYLOAD)
    assert create_resp.status_code == 200
    exercise = create_resp.json()
    assert exercise["name"] == "Броски со средней дистанции"
    assert exercise["shared_team_ids"] == []

    list_resp = client.get("/api/exercises/mine", headers=headers)
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1


def test_only_owner_can_update_or_delete_exercise(logged_in_client, login_as) -> None:
    client, owner_token = logged_in_client
    _create_coach_profile(client, owner_token)
    exercise = client.post(
        "/api/exercises", headers={"Authorization": f"Bearer {owner_token}"}, json=_EXERCISE_PAYLOAD
    ).json()

    other_token = login_as(700010, first_name="Other")
    other_headers = {"Authorization": f"Bearer {other_token}"}

    update_resp = client.put(f"/api/exercises/{exercise['id']}", headers=other_headers, json=_EXERCISE_PAYLOAD)
    assert update_resp.status_code == 404

    delete_resp = client.delete(f"/api/exercises/{exercise['id']}", headers=other_headers)
    assert delete_resp.status_code == 404

    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    delete_resp_owner = client.delete(f"/api/exercises/{exercise['id']}", headers=owner_headers)
    assert delete_resp_owner.status_code == 204


def test_share_exercise_requires_coaching_that_team(logged_in_client, login_as) -> None:
    client, owner_token = logged_in_client
    _create_coach_profile(client, owner_token)
    exercise = client.post(
        "/api/exercises", headers={"Authorization": f"Bearer {owner_token}"}, json=_EXERCISE_PAYLOAD
    ).json()

    other_token = login_as(700011, first_name="Other")
    _create_coach_profile(client, other_token, sport="Хоккей")
    other_team = _create_team(client, other_token, name="Другая команда")

    response = client.post(
        f"/api/exercises/{exercise['id']}/share",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"team_id": other_team["id"]},
    )
    assert response.status_code == 403


def test_share_and_team_members_can_see_exercise(logged_in_client, login_as) -> None:
    client, owner_token = logged_in_client
    _create_coach_profile(client, owner_token)
    team = _create_team(client, owner_token)
    exercise = client.post(
        "/api/exercises", headers={"Authorization": f"Bearer {owner_token}"}, json=_EXERCISE_PAYLOAD
    ).json()

    share_resp = client.post(
        f"/api/exercises/{exercise['id']}/share",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"team_id": team["id"]},
    )
    assert share_resp.status_code == 200
    assert team["id"] in share_resp.json()["shared_team_ids"]

    team_exercises = client.get(
        f"/api/teams/{team['id']}/exercises", headers={"Authorization": f"Bearer {owner_token}"}
    )
    assert team_exercises.status_code == 200
    assert len(team_exercises.json()) == 1

    outsider_token = login_as(700012, first_name="Outsider")
    forbidden = client.get(
        f"/api/teams/{team['id']}/exercises", headers={"Authorization": f"Bearer {outsider_token}"}
    )
    assert forbidden.status_code == 403

    unshare_resp = client.delete(
        f"/api/exercises/{exercise['id']}/share/{team['id']}", headers={"Authorization": f"Bearer {owner_token}"}
    )
    assert unshare_resp.status_code == 200
    assert unshare_resp.json()["shared_team_ids"] == []
