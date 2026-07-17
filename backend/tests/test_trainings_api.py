from __future__ import annotations

from datetime import date, timedelta

from tests.test_teams_api import _add_player_to_team, _create_coach_profile, _create_team, _member_user_id

_TOMORROW = (date.today() + timedelta(days=1)).isoformat()
_IN_THREE_WEEKS = (date.today() + timedelta(days=21)).isoformat()

_TRAINING_PAYLOAD = {
    "training_date": _TOMORROW,
    "start_time": "18:00:00",
    "duration_minutes": 90,
    "location": "Зал №1",
    "description": None,
    "plan_id": None,
    "reminder_minutes_before": 60,
    "repeat_weekly_until": None,
}


def _mark_completed(client, coach_headers: dict, training: dict) -> None:
    resp = client.put(
        f"/api/trainings/{training['id']}",
        headers=coach_headers,
        json={
            "training_date": training["training_date"],
            "start_time": training["start_time"],
            "duration_minutes": training["duration_minutes"],
            "location": training["location"],
            "description": training["description"],
            "plan_id": training["plan_id"],
            "reminder_minutes_before": training["reminder_minutes_before"],
            "status": "completed",
            "is_independent": training["type"] == "independent",
            "responsible_user_id": training["responsible_user_id"],
        },
    )
    assert resp.status_code == 200, resp.text


def test_only_coach_staff_can_create_team_training(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(800001, first_name="Player")
    _add_player_to_team(client, coach_token, team["id"], player_token)

    response = client.post(
        f"/api/teams/{team['id']}/trainings",
        headers={"Authorization": f"Bearer {player_token}"},
        json=_TRAINING_PAYLOAD,
    )
    assert response.status_code == 403


def test_create_and_list_team_training(logged_in_client) -> None:
    client, coach_token = logged_in_client
    headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    create_resp = client.post(f"/api/teams/{team['id']}/trainings", headers=headers, json=_TRAINING_PAYLOAD)
    assert create_resp.status_code == 200
    trainings = create_resp.json()
    assert len(trainings) == 1
    assert trainings[0]["type"] == "team"
    assert trainings[0]["status"] == "scheduled"

    list_resp = client.get(f"/api/teams/{team['id']}/trainings", headers=headers)
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1


def test_recurring_training_creates_weekly_series(logged_in_client) -> None:
    client, coach_token = logged_in_client
    headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    payload = {**_TRAINING_PAYLOAD, "repeat_weekly_until": _IN_THREE_WEEKS}
    response = client.post(f"/api/teams/{team['id']}/trainings", headers=headers, json=payload)
    assert response.status_code == 200
    trainings = response.json()
    assert len(trainings) == 3  # tomorrow, +7 days, +14 days (day 21 would be the 4th, but +1+21=22 > until)
    group_ids = {t["recurrence_group_id"] for t in trainings}
    assert len(group_ids) == 1
    assert None not in group_ids


def test_cancel_series_cancels_all_occurrences(logged_in_client) -> None:
    client, coach_token = logged_in_client
    headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    payload = {**_TRAINING_PAYLOAD, "repeat_weekly_until": _IN_THREE_WEEKS}
    trainings = client.post(f"/api/teams/{team['id']}/trainings", headers=headers, json=payload).json()

    cancel_resp = client.post(f"/api/trainings/{trainings[0]['id']}/cancel-series", headers=headers)
    assert cancel_resp.status_code == 204

    for t in trainings:
        detail = client.get(f"/api/trainings/{t['id']}", headers=headers).json()
        assert detail["status"] == "cancelled"


def test_personal_training_is_private_to_owner(logged_in_client, login_as) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    create_resp = client.post("/api/trainings/personal", headers=headers, json=_TRAINING_PAYLOAD)
    assert create_resp.status_code == 200
    training = create_resp.json()[0]
    assert training["type"] == "personal"
    assert training["team_id"] is None

    other_token = login_as(800002, first_name="Other")
    forbidden = client.get(f"/api/trainings/{training['id']}", headers={"Authorization": f"Bearer {other_token}"})
    assert forbidden.status_code == 403

    mine_resp = client.get("/api/trainings/mine", headers=headers)
    assert len(mine_resp.json()) == 1


def test_attendance_defaults_present_and_coach_can_mark_absent(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(800003, first_name="Absentee")
    _add_player_to_team(client, coach_token, team["id"], player_token)
    player_id = _member_user_id(client, team["id"], coach_token, 800003)

    training = client.post(f"/api/teams/{team['id']}/trainings", headers=coach_headers, json=_TRAINING_PAYLOAD).json()[0]

    attendance = client.get(f"/api/trainings/{training['id']}/attendance", headers=coach_headers).json()
    assert len(attendance) == 2  # coach (head_coach) + the player
    assert all(a["status"] == "present" for a in attendance)

    mark_resp = client.patch(
        f"/api/trainings/{training['id']}/attendance/{player_id}", headers=coach_headers, json={"status": "absent"}
    )
    assert mark_resp.status_code == 200
    assert mark_resp.json()["status"] == "absent"

    attendance_after = client.get(f"/api/trainings/{training['id']}/attendance", headers=coach_headers).json()
    statuses = {a["user_id"]: a["status"] for a in attendance_after}
    assert statuses[player_id] == "absent"


def test_player_cannot_mark_attendance(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(800004, first_name="Player")
    _add_player_to_team(client, coach_token, team["id"], player_token)
    player_id = _member_user_id(client, team["id"], coach_token, 800004)

    training = client.post(f"/api/teams/{team['id']}/trainings", headers=coach_headers, json=_TRAINING_PAYLOAD).json()[0]

    response = client.patch(
        f"/api/trainings/{training['id']}/attendance/{player_id}",
        headers={"Authorization": f"Bearer {player_token}"},
        json={"status": "absent"},
    )
    assert response.status_code == 403


def test_update_training_requires_edit_access(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(800005, first_name="Player")
    _add_player_to_team(client, coach_token, team["id"], player_token)

    training = client.post(f"/api/teams/{team['id']}/trainings", headers=coach_headers, json=_TRAINING_PAYLOAD).json()[0]

    update_payload = {
        "training_date": _TOMORROW,
        "start_time": "19:00:00",
        "duration_minutes": 60,
        "location": "Зал №2",
        "description": "Изменено",
        "plan_id": None,
        "reminder_minutes_before": None,
        "status": "scheduled",
    }
    forbidden = client.put(
        f"/api/trainings/{training['id']}", headers={"Authorization": f"Bearer {player_token}"}, json=update_payload
    )
    assert forbidden.status_code == 403

    ok = client.put(f"/api/trainings/{training['id']}", headers=coach_headers, json=update_payload)
    assert ok.status_code == 200
    assert ok.json()["location"] == "Зал №2"


def test_delete_training_soft_deletes(logged_in_client) -> None:
    client, coach_token = logged_in_client
    headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    training = client.post(f"/api/teams/{team['id']}/trainings", headers=headers, json=_TRAINING_PAYLOAD).json()[0]

    delete_resp = client.delete(f"/api/trainings/{training['id']}", headers=headers)
    assert delete_resp.status_code == 204

    get_resp = client.get(f"/api/trainings/{training['id']}", headers=headers)
    assert get_resp.status_code == 404


def test_training_feedback_rejected_before_completed(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(830004, first_name="TooEarly")
    _add_player_to_team(client, coach_token, team["id"], player_token)
    player_headers = {"Authorization": f"Bearer {player_token}"}

    training = client.post(f"/api/teams/{team['id']}/trainings", headers=coach_headers, json=_TRAINING_PAYLOAD).json()[0]

    submit = client.post(
        f"/api/trainings/{training['id']}/feedback", headers=player_headers, json={"wellbeing": 5, "difficulty": None, "comment": None}
    )
    assert submit.status_code == 409
    assert submit.json()["error"]["code"] == "training_not_completed"

    skip = client.post(f"/api/trainings/{training['id']}/feedback/skip", headers=player_headers)
    assert skip.status_code == 409


def test_training_feedback_submit_and_skip(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(830001, first_name="Feedback")
    _add_player_to_team(client, coach_token, team["id"], player_token)
    player_headers = {"Authorization": f"Bearer {player_token}"}

    training = client.post(f"/api/teams/{team['id']}/trainings", headers=coach_headers, json=_TRAINING_PAYLOAD).json()[0]
    _mark_completed(client, coach_headers, training)

    empty = client.get(f"/api/trainings/{training['id']}/feedback", headers=player_headers)
    assert empty.status_code == 200
    assert empty.json() is None

    submit = client.post(
        f"/api/trainings/{training['id']}/feedback",
        headers=player_headers,
        json={"wellbeing": 4, "difficulty": 7, "comment": "Тяжеловато, но норм"},
    )
    assert submit.status_code == 200, submit.text
    body = submit.json()
    assert body["wellbeing"] == 4
    assert body["difficulty"] == 7
    assert body["skipped"] is False

    fetched = client.get(f"/api/trainings/{training['id']}/feedback", headers=player_headers)
    assert fetched.status_code == 200
    assert fetched.json()["comment"] == "Тяжеловато, но норм"

    outsider_token = login_as(830002, first_name="Outsider")
    forbidden = client.post(
        f"/api/trainings/{training['id']}/feedback", headers={"Authorization": f"Bearer {outsider_token}"}, json={}
    )
    assert forbidden.status_code == 403


def test_training_feedback_skip_marks_prompt_handled(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(830003, first_name="Skipper")
    _add_player_to_team(client, coach_token, team["id"], player_token)
    player_headers = {"Authorization": f"Bearer {player_token}"}

    training = client.post(f"/api/teams/{team['id']}/trainings", headers=coach_headers, json=_TRAINING_PAYLOAD).json()[0]
    _mark_completed(client, coach_headers, training)

    skip = client.post(f"/api/trainings/{training['id']}/feedback/skip", headers=player_headers)
    assert skip.status_code == 200
    assert skip.json()["skipped"] is True

    fetched = client.get(f"/api/trainings/{training['id']}/feedback", headers=player_headers)
    assert fetched.status_code == 200
    assert fetched.json()["skipped"] is True
