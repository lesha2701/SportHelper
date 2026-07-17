from __future__ import annotations

from tests.test_exercises_api import _EXERCISE_PAYLOAD
from tests.test_teams_api import _create_coach_profile

_BASE_TEMPLATE_PAYLOAD = {
    "title": "Растяжка перед сном",
    "description": "20 минут растяжки",
    "plan_id": None,
    "exercise_ids": [],
    "metric_name": None,
    "metric_unit": None,
    "metric_target": None,
    "require_comment": True,
    "require_photo": False,
    "require_video": False,
    "require_sets_reps": False,
    "require_duration": False,
    "require_metric_value": False,
    "require_difficulty": False,
    "require_wellbeing": False,
}


def test_create_template_requires_coach_profile(logged_in_client) -> None:
    client, token = logged_in_client
    response = client.post("/api/task-templates", headers={"Authorization": f"Bearer {token}"}, json=_BASE_TEMPLATE_PAYLOAD)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "coach_profile_required"


def test_create_and_get_template(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)

    create_resp = client.post("/api/task-templates", headers=headers, json=_BASE_TEMPLATE_PAYLOAD)
    assert create_resp.status_code == 200
    template = create_resp.json()
    assert template["title"] == "Растяжка перед сном"
    assert template["require_comment"] is True

    get_resp = client.get(f"/api/task-templates/{template['id']}", headers=headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == template["id"]


def test_template_with_exercises(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)

    exercise = client.post("/api/exercises", headers=headers, json=_EXERCISE_PAYLOAD).json()

    payload = {**_BASE_TEMPLATE_PAYLOAD, "exercise_ids": [exercise["id"]]}
    create_resp = client.post("/api/task-templates", headers=headers, json=payload)
    assert create_resp.status_code == 200
    template = create_resp.json()
    assert len(template["exercises"]) == 1
    assert template["exercises"][0]["exercise_id"] == exercise["id"]
    assert template["exercises"][0]["exercise_name"] == _EXERCISE_PAYLOAD["name"]


def test_list_mine_omits_exercises(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)

    exercise = client.post("/api/exercises", headers=headers, json=_EXERCISE_PAYLOAD).json()
    payload = {**_BASE_TEMPLATE_PAYLOAD, "exercise_ids": [exercise["id"]]}
    client.post("/api/task-templates", headers=headers, json=payload)

    list_resp = client.get("/api/task-templates/mine", headers=headers)
    assert list_resp.status_code == 200
    templates = list_resp.json()
    assert len(templates) == 1
    assert templates[0]["exercises"] == []


def test_update_template(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)

    template = client.post("/api/task-templates", headers=headers, json=_BASE_TEMPLATE_PAYLOAD).json()
    updated_payload = {**_BASE_TEMPLATE_PAYLOAD, "title": "Обновлённое название", "require_photo": True}
    update_resp = client.put(f"/api/task-templates/{template['id']}", headers=headers, json=updated_payload)
    assert update_resp.status_code == 200
    assert update_resp.json()["title"] == "Обновлённое название"
    assert update_resp.json()["require_photo"] is True


def test_other_coach_cannot_access_template(logged_in_client, login_as) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)
    template = client.post("/api/task-templates", headers=headers, json=_BASE_TEMPLATE_PAYLOAD).json()

    other_token = login_as(830001, first_name="Other")
    other_headers = {"Authorization": f"Bearer {other_token}"}
    _create_coach_profile(client, other_token)

    forbidden = client.get(f"/api/task-templates/{template['id']}", headers=other_headers)
    assert forbidden.status_code == 404


def test_delete_template(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)
    template = client.post("/api/task-templates", headers=headers, json=_BASE_TEMPLATE_PAYLOAD).json()

    delete_resp = client.delete(f"/api/task-templates/{template['id']}", headers=headers)
    assert delete_resp.status_code == 204

    get_resp = client.get(f"/api/task-templates/{template['id']}", headers=headers)
    assert get_resp.status_code == 404
