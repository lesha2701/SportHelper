from __future__ import annotations

from datetime import date

from tests.test_teams_api import _add_player_to_team, _create_coach_profile, _create_team, _member_user_id

_TODAY = date.today().isoformat()

_TRAINING_PAYLOAD = {
    "training_date": _TODAY, "start_time": "18:00:00", "duration_minutes": 90,
    "location": "Зал", "description": None, "plan_id": None, "reminder_minutes_before": None,
    "repeat_weekly_until": None, "is_independent": False, "responsible_user_id": None,
}

_MATCH_PAYLOAD = {
    "opponent_name": "Соперник", "match_date": _TODAY, "start_time": "20:00:00",
    "location": None, "is_home": True, "tournament": None,
}


def _setup_team_with_two_players(client, coach_token, login_as):
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)
    coach_headers = {"Authorization": f"Bearer {coach_token}"}

    good_token = login_as(880001, first_name="Attends")
    _add_player_to_team(client, coach_token, team["id"], good_token)
    good_id = _member_user_id(client, team["id"], coach_token, 880001)

    absent_token = login_as(880002, first_name="Misses")
    _add_player_to_team(client, coach_token, team["id"], absent_token)
    absent_id = _member_user_id(client, team["id"], coach_token, 880002)

    training = client.post(f"/api/teams/{team['id']}/trainings", headers=coach_headers, json=_TRAINING_PAYLOAD).json()[0]
    client.patch(f"/api/trainings/{training['id']}/attendance/{absent_id}", headers=coach_headers, json={"status": "absent"})

    return team, coach_headers, good_token, good_id, absent_id, training


def test_only_coach_staff_can_view_team_stats(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    team, coach_headers, good_token, good_id, absent_id, training = _setup_team_with_two_players(client, coach_token, login_as)

    forbidden = client.get(f"/api/teams/{team['id']}/stats", headers={"Authorization": f"Bearer {good_token}"})
    assert forbidden.status_code == 403

    ok = client.get(f"/api/teams/{team['id']}/stats", headers=coach_headers)
    assert ok.status_code == 200


def test_team_stats_attendance_and_activity_lists(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    team, coach_headers, good_token, good_id, absent_id, training = _setup_team_with_two_players(client, coach_token, login_as)

    response = client.get(f"/api/teams/{team['id']}/stats", headers=coach_headers)
    assert response.status_code == 200
    stats = response.json()

    assert stats["members_count"] == 3  # coach + 2 players
    assert stats["trainings_completed"] >= 1
    assert stats["attendance_rate"] is not None

    absent_entry = next(p for p in stats["frequent_absence_players"] if p["user_id"] == absent_id)
    assert absent_entry["absent_count"] == 1

    low_activity_ids = {p["user_id"] for p in stats["low_activity_players"]}
    assert absent_id in low_activity_ids
    assert good_id not in low_activity_ids


def test_team_stats_includes_tasks_and_matches(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    team, coach_headers, good_token, good_id, absent_id, training = _setup_team_with_two_players(client, coach_token, login_as)
    good_headers = {"Authorization": f"Bearer {good_token}"}

    task_payload = {
        "title": "Растяжка", "description": None, "plan_id": None, "exercise_ids": [],
        "deadline": None, "metric_name": None, "metric_unit": None, "metric_target": None,
        "require_comment": False, "require_photo": False, "require_video": False,
        "require_sets_reps": False, "require_duration": False, "require_metric_value": False,
        "require_difficulty": True, "require_wellbeing": True,
        "target_type": "players", "player_ids": [good_id], "position": None, "training_id": None,
    }
    task = client.post(f"/api/teams/{team['id']}/tasks", headers=coach_headers, json=task_payload).json()
    client.post(f"/api/tasks/{task['id']}/submit", headers=good_headers, json={"difficulty": 7, "wellbeing": 4})
    client.post(f"/api/tasks/{task['id']}/review/{good_id}", headers=coach_headers, json={"decision": "accepted", "coach_comment": "Отлично сделано"})

    client.post(f"/api/teams/{team['id']}/matches", headers=coach_headers, json=_MATCH_PAYLOAD)
    match = client.get(f"/api/teams/{team['id']}/matches", headers=coach_headers).json()[0]
    client.post(f"/api/matches/{match['id']}/result", headers=coach_headers, json={"our_score": 3, "opponent_score": 1, "comment": "Победа"})

    response = client.get(f"/api/teams/{team['id']}/stats", headers=coach_headers)
    stats = response.json()
    assert stats["tasks_completed"] == 1
    assert stats["avg_difficulty"] == 7
    assert stats["avg_wellbeing"] == 4
    assert stats["matches_played"] == 1
    assert stats["matches_won"] == 1


def test_player_stats_self_access(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    team, coach_headers, good_token, good_id, absent_id, training = _setup_team_with_two_players(client, coach_token, login_as)
    good_headers = {"Authorization": f"Bearer {good_token}"}

    client.post(f"/api/teams/{team['id']}/matches", headers=coach_headers, json=_MATCH_PAYLOAD)
    match = client.get(f"/api/teams/{team['id']}/matches", headers=coach_headers).json()[0]
    client.post(f"/api/matches/{match['id']}/result", headers=coach_headers, json={"our_score": 2, "opponent_score": 2, "comment": None})

    client.post(
        f"/api/players/{good_id}/metrics", headers=good_headers,
        json={"name": "Точность", "unit": "%", "value": 70, "recorded_date": _TODAY, "higher_is_better": True, "source": None, "comment": None},
    )
    client.post(
        f"/api/players/{good_id}/metrics", headers=good_headers,
        json={"name": "Точность", "unit": "%", "value": 85, "recorded_date": _TODAY, "higher_is_better": True, "source": None, "comment": None},
    )

    response = client.get(f"/api/players/{good_id}/stats", headers=good_headers)
    assert response.status_code == 200
    stats = response.json()
    assert stats["trainings_attended"] == 1
    assert stats["attendance_rate"] == 1.0
    assert stats["activity_streak"] == 1
    assert len(stats["matches_history"]) == 1
    assert len(stats["metrics"]) == 2
    assert len(stats["personal_records"]) == 1
    assert stats["personal_records"][0]["value"] == 85


def test_player_stats_visible_to_shared_coach_not_outsider(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    team, coach_headers, good_token, good_id, absent_id, training = _setup_team_with_two_players(client, coach_token, login_as)

    ok = client.get(f"/api/players/{good_id}/stats", headers=coach_headers)
    assert ok.status_code == 200

    outsider_token = login_as(880003, first_name="Outsider")
    forbidden = client.get(f"/api/players/{good_id}/stats", headers={"Authorization": f"Bearer {outsider_token}"})
    assert forbidden.status_code == 403


def test_player_stats_shows_coach_comments(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    team, coach_headers, good_token, good_id, absent_id, training = _setup_team_with_two_players(client, coach_token, login_as)
    good_headers = {"Authorization": f"Bearer {good_token}"}

    task_payload = {
        "title": "Отжимания", "description": None, "plan_id": None, "exercise_ids": [],
        "deadline": None, "metric_name": None, "metric_unit": None, "metric_target": None,
        "require_comment": False, "require_photo": False, "require_video": False,
        "require_sets_reps": False, "require_duration": False, "require_metric_value": False,
        "require_difficulty": False, "require_wellbeing": False,
        "target_type": "players", "player_ids": [good_id], "position": None, "training_id": None,
    }
    task = client.post(f"/api/teams/{team['id']}/tasks", headers=coach_headers, json=task_payload).json()
    client.post(f"/api/tasks/{task['id']}/submit", headers=good_headers, json={})
    client.post(
        f"/api/tasks/{task['id']}/review/{good_id}", headers=coach_headers,
        json={"decision": "needs_revision", "coach_comment": "Добавь видео в следующий раз"},
    )

    response = client.get(f"/api/players/{good_id}/stats", headers=good_headers)
    comments = response.json()["coach_comments"]
    assert any("следующий раз" in c["comment"] for c in comments)
