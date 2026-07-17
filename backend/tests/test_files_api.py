from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient

from tests.test_teams_api import _create_coach_profile, _create_team


def _png_bytes(size: int = 20) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"0" * size


def test_upload_logo_requires_coach_staff(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    outsider_token = login_as(700001, first_name="Outsider")
    response = client.post(
        f"/api/teams/{team['id']}/logo",
        headers={"Authorization": f"Bearer {outsider_token}"},
        files={"file": ("logo.png", io.BytesIO(_png_bytes()), "image/png")},
    )
    assert response.status_code == 403


def test_upload_logo_rejects_non_image(logged_in_client) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    response = client.post(
        f"/api/teams/{team['id']}/logo",
        headers={"Authorization": f"Bearer {coach_token}"},
        files={"file": ("logo.txt", io.BytesIO(b"not an image"), "text/plain")},
    )
    assert response.status_code == 415


def test_upload_logo_rejects_oversized_file(logged_in_client, monkeypatch: pytest.MonkeyPatch) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    monkeypatch.setenv("MAX_IMAGE_SIZE_MB", "0")  # 0 MB -> anything is too large
    from app.config import get_settings

    get_settings.cache_clear()
    try:
        response = client.post(
            f"/api/teams/{team['id']}/logo",
            headers={"Authorization": f"Bearer {coach_token}"},
            files={"file": ("logo.png", io.BytesIO(_png_bytes(100)), "image/png")},
        )
        assert response.status_code == 413
    finally:
        get_settings.cache_clear()


def test_upload_and_download_logo_roundtrip(logged_in_client) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)
    content = _png_bytes(42)

    upload_resp = client.post(
        f"/api/teams/{team['id']}/logo",
        headers={"Authorization": f"Bearer {coach_token}"},
        files={"file": ("logo.png", io.BytesIO(content), "image/png")},
    )
    assert upload_resp.status_code == 200
    file_id = upload_resp.json()["logo_file_id"]
    assert file_id is not None

    download_resp = client.get(f"/api/files/{file_id}", headers={"Authorization": f"Bearer {coach_token}"})
    assert download_resp.status_code == 200
    assert download_resp.content == content
    assert download_resp.headers["content-type"] == "image/png"


def test_non_member_cannot_download_team_file(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    upload_resp = client.post(
        f"/api/teams/{team['id']}/logo",
        headers={"Authorization": f"Bearer {coach_token}"},
        files={"file": ("logo.png", io.BytesIO(_png_bytes()), "image/png")},
    )
    file_id = upload_resp.json()["logo_file_id"]

    outsider_token = login_as(700002, first_name="Outsider2")
    response = client.get(f"/api/files/{file_id}", headers={"Authorization": f"Bearer {outsider_token}"})
    assert response.status_code == 403


def test_replacing_logo_soft_deletes_previous_file(logged_in_client) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    first = client.post(
        f"/api/teams/{team['id']}/logo",
        headers={"Authorization": f"Bearer {coach_token}"},
        files={"file": ("logo1.png", io.BytesIO(_png_bytes(10)), "image/png")},
    ).json()
    first_file_id = first["logo_file_id"]

    second = client.post(
        f"/api/teams/{team['id']}/logo",
        headers={"Authorization": f"Bearer {coach_token}"},
        files={"file": ("logo2.png", io.BytesIO(_png_bytes(20)), "image/png")},
    ).json()
    assert second["logo_file_id"] != first_file_id

    old_file_resp = client.get(f"/api/files/{first_file_id}", headers={"Authorization": f"Bearer {coach_token}"})
    assert old_file_resp.status_code == 404


_EXERCISE_PAYLOAD = {
    "sport": "Баскетбол",
    "name": "Проверка доступа",
    "description": None,
    "goal": None,
    "sets": None,
    "reps": None,
    "duration_seconds": None,
    "rest_seconds": None,
    "equipment": None,
    "difficulty": None,
    "technique": None,
    "common_mistakes": None,
    "warnings": None,
    "coach_comment": None,
}


def test_team_member_can_view_shared_exercise_photo(logged_in_client, login_as) -> None:
    """Regression test: exercise photos/videos are stored as PRIVATE files
    (an exercise can be shared with several teams, so there is no single
    team_id to key a TEAM-level file on) — access must fall back to checking
    the exercise's current team shares, not just ownership."""
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    exercise = client.post("/api/exercises", headers=coach_headers, json=_EXERCISE_PAYLOAD).json()
    upload_resp = client.post(
        f"/api/exercises/{exercise['id']}/photo",
        headers=coach_headers,
        files={"file": ("photo.png", io.BytesIO(_png_bytes()), "image/png")},
    )
    assert upload_resp.status_code == 200
    photo_file_id = upload_resp.json()["photo_file_id"]

    outsider_token = login_as(700040, first_name="Outsider")
    forbidden = client.get(f"/api/files/{photo_file_id}", headers={"Authorization": f"Bearer {outsider_token}"})
    assert forbidden.status_code == 403

    member_token = login_as(700041, first_name="Teammate")
    invite = client.post(f"/api/teams/{team['id']}/invites", headers=coach_headers, json={"kind": "join"}).json()
    client.post(f"/api/invites/{invite['token']}/apply", headers={"Authorization": f"Bearer {member_token}"})
    applications = client.get(f"/api/teams/{team['id']}/applications", headers=coach_headers).json()
    client.post(f"/api/teams/{team['id']}/applications/{applications[0]['id']}/accept", headers=coach_headers)

    still_forbidden = client.get(f"/api/files/{photo_file_id}", headers={"Authorization": f"Bearer {member_token}"})
    assert still_forbidden.status_code == 403  # not shared with the team yet

    client.post(f"/api/exercises/{exercise['id']}/share", headers=coach_headers, json={"team_id": team["id"]})

    allowed = client.get(f"/api/files/{photo_file_id}", headers={"Authorization": f"Bearer {member_token}"})
    assert allowed.status_code == 200
    assert allowed.content == _png_bytes()
