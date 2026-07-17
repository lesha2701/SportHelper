from __future__ import annotations

from tests.test_teams_api import _create_coach_profile

_EXERCISE_PAYLOAD = {
    "sport": "Волейбол",
    "name": "Приём мяча снизу",
    "description": None,
    "goal": None,
    "sets": 3,
    "reps": 15,
    "duration_seconds": None,
    "rest_seconds": 30,
    "equipment": None,
    "difficulty": "beginner",
    "technique": None,
    "common_mistakes": None,
    "warnings": None,
    "coach_comment": None,
}

_PLAN_PAYLOAD = {
    "sport": "Волейбол",
    "name": "Базовая тренировка приёма",
    "description": None,
    "duration_minutes": 60,
    "equipment": "Мячи, сетка",
    "comment": None,
}


def _create_exercise(client, token) -> dict:
    resp = client.post("/api/exercises", headers={"Authorization": f"Bearer {token}"}, json=_EXERCISE_PAYLOAD)
    assert resp.status_code == 200
    return resp.json()


def test_create_plan_requires_coach_profile(logged_in_client) -> None:
    client, token = logged_in_client
    response = client.post("/api/plans", headers={"Authorization": f"Bearer {token}"}, json=_PLAN_PAYLOAD)
    assert response.status_code == 409


def test_create_plan_and_add_exercises_by_section(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token, sport="Волейбол")
    exercise = _create_exercise(client, token)

    plan = client.post("/api/plans", headers=headers, json=_PLAN_PAYLOAD).json()

    add_resp = client.post(
        f"/api/plans/{plan['id']}/exercises",
        headers=headers,
        json={
            "exercise_id": exercise["id"],
            "section": "warmup",
            "order_index": 0,
            "sets": 2,
            "reps": 10,
            "duration_seconds": None,
            "rest_seconds": 20,
            "notes": "Лёгкий темп",
        },
    )
    assert add_resp.status_code == 200
    assert add_resp.json()["exercise_name"] == "Приём мяча снизу"

    detail = client.get(f"/api/plans/{plan['id']}", headers=headers).json()
    assert len(detail["exercises"]) == 1
    assert detail["exercises"][0]["section"] == "warmup"


def test_cannot_add_someone_elses_exercise_to_plan(logged_in_client, login_as) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token, sport="Волейбол")
    plan = client.post("/api/plans", headers=headers, json=_PLAN_PAYLOAD).json()

    other_token = login_as(700020, first_name="Other")
    _create_coach_profile(client, other_token, sport="Волейбол")
    other_exercise = _create_exercise(client, other_token)

    response = client.post(
        f"/api/plans/{plan['id']}/exercises",
        headers=headers,
        json={
            "exercise_id": other_exercise["id"],
            "section": "main",
            "order_index": 0,
            "sets": None,
            "reps": None,
            "duration_seconds": None,
            "rest_seconds": None,
            "notes": None,
        },
    )
    assert response.status_code == 404


def test_duplicate_plan_copies_exercises(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token, sport="Волейбол")
    exercise = _create_exercise(client, token)
    plan = client.post("/api/plans", headers=headers, json=_PLAN_PAYLOAD).json()
    client.post(
        f"/api/plans/{plan['id']}/exercises",
        headers=headers,
        json={
            "exercise_id": exercise["id"],
            "section": "main",
            "order_index": 0,
            "sets": None,
            "reps": None,
            "duration_seconds": None,
            "rest_seconds": None,
            "notes": None,
        },
    )

    dup_resp = client.post(f"/api/plans/{plan['id']}/duplicate", headers=headers)
    assert dup_resp.status_code == 200
    duplicate = dup_resp.json()
    assert duplicate["id"] != plan["id"]
    assert duplicate["name"] == f"{plan['name']} (копия)"
    assert len(duplicate["exercises"]) == 1

    list_resp = client.get("/api/plans/mine", headers=headers)
    assert len(list_resp.json()) == 2


def test_remove_plan_exercise(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token, sport="Волейбол")
    exercise = _create_exercise(client, token)
    plan = client.post("/api/plans", headers=headers, json=_PLAN_PAYLOAD).json()
    plan_exercise = client.post(
        f"/api/plans/{plan['id']}/exercises",
        headers=headers,
        json={
            "exercise_id": exercise["id"],
            "section": "cooldown",
            "order_index": 0,
            "sets": None,
            "reps": None,
            "duration_seconds": None,
            "rest_seconds": None,
            "notes": None,
        },
    ).json()

    remove_resp = client.delete(
        f"/api/plans/{plan['id']}/exercises/{plan_exercise['id']}", headers=headers
    )
    assert remove_resp.status_code == 204

    detail = client.get(f"/api/plans/{plan['id']}", headers=headers).json()
    assert detail["exercises"] == []


def test_plan_not_visible_to_other_users(logged_in_client, login_as) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token, sport="Волейбол")
    plan = client.post("/api/plans", headers=headers, json=_PLAN_PAYLOAD).json()

    other_token = login_as(700021, first_name="Other")
    response = client.get(f"/api/plans/{plan['id']}", headers={"Authorization": f"Bearer {other_token}"})
    assert response.status_code == 403


def test_share_plan_requires_coaching_that_team(logged_in_client, login_as) -> None:
    client, owner_token = logged_in_client
    headers = {"Authorization": f"Bearer {owner_token}"}
    _create_coach_profile(client, owner_token, sport="Волейбол")
    plan = client.post("/api/plans", headers=headers, json=_PLAN_PAYLOAD).json()

    other_token = login_as(700030, first_name="Other")
    _create_coach_profile(client, other_token, sport="Волейбол")
    other_team = client.post(
        "/api/teams",
        headers={"Authorization": f"Bearer {other_token}"},
        json={"name": "Чужая команда", "description": None, "sport": "Волейбол", "age_category": None, "level": None},
    ).json()

    response = client.post(f"/api/plans/{plan['id']}/share", headers=headers, json={"team_id": other_team["id"]})
    assert response.status_code == 403


def test_share_plan_and_team_members_can_see_it(logged_in_client, login_as) -> None:
    client, owner_token = logged_in_client
    headers = {"Authorization": f"Bearer {owner_token}"}
    _create_coach_profile(client, owner_token, sport="Волейбол")
    team = client.post(
        "/api/teams",
        headers=headers,
        json={"name": "Моя команда", "description": None, "sport": "Волейбол", "age_category": None, "level": None},
    ).json()
    plan = client.post("/api/plans", headers=headers, json=_PLAN_PAYLOAD).json()

    share_resp = client.post(f"/api/plans/{plan['id']}/share", headers=headers, json={"team_id": team["id"]})
    assert share_resp.status_code == 200
    assert team["id"] in share_resp.json()["shared_team_ids"]

    team_plans = client.get(f"/api/teams/{team['id']}/plans", headers=headers)
    assert team_plans.status_code == 200
    assert len(team_plans.json()) == 1

    outsider_token = login_as(700031, first_name="Outsider")
    forbidden = client.get(f"/api/teams/{team['id']}/plans", headers={"Authorization": f"Bearer {outsider_token}"})
    assert forbidden.status_code == 403

    get_resp = client.get(f"/api/plans/{plan['id']}", headers=headers)
    assert get_resp.status_code == 200

    unshare_resp = client.delete(f"/api/plans/{plan['id']}/share/{team['id']}", headers=headers)
    assert unshare_resp.status_code == 200
    assert unshare_resp.json()["shared_team_ids"] == []
