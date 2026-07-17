from __future__ import annotations

import json
from datetime import date

from tests.test_teams_api import _add_player_to_team, _create_coach_profile, _create_team, _member_user_id

_TODAY = date.today().isoformat()

_PLAN_DRAFT_JSON = json.dumps(
    {
        "name": "Развитие выносливости",
        "warmup": "Бег трусцой 10 минут, суставная разминка",
        "main_part": "Интервальный бег 6x400м, работа с мячом",
        "game_part": "Двусторонняя игра 20 минут",
        "cooldown": "Растяжка 10 минут",
        "equipment": "Мячи, конусы",
        "comment": "Следить за темпом у младших игроков",
    },
    ensure_ascii=False,
)

_TASK_DRAFT_JSON = json.dumps(
    {
        "title": "100 передач у стены",
        "description": "Отработать точность коротких передач",
        "metric_name": "Точные передачи",
        "metric_unit": "раз",
        "metric_target": 80,
        "require_comment": True,
        "require_photo": False,
        "require_video": True,
        "require_sets_reps": False,
        "require_duration": False,
        "require_metric_value": True,
        "require_difficulty": False,
        "require_wellbeing": False,
        "target_type": "team",
        "target_position": None,
    },
    ensure_ascii=False,
)

_PERSONAL_TRAINING_JSON = json.dumps(
    {
        "exercises": [
            {"exercise": "Приседания", "reps": 15, "sets": 3, "duration_seconds": None},
            {"exercise": "Отжимания", "reps": 12, "sets": 3, "duration_seconds": None},
        ],
        "notes": "Пить воду между подходами",
        "duration_minutes": 40,
    },
    ensure_ascii=False,
)


def _create_player_profile(client, token, sport: str = "Футбол") -> None:
    resp = client.put(
        "/api/profile/player",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "full_name": "Игрок",
            "age": 17,
            "height_cm": 175,
            "weight_kg": 65.0,
            "sport": sport,
            "position": "нападающий",
            "level": "amateur",
            "goals": "стать быстрее",
            "load_restrictions": None,
        },
    )
    assert resp.status_code == 200, resp.text


def test_training_plan_draft_requires_coach_profile(logged_in_client) -> None:
    client, token = logged_in_client
    response = client.post(
        "/api/ai/training-plan-draft",
        headers={"Authorization": f"Bearer {token}"},
        json={"goals": "развитие выносливости", "sport": "Футбол"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "coach_profile_required"


def test_training_plan_draft_success_with_team_context(logged_in_client, queue_ai_response) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)
    queue_ai_response(_PLAN_DRAFT_JSON)

    response = client.post(
        "/api/ai/training-plan-draft",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"goals": "развитие выносливости", "team_id": team["id"]},
    )
    assert response.status_code == 200, response.text
    draft = response.json()
    assert draft["name"] == "Развитие выносливости"
    assert draft["sport"] == "Футбол"
    assert "Разминка" in draft["description"]
    assert "Основная часть" in draft["description"]
    assert draft["equipment"] == "Мячи, конусы"


def test_training_plan_draft_rejects_foreign_team(logged_in_client, login_as, queue_ai_response) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    other_coach_token = login_as(881001, first_name="Other")
    _create_coach_profile(client, other_coach_token, sport="Баскетбол")
    queue_ai_response(_PLAN_DRAFT_JSON)

    response = client.post(
        "/api/ai/training-plan-draft",
        headers={"Authorization": f"Bearer {other_coach_token}"},
        json={"goals": "цель", "team_id": team["id"]},
    )
    assert response.status_code == 403


def test_training_plan_draft_handles_malformed_ai_response(logged_in_client, queue_ai_response) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    queue_ai_response("извините, не могу помочь")

    response = client.post(
        "/api/ai/training-plan-draft",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"goals": "цель", "sport": "Футбол"},
    )
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "ai_unavailable"


def test_task_draft_requires_coach_staff(logged_in_client, login_as, queue_ai_response) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)
    player_token = login_as(881002, first_name="Player")
    _add_player_to_team(client, coach_token, team["id"], player_token)
    queue_ai_response(_TASK_DRAFT_JSON)

    response = client.post(
        f"/api/teams/{team['id']}/ai/task-draft",
        headers={"Authorization": f"Bearer {player_token}"},
        json={"goal": "улучшить передачи"},
    )
    assert response.status_code == 403


def test_task_draft_success(logged_in_client, queue_ai_response) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)
    queue_ai_response(_TASK_DRAFT_JSON)

    response = client.post(
        f"/api/teams/{team['id']}/ai/task-draft",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"goal": "улучшить точность передач"},
    )
    assert response.status_code == 200, response.text
    draft = response.json()
    assert draft["title"] == "100 передач у стены"
    assert draft["metric_name"] == "Точные передачи"
    assert draft["metric_target"] == 80
    assert draft["require_video"] is True
    assert draft["target_type"] == "team"


def test_report_analysis_and_attendance_analysis_and_team_summary(logged_in_client, login_as, queue_ai_response) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)
    coach_headers = {"Authorization": f"Bearer {coach_token}"}

    player_token = login_as(881003, first_name="Player3")
    _add_player_to_team(client, coach_token, team["id"], player_token)

    queue_ai_response("В отчётах пока не видно проблем.")
    r1 = client.post(f"/api/teams/{team['id']}/ai/report-analysis", headers=coach_headers)
    assert r1.status_code == 200
    assert r1.json()["text"] == "В отчётах пока не видно проблем."

    queue_ai_response("Посещаемость команды в норме.")
    r2 = client.post(f"/api/teams/{team['id']}/ai/attendance-analysis", headers=coach_headers)
    assert r2.status_code == 200
    assert r2.json()["text"] == "Посещаемость команды в норме."

    queue_ai_response("Команда развивается стабильно, признаков перегрузки не видно.")
    r3 = client.post(f"/api/teams/{team['id']}/ai/team-summary", headers=coach_headers)
    assert r3.status_code == 200
    assert "перегрузки" in r3.json()["text"]

    # Non-coach-staff cannot call any of these.
    player_headers = {"Authorization": f"Bearer {player_token}"}
    assert client.post(f"/api/teams/{team['id']}/ai/report-analysis", headers=player_headers).status_code == 403
    assert client.post(f"/api/teams/{team['id']}/ai/attendance-analysis", headers=player_headers).status_code == 403
    assert client.post(f"/api/teams/{team['id']}/ai/team-summary", headers=player_headers).status_code == 403


def test_personal_training_draft_requires_player_profile(logged_in_client) -> None:
    client, token = logged_in_client
    response = client.post(
        "/api/ai/personal-training-draft",
        headers={"Authorization": f"Bearer {token}"},
        json={},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "player_profile_required"


def test_personal_training_draft_success(logged_in_client, queue_ai_response) -> None:
    client, token = logged_in_client
    _create_player_profile(client, token)
    queue_ai_response(_PERSONAL_TRAINING_JSON)

    response = client.post(
        "/api/ai/personal-training-draft",
        headers={"Authorization": f"Bearer {token}"},
        json={"goals": "хочу поработать над скоростью"},
    )
    assert response.status_code == 200, response.text
    draft = response.json()
    assert draft["style"] == "reps"
    assert draft["duration_minutes"] == 40
    assert len(draft["exercises"]) == 2
    assert draft["exercises"][0]["exercise"] == "Приседания"
    assert draft["exercises"][0]["reps"] == 15
    assert draft["notes"] == "Пить воду между подходами"


def test_progress_analysis_requires_player_profile(logged_in_client) -> None:
    client, token = logged_in_client
    response = client.post(
        "/api/ai/progress-analysis",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "player_profile_required"


def test_progress_analysis_success(logged_in_client, queue_ai_response) -> None:
    client, token = logged_in_client
    _create_player_profile(client, token)
    queue_ai_response("Прогресс стабильный, стоит добавить работу над скоростью.")

    response = client.post(
        "/api/ai/progress-analysis",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200, response.text
    assert "скоростью" in response.json()["text"]


def test_training_evaluation_for_independent_training_with_report(logged_in_client, login_as, queue_ai_response) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)
    coach_headers = {"Authorization": f"Bearer {coach_token}"}

    player_token = login_as(881004, first_name="Player4")
    _create_player_profile(client, player_token)
    _add_player_to_team(client, coach_token, team["id"], player_token)
    player_id = _member_user_id(client, team["id"], coach_token, 881004)
    player_headers = {"Authorization": f"Bearer {player_token}"}

    training_payload = {
        "training_date": _TODAY, "start_time": "18:00:00", "duration_minutes": 60,
        "location": "Зал", "description": None, "plan_id": None, "reminder_minutes_before": None,
        "repeat_weekly_until": None, "is_independent": True, "responsible_user_id": player_id,
    }
    training = client.post(f"/api/teams/{team['id']}/trainings", headers=coach_headers, json=training_payload).json()[0]
    client.post(f"/api/trainings/{training['id']}/report", headers=player_headers, json={"text_report": "Провели тренировку, все справились"})
    mark_completed = client.put(
        f"/api/trainings/{training['id']}",
        headers=coach_headers,
        json={
            "training_date": training["training_date"], "start_time": training["start_time"],
            "duration_minutes": training["duration_minutes"], "location": training["location"],
            "description": training["description"], "plan_id": training["plan_id"],
            "reminder_minutes_before": training["reminder_minutes_before"], "status": "completed",
            "is_independent": True, "responsible_user_id": training["responsible_user_id"],
        },
    )
    assert mark_completed.status_code == 200, mark_completed.text

    queue_ai_response("Тренировка прошла хорошо, отчёт содержательный.")
    response = client.post(
        "/api/ai/training-evaluation",
        headers=player_headers,
        json={"training_id": training["id"]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["text"] == "Тренировка прошла хорошо, отчёт содержательный."


def test_training_evaluation_forbidden_for_non_member(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)
    coach_headers = {"Authorization": f"Bearer {coach_token}"}

    training_payload = {
        "training_date": _TODAY, "start_time": "18:00:00", "duration_minutes": 60,
        "location": "Зал", "description": None, "plan_id": None, "reminder_minutes_before": None,
        "repeat_weekly_until": None, "is_independent": False, "responsible_user_id": None,
    }
    training = client.post(f"/api/teams/{team['id']}/trainings", headers=coach_headers, json=training_payload).json()[0]

    outsider_token = login_as(881005, first_name="Outsider")
    _create_player_profile(client, outsider_token)

    response = client.post(
        "/api/ai/training-evaluation",
        headers={"Authorization": f"Bearer {outsider_token}"},
        json={"training_id": training["id"]},
    )
    assert response.status_code == 403


def test_training_evaluation_rejected_before_completed(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)
    coach_headers = {"Authorization": f"Bearer {coach_token}"}

    player_token = login_as(881006, first_name="Player6")
    _create_player_profile(client, player_token)
    _add_player_to_team(client, coach_token, team["id"], player_token)
    player_headers = {"Authorization": f"Bearer {player_token}"}

    training_payload = {
        "training_date": _TODAY, "start_time": "18:00:00", "duration_minutes": 60,
        "location": "Зал", "description": None, "plan_id": None, "reminder_minutes_before": None,
        "repeat_weekly_until": None, "is_independent": False, "responsible_user_id": None,
    }
    training = client.post(f"/api/teams/{team['id']}/trainings", headers=coach_headers, json=training_payload).json()[0]

    response = client.post(
        "/api/ai/training-evaluation", headers=player_headers, json={"training_id": training["id"]}
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "training_not_completed"
