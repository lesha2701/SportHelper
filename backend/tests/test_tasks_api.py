from __future__ import annotations

import io
from datetime import date, timedelta

from tests.test_teams_api import _add_player_to_team, _create_coach_profile, _create_team, _member_user_id

_TOMORROW = (date.today() + timedelta(days=1)).isoformat()

_TRAINING_PAYLOAD = {
    "training_date": _TOMORROW,
    "start_time": "18:00:00",
    "duration_minutes": 90,
    "location": "Зал №1",
    "description": None,
    "plan_id": None,
    "reminder_minutes_before": None,
    "repeat_weekly_until": None,
}

_BASE_TASK_PAYLOAD = {
    "title": "Растяжка дома",
    "description": "20 минут растяжки перед сном",
    "plan_id": None,
    "exercise_ids": [],
    "deadline": None,
    "metric_name": None,
    "metric_unit": None,
    "metric_target": None,
    "require_comment": False,
    "require_photo": False,
    "require_video": False,
    "require_sets_reps": False,
    "require_duration": False,
    "require_metric_value": False,
    "require_difficulty": False,
    "require_wellbeing": False,
    "target_type": "team",
    "player_ids": [],
    "position": None,
    "training_id": None,
}


def _set_position(client, coach_token, team_id, user_id, position: str) -> None:
    resp = client.patch(
        f"/api/teams/{team_id}/members/{user_id}",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"position": position},
    )
    assert resp.status_code == 200


def _png_bytes(size: int = 20) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"0" * size


def test_only_coach_staff_can_create_task(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(820001, first_name="Player")
    _add_player_to_team(client, coach_token, team["id"], player_token)

    response = client.post(
        f"/api/teams/{team['id']}/tasks",
        headers={"Authorization": f"Bearer {player_token}"},
        json=_BASE_TASK_PAYLOAD,
    )
    assert response.status_code == 403


def test_create_task_for_whole_team_assigns_players_and_captain_but_not_coach(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(820002, first_name="Player")
    _add_player_to_team(client, coach_token, team["id"], player_token)
    player_id = _member_user_id(client, team["id"], coach_token, 820002)

    captain_token = login_as(820003, first_name="Captain")
    _add_player_to_team(client, coach_token, team["id"], captain_token)
    captain_id = _member_user_id(client, team["id"], coach_token, 820003)
    client.patch(
        f"/api/teams/{team['id']}/members/{captain_id}", headers=coach_headers, json={"role": "captain"}
    )

    response = client.post(f"/api/teams/{team['id']}/tasks", headers=coach_headers, json=_BASE_TASK_PAYLOAD)
    assert response.status_code == 200
    task = response.json()
    assignee_ids = {a["user_id"] for a in task["assignments"]}
    assert assignee_ids == {player_id, captain_id}
    assert all(a["status"] == "assigned" for a in task["assignments"])


def test_create_task_for_specific_players(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player1_token = login_as(820004, first_name="One")
    _add_player_to_team(client, coach_token, team["id"], player1_token)
    player1_id = _member_user_id(client, team["id"], coach_token, 820004)

    player2_token = login_as(820005, first_name="Two")
    _add_player_to_team(client, coach_token, team["id"], player2_token)

    payload = {**_BASE_TASK_PAYLOAD, "target_type": "players", "player_ids": [player1_id]}
    response = client.post(f"/api/teams/{team['id']}/tasks", headers=coach_headers, json=payload)
    assert response.status_code == 200
    assignee_ids = {a["user_id"] for a in response.json()["assignments"]}
    assert assignee_ids == {player1_id}


def test_create_task_by_position(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    goalkeeper_token = login_as(820006, first_name="Keeper")
    _add_player_to_team(client, coach_token, team["id"], goalkeeper_token)
    goalkeeper_id = _member_user_id(client, team["id"], coach_token, 820006)
    _set_position(client, coach_token, team["id"], goalkeeper_id, "Вратарь")

    forward_token = login_as(820007, first_name="Forward")
    _add_player_to_team(client, coach_token, team["id"], forward_token)
    forward_id = _member_user_id(client, team["id"], coach_token, 820007)
    _set_position(client, coach_token, team["id"], forward_id, "Нападающий")

    payload = {**_BASE_TASK_PAYLOAD, "target_type": "position", "position": "Вратарь"}
    response = client.post(f"/api/teams/{team['id']}/tasks", headers=coach_headers, json=payload)
    assert response.status_code == 200
    assignee_ids = {a["user_id"] for a in response.json()["assignments"]}
    assert assignee_ids == {goalkeeper_id}


def test_create_task_for_training_absentees(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    absent_token = login_as(820008, first_name="Absent")
    _add_player_to_team(client, coach_token, team["id"], absent_token)
    absent_id = _member_user_id(client, team["id"], coach_token, 820008)

    present_token = login_as(820009, first_name="Present")
    _add_player_to_team(client, coach_token, team["id"], present_token)

    training = client.post(
        f"/api/teams/{team['id']}/trainings", headers=coach_headers, json=_TRAINING_PAYLOAD
    ).json()[0]
    client.patch(
        f"/api/trainings/{training['id']}/attendance/{absent_id}", headers=coach_headers, json={"status": "absent"}
    )

    payload = {**_BASE_TASK_PAYLOAD, "target_type": "absentees", "training_id": training["id"]}
    response = client.post(f"/api/teams/{team['id']}/tasks", headers=coach_headers, json=payload)
    assert response.status_code == 200
    assignee_ids = {a["user_id"] for a in response.json()["assignments"]}
    assert assignee_ids == {absent_id}


def test_create_task_with_no_recipients_fails(logged_in_client) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    response = client.post(
        f"/api/teams/{team['id']}/tasks",
        headers={"Authorization": f"Bearer {coach_token}"},
        json=_BASE_TASK_PAYLOAD,
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "no_recipients"


def _setup_team_with_one_player(client, coach_token, login_as, telegram_id: int):
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)
    player_token = login_as(telegram_id, first_name="Player")
    _add_player_to_team(client, coach_token, team["id"], player_token)
    player_id = _member_user_id(client, team["id"], coach_token, telegram_id)
    return team, player_token, player_id


def test_viewing_task_marks_it_viewed_once(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    team, player_token, player_id = _setup_team_with_one_player(client, coach_token, login_as, 820010)
    player_headers = {"Authorization": f"Bearer {player_token}"}

    task = client.post(f"/api/teams/{team['id']}/tasks", headers=coach_headers, json=_BASE_TASK_PAYLOAD).json()

    first_view = client.get(f"/api/tasks/{task['id']}", headers=player_headers)
    assert first_view.status_code == 200
    assert first_view.json()["assignments"][0]["status"] == "viewed"

    other_token = login_as(820011, first_name="Outsider")
    forbidden = client.get(f"/api/tasks/{task['id']}", headers={"Authorization": f"Bearer {other_token}"})
    assert forbidden.status_code == 403


def test_submit_requires_flagged_fields(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    team, player_token, player_id = _setup_team_with_one_player(client, coach_token, login_as, 820012)
    player_headers = {"Authorization": f"Bearer {player_token}"}

    payload = {**_BASE_TASK_PAYLOAD, "require_comment": True, "require_difficulty": True}
    task = client.post(f"/api/teams/{team['id']}/tasks", headers=coach_headers, json=payload).json()

    incomplete = client.post(f"/api/tasks/{task['id']}/submit", headers=player_headers, json={})
    assert incomplete.status_code == 422
    assert incomplete.json()["error"]["code"] == "submission_incomplete"

    complete = client.post(
        f"/api/tasks/{task['id']}/submit",
        headers=player_headers,
        json={"comment": "Сделано", "difficulty": 6},
    )
    assert complete.status_code == 200
    assert complete.json()["status"] == "submitted"


def test_submit_requires_photo_when_flagged(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    team, player_token, player_id = _setup_team_with_one_player(client, coach_token, login_as, 820013)
    player_headers = {"Authorization": f"Bearer {player_token}"}

    payload = {**_BASE_TASK_PAYLOAD, "require_photo": True}
    task = client.post(f"/api/teams/{team['id']}/tasks", headers=coach_headers, json=payload).json()

    missing_photo = client.post(f"/api/tasks/{task['id']}/submit", headers=player_headers, json={})
    assert missing_photo.status_code == 422

    upload = client.post(
        f"/api/tasks/{task['id']}/submit/photo",
        headers=player_headers,
        files={"file": ("photo.png", io.BytesIO(_png_bytes()), "image/png")},
    )
    assert upload.status_code == 200
    assert upload.json()["photo_file_id"] is not None

    ok = client.post(f"/api/tasks/{task['id']}/submit", headers=player_headers, json={})
    assert ok.status_code == 200
    assert ok.json()["status"] == "submitted"


def test_review_and_resubmission_clears_review(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    team, player_token, player_id = _setup_team_with_one_player(client, coach_token, login_as, 820014)
    player_headers = {"Authorization": f"Bearer {player_token}"}

    task = client.post(f"/api/teams/{team['id']}/tasks", headers=coach_headers, json=_BASE_TASK_PAYLOAD).json()
    client.post(f"/api/tasks/{task['id']}/submit", headers=player_headers, json={})

    revision = client.post(
        f"/api/tasks/{task['id']}/review/{player_id}",
        headers=coach_headers,
        json={"decision": "needs_revision", "coach_comment": "Добавь фото"},
    )
    assert revision.status_code == 200
    assert revision.json()["status"] == "needs_revision"

    resubmit = client.post(f"/api/tasks/{task['id']}/submit", headers=player_headers, json={})
    assert resubmit.status_code == 200
    assert resubmit.json()["status"] == "submitted"
    assert resubmit.json()["coach_comment"] is None

    accept = client.post(
        f"/api/tasks/{task['id']}/review/{player_id}",
        headers=coach_headers,
        json={"decision": "accepted", "coach_comment": None},
    )
    assert accept.status_code == 200
    assert accept.json()["status"] == "accepted"


def test_non_coach_cannot_review(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    team, player_token, player_id = _setup_team_with_one_player(client, coach_token, login_as, 820015)

    task = client.post(f"/api/teams/{team['id']}/tasks", headers=coach_headers, json=_BASE_TASK_PAYLOAD).json()

    response = client.post(
        f"/api/tasks/{task['id']}/review/{player_id}",
        headers={"Authorization": f"Bearer {player_token}"},
        json={"decision": "accepted", "coach_comment": None},
    )
    assert response.status_code == 403


def test_list_my_tasks(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    team, player_token, player_id = _setup_team_with_one_player(client, coach_token, login_as, 820016)
    player_headers = {"Authorization": f"Bearer {player_token}"}

    client.post(f"/api/teams/{team['id']}/tasks", headers=coach_headers, json=_BASE_TASK_PAYLOAD)

    mine = client.get("/api/tasks/mine", headers=player_headers)
    assert mine.status_code == 200
    items = mine.json()
    assert len(items) == 1
    assert items[0]["task"]["title"] == "Растяжка дома"
    assert items[0]["assignment"]["user_id"] == player_id
    assert items[0]["assignment"]["status"] == "assigned"


def test_delete_task_cancels_open_assignments(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    team, player_token, player_id = _setup_team_with_one_player(client, coach_token, login_as, 820017)

    task = client.post(f"/api/teams/{team['id']}/tasks", headers=coach_headers, json=_BASE_TASK_PAYLOAD).json()

    delete_resp = client.delete(f"/api/tasks/{task['id']}", headers=coach_headers)
    assert delete_resp.status_code == 204

    get_resp = client.get(f"/api/tasks/{task['id']}", headers=coach_headers)
    assert get_resp.status_code == 404


def test_start_task_requires_assignment_and_rejects_double_start(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    team, player_token, player_id = _setup_team_with_one_player(client, coach_token, login_as, 820018)
    player_headers = {"Authorization": f"Bearer {player_token}"}

    task = client.post(f"/api/teams/{team['id']}/tasks", headers=coach_headers, json=_BASE_TASK_PAYLOAD).json()

    outsider_token = login_as(820019, first_name="Outsider")
    not_assigned = client.post(f"/api/tasks/{task['id']}/start", headers={"Authorization": f"Bearer {outsider_token}"})
    assert not_assigned.status_code == 403

    first_start = client.post(f"/api/tasks/{task['id']}/start", headers=player_headers)
    assert first_start.status_code == 200
    assert first_start.json()["status"] == "in_progress"

    second_start = client.post(f"/api/tasks/{task['id']}/start", headers=player_headers)
    assert second_start.status_code == 409
    assert second_start.json()["error"]["code"] == "invalid_status"


def test_update_task_rejects_foreign_plan_and_exercise(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    team, player_token, player_id = _setup_team_with_one_player(client, coach_token, login_as, 820020)
    task = client.post(f"/api/teams/{team['id']}/tasks", headers=coach_headers, json=_BASE_TASK_PAYLOAD).json()

    other_coach_token = login_as(820021, first_name="OtherCoach")
    _create_coach_profile(client, other_coach_token, sport="Баскетбол")
    other_plan = client.post(
        "/api/plans", headers={"Authorization": f"Bearer {other_coach_token}"},
        json={"sport": "Баскетбол", "name": "Чужой план", "description": None, "duration_minutes": None, "equipment": None, "comment": None},
    ).json()

    update_payload = {**_BASE_TASK_PAYLOAD, "plan_id": other_plan["id"]}
    del update_payload["target_type"], update_payload["player_ids"], update_payload["position"], update_payload["training_id"]
    bad_plan = client.put(f"/api/tasks/{task['id']}", headers=coach_headers, json=update_payload)
    assert bad_plan.status_code == 404

    other_exercise = client.post(
        "/api/exercises", headers={"Authorization": f"Bearer {other_coach_token}"},
        json={"sport": "Баскетбол", "name": "Чужое упражнение", "description": None, "goal": None, "sets": None,
              "reps": None, "duration_seconds": None, "rest_seconds": None, "equipment": None, "difficulty": None,
              "technique": None, "common_mistakes": None, "warnings": None, "coach_comment": None},
    ).json()
    update_payload = {**_BASE_TASK_PAYLOAD, "plan_id": None, "exercise_ids": [other_exercise["id"]]}
    del update_payload["target_type"], update_payload["player_ids"], update_payload["position"], update_payload["training_id"]
    bad_exercise = client.put(f"/api/tasks/{task['id']}", headers=coach_headers, json=update_payload)
    assert bad_exercise.status_code == 404
