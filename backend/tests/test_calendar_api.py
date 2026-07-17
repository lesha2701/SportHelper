from __future__ import annotations

from datetime import date, timedelta

from tests.test_teams_api import _add_player_to_team, _create_coach_profile, _create_team, _member_user_id

_TOMORROW = (date.today() + timedelta(days=1)).isoformat()
_IN_WEEK = (date.today() + timedelta(days=7)).isoformat()
_TODAY = date.today().isoformat()
_IN_MONTH = (date.today() + timedelta(days=30)).isoformat()


def _range(client, token, days_ahead: int = 14):
    date_from = date.today().isoformat()
    date_to = (date.today() + timedelta(days=days_ahead)).isoformat()
    return client.get(
        f"/api/calendar?date_from={date_from}&date_to={date_to}", headers={"Authorization": f"Bearer {token}"}
    )


def test_calendar_includes_personal_training(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    client.post(
        "/api/trainings/personal",
        headers=headers,
        json={
            "training_date": _TOMORROW, "start_time": "09:00:00", "duration_minutes": 45,
            "location": None, "description": None, "plan_id": None, "reminder_minutes_before": None,
            "repeat_weekly_until": None, "is_independent": False, "responsible_user_id": None,
        },
    )
    response = _range(client, token)
    assert response.status_code == 200
    types = [e["type"] for e in response.json()]
    assert "training" in types


def test_calendar_includes_team_training_for_member(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(860001, first_name="Player")
    _add_player_to_team(client, coach_token, team["id"], player_token)

    client.post(
        f"/api/teams/{team['id']}/trainings",
        headers=coach_headers,
        json={
            "training_date": _TOMORROW, "start_time": "18:00:00", "duration_minutes": 90,
            "location": "Зал", "description": None, "plan_id": None, "reminder_minutes_before": None,
            "repeat_weekly_until": None, "is_independent": False, "responsible_user_id": None,
        },
    )

    response = _range(client, player_token)
    assert response.status_code == 200
    events = response.json()
    assert any(e["type"] == "training" and e["team_id"] == team["id"] for e in events)


def test_calendar_includes_match_for_member(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(860002, first_name="Player")
    _add_player_to_team(client, coach_token, team["id"], player_token)

    client.post(
        f"/api/teams/{team['id']}/matches",
        headers=coach_headers,
        json={
            "opponent_name": "Соперники", "match_date": _TOMORROW, "start_time": "19:00:00",
            "location": None, "is_home": True, "tournament": None,
        },
    )

    response = _range(client, player_token)
    events = response.json()
    assert any(e["type"] == "match" and e["team_id"] == team["id"] for e in events)


def test_calendar_includes_task_deadline_for_assignee(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(860003, first_name="Player")
    _add_player_to_team(client, coach_token, team["id"], player_token)

    deadline_iso = f"{_IN_WEEK}T18:00:00+00:00"
    task_payload = {
        "title": "Растяжка", "description": None, "plan_id": None, "exercise_ids": [],
        "deadline": deadline_iso, "metric_name": None, "metric_unit": None, "metric_target": None,
        "require_comment": False, "require_photo": False, "require_video": False,
        "require_sets_reps": False, "require_duration": False, "require_metric_value": False,
        "require_difficulty": False, "require_wellbeing": False,
        "target_type": "team", "player_ids": [], "position": None, "training_id": None,
    }
    client.post(f"/api/teams/{team['id']}/tasks", headers=coach_headers, json=task_payload)

    response = client.get(
        f"/api/calendar?date_from={_TODAY}&date_to={_IN_MONTH}", headers={"Authorization": f"Bearer {player_token}"}
    )
    assert response.status_code == 200
    events = response.json()
    assert any(e["type"] == "task_deadline" for e in events)

    coach_response = client.get(
        f"/api/calendar?date_from={_TODAY}&date_to={_IN_MONTH}", headers=coach_headers
    )
    coach_events = coach_response.json()
    assert not any(e["type"] == "task_deadline" for e in coach_events)


def test_calendar_excludes_outsider_team_events(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)
    client.post(
        f"/api/teams/{team['id']}/matches",
        headers=coach_headers,
        json={
            "opponent_name": "Соперники", "match_date": _TOMORROW, "start_time": "19:00:00",
            "location": None, "is_home": True, "tournament": None,
        },
    )

    outsider_token = login_as(860004, first_name="Outsider")
    response = _range(client, outsider_token)
    assert response.status_code == 200
    assert response.json() == []


def test_calendar_invalid_range_rejected(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}

    backwards = client.get(
        f"/api/calendar?date_from={_IN_WEEK}&date_to={_TODAY}", headers=headers
    )
    assert backwards.status_code == 400
    assert backwards.json()["error"]["code"] == "invalid_range"

    too_large_to = (date.today() + timedelta(days=200)).isoformat()
    too_large = client.get(
        f"/api/calendar?date_from={_TODAY}&date_to={too_large_to}", headers=headers
    )
    assert too_large.status_code == 400
    assert too_large.json()["error"]["code"] == "range_too_large"
