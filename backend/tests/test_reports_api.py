from __future__ import annotations

import io
from datetime import date, timedelta

from tests.test_teams_api import _add_player_to_team, _create_coach_profile, _create_team, _member_user_id

_TOMORROW = (date.today() + timedelta(days=1)).isoformat()

_BASE_TRAINING_PAYLOAD = {
    "training_date": _TOMORROW,
    "start_time": "18:00:00",
    "duration_minutes": 90,
    "location": "Зал №1",
    "description": None,
    "plan_id": None,
    "reminder_minutes_before": None,
    "repeat_weekly_until": None,
}


def _make_captain(client, coach_token, team_id, telegram_id) -> str:
    user_id = _member_user_id(client, team_id, coach_token, telegram_id)
    resp = client.patch(
        f"/api/teams/{team_id}/members/{user_id}",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"role": "captain"},
    )
    assert resp.status_code == 200
    return user_id


def _png_bytes(size: int = 20) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"0" * size


def test_independent_training_requires_responsible_without_captain(logged_in_client) -> None:
    client, coach_token = logged_in_client
    headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    payload = {**_BASE_TRAINING_PAYLOAD, "is_independent": True}
    response = client.post(f"/api/teams/{team['id']}/trainings", headers=headers, json=payload)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "responsible_player_required"


def test_independent_training_defaults_to_captain(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(810001, first_name="Captain")
    _add_player_to_team(client, coach_token, team["id"], player_token)
    captain_id = _make_captain(client, coach_token, team["id"], 810001)

    payload = {**_BASE_TRAINING_PAYLOAD, "is_independent": True}
    response = client.post(f"/api/teams/{team['id']}/trainings", headers=headers, json=payload)
    assert response.status_code == 200
    training = response.json()[0]
    assert training["type"] == "independent"
    assert training["responsible_user_id"] == captain_id


def test_independent_training_explicit_responsible_player(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(810002, first_name="Chosen")
    _add_player_to_team(client, coach_token, team["id"], player_token)
    player_id = _member_user_id(client, team["id"], coach_token, 810002)

    payload = {**_BASE_TRAINING_PAYLOAD, "is_independent": True, "responsible_user_id": player_id}
    response = client.post(f"/api/teams/{team['id']}/trainings", headers=headers, json=payload)
    assert response.status_code == 200
    assert response.json()[0]["responsible_user_id"] == player_id


def _setup_independent_training(client, coach_token, team_id, responsible_user_id) -> dict:
    payload = {**_BASE_TRAINING_PAYLOAD, "is_independent": True, "responsible_user_id": responsible_user_id}
    resp = client.post(
        f"/api/teams/{team_id}/trainings", headers={"Authorization": f"Bearer {coach_token}"}, json=payload
    )
    assert resp.status_code == 200
    return resp.json()[0]


def test_responsible_player_can_mark_attendance_but_others_cannot(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    responsible_token = login_as(810003, first_name="Responsible")
    _add_player_to_team(client, coach_token, team["id"], responsible_token)
    responsible_id = _member_user_id(client, team["id"], coach_token, 810003)

    other_token = login_as(810004, first_name="Other")
    _add_player_to_team(client, coach_token, team["id"], other_token)
    other_id = _member_user_id(client, team["id"], coach_token, 810004)

    training = _setup_independent_training(client, coach_token, team["id"], responsible_id)

    forbidden = client.patch(
        f"/api/trainings/{training['id']}/attendance/{other_id}",
        headers={"Authorization": f"Bearer {other_token}"},
        json={"status": "absent"},
    )
    assert forbidden.status_code == 403

    ok = client.patch(
        f"/api/trainings/{training['id']}/attendance/{other_id}",
        headers={"Authorization": f"Bearer {responsible_token}"},
        json={"status": "absent"},
    )
    assert ok.status_code == 200
    assert ok.json()["status"] == "absent"


def test_only_responsible_player_can_submit_report(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    responsible_token = login_as(810005, first_name="Responsible")
    _add_player_to_team(client, coach_token, team["id"], responsible_token)
    responsible_id = _member_user_id(client, team["id"], coach_token, 810005)

    other_token = login_as(810006, first_name="Other")
    _add_player_to_team(client, coach_token, team["id"], other_token)

    training = _setup_independent_training(client, coach_token, team["id"], responsible_id)

    forbidden = client.post(
        f"/api/trainings/{training['id']}/report",
        headers={"Authorization": f"Bearer {other_token}"},
        json={"text_report": "Всё прошло хорошо"},
    )
    assert forbidden.status_code == 403

    ok = client.post(
        f"/api/trainings/{training['id']}/report",
        headers={"Authorization": f"Bearer {responsible_token}"},
        json={"text_report": "Всё прошло хорошо"},
    )
    assert ok.status_code == 200
    assert ok.json()["status"] == "pending"


def test_coach_review_and_resubmission_resets_to_pending(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    responsible_token = login_as(810007, first_name="Responsible")
    responsible_headers = {"Authorization": f"Bearer {responsible_token}"}
    _add_player_to_team(client, coach_token, team["id"], responsible_token)
    responsible_id = _member_user_id(client, team["id"], coach_token, 810007)

    training = _setup_independent_training(client, coach_token, team["id"], responsible_id)
    client.post(f"/api/trainings/{training['id']}/report", headers=responsible_headers, json={"text_report": "Отчёт"})

    review_resp = client.post(
        f"/api/trainings/{training['id']}/report/review",
        headers=coach_headers,
        json={"decision": "needs_revision", "coach_comment": "Уточните детали"},
    )
    assert review_resp.status_code == 200
    assert review_resp.json()["status"] == "needs_revision"
    assert review_resp.json()["coach_comment"] == "Уточните детали"

    resubmit_resp = client.post(
        f"/api/trainings/{training['id']}/report", headers=responsible_headers, json={"text_report": "Уточнённый отчёт"}
    )
    assert resubmit_resp.status_code == 200
    assert resubmit_resp.json()["status"] == "pending"
    assert resubmit_resp.json()["coach_comment"] is None

    accept_resp = client.post(
        f"/api/trainings/{training['id']}/report/review", headers=coach_headers, json={"decision": "accepted", "coach_comment": None}
    )
    assert accept_resp.status_code == 200
    assert accept_resp.json()["status"] == "accepted"


def test_non_coach_cannot_review_report(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    responsible_token = login_as(810008, first_name="Responsible")
    _add_player_to_team(client, coach_token, team["id"], responsible_token)
    responsible_id = _member_user_id(client, team["id"], coach_token, 810008)

    training = _setup_independent_training(client, coach_token, team["id"], responsible_id)
    client.post(
        f"/api/trainings/{training['id']}/report",
        headers={"Authorization": f"Bearer {responsible_token}"},
        json={"text_report": "Отчёт"},
    )

    response = client.post(
        f"/api/trainings/{training['id']}/report/review",
        headers={"Authorization": f"Bearer {responsible_token}"},
        json={"decision": "accepted", "coach_comment": None},
    )
    assert response.status_code == 403


def test_any_team_member_can_view_report(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    responsible_token = login_as(810009, first_name="Responsible")
    _add_player_to_team(client, coach_token, team["id"], responsible_token)
    responsible_id = _member_user_id(client, team["id"], coach_token, 810009)

    viewer_token = login_as(810010, first_name="Viewer")
    _add_player_to_team(client, coach_token, team["id"], viewer_token)

    training = _setup_independent_training(client, coach_token, team["id"], responsible_id)
    client.post(
        f"/api/trainings/{training['id']}/report",
        headers={"Authorization": f"Bearer {responsible_token}"},
        json={"text_report": "Отчёт"},
    )

    response = client.get(
        f"/api/trainings/{training['id']}/report", headers={"Authorization": f"Bearer {viewer_token}"}
    )
    assert response.status_code == 200
    assert response.json()["text_report"] == "Отчёт"


def test_report_media_requires_text_report_first(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    responsible_token = login_as(810011, first_name="Responsible")
    _add_player_to_team(client, coach_token, team["id"], responsible_token)
    responsible_id = _member_user_id(client, team["id"], coach_token, 810011)

    training = _setup_independent_training(client, coach_token, team["id"], responsible_id)

    response = client.post(
        f"/api/trainings/{training['id']}/report/photo",
        headers={"Authorization": f"Bearer {responsible_token}"},
        files={"file": ("photo.png", io.BytesIO(_png_bytes()), "image/png")},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "report_required"


def test_report_photo_upload_and_download(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    responsible_token = login_as(810012, first_name="Responsible")
    responsible_headers = {"Authorization": f"Bearer {responsible_token}"}
    _add_player_to_team(client, coach_token, team["id"], responsible_token)
    responsible_id = _member_user_id(client, team["id"], coach_token, 810012)

    training = _setup_independent_training(client, coach_token, team["id"], responsible_id)
    client.post(f"/api/trainings/{training['id']}/report", headers=responsible_headers, json={"text_report": "Отчёт"})

    content = _png_bytes(42)
    upload_resp = client.post(
        f"/api/trainings/{training['id']}/report/photo",
        headers=responsible_headers,
        files={"file": ("photo.png", io.BytesIO(content), "image/png")},
    )
    assert upload_resp.status_code == 200
    photo_id = upload_resp.json()["photo_file_id"]
    assert photo_id is not None

    download_resp = client.get(f"/api/files/{photo_id}", headers=coach_headers)
    assert download_resp.status_code == 200
    assert download_resp.content == content


def test_only_responsible_player_can_upload_report_media(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    responsible_token = login_as(810013, first_name="Responsible")
    _add_player_to_team(client, coach_token, team["id"], responsible_token)
    responsible_id = _member_user_id(client, team["id"], coach_token, 810013)

    training = _setup_independent_training(client, coach_token, team["id"], responsible_id)
    client.post(
        f"/api/trainings/{training['id']}/report",
        headers={"Authorization": f"Bearer {responsible_token}"},
        json={"text_report": "Отчёт"},
    )

    response = client.post(
        f"/api/trainings/{training['id']}/report/photo",
        headers={"Authorization": f"Bearer {coach_token}"},
        files={"file": ("photo.png", io.BytesIO(_png_bytes()), "image/png")},
    )
    assert response.status_code == 403
