from __future__ import annotations

from datetime import date

from tests.test_teams_api import _add_player_to_team, _create_coach_profile, _create_team, _member_user_id

_TODAY = date.today().isoformat()


def _metric_payload(**overrides):
    payload = {
        "name": "Точность бросков",
        "unit": "%",
        "value": 72.5,
        "recorded_date": _TODAY,
        "higher_is_better": True,
        "source": "Тренировка",
        "comment": None,
    }
    payload.update(overrides)
    return payload


def test_player_can_create_and_list_own_metric(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    me = client.get("/api/auth/me", headers=headers).json()

    create_resp = client.post(f"/api/players/{me['id']}/metrics", headers=headers, json=_metric_payload())
    assert create_resp.status_code == 200
    assert create_resp.json()["name"] == "Точность бросков"

    list_resp = client.get(f"/api/players/{me['id']}/metrics", headers=headers)
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1


def test_coach_can_add_metric_for_shared_player(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(870001, first_name="Player")
    _add_player_to_team(client, coach_token, team["id"], player_token)
    player_id = _member_user_id(client, team["id"], coach_token, 870001)

    response = client.post(f"/api/players/{player_id}/metrics", headers=coach_headers, json=_metric_payload(name="Высота прыжка", unit="см", value=45))
    assert response.status_code == 200


def test_unrelated_user_cannot_view_or_add_metrics(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(870002, first_name="Player")
    _add_player_to_team(client, coach_token, team["id"], player_token)
    player_id = _member_user_id(client, team["id"], coach_token, 870002)

    outsider_token = login_as(870003, first_name="Outsider")
    outsider_headers = {"Authorization": f"Bearer {outsider_token}"}

    forbidden_create = client.post(f"/api/players/{player_id}/metrics", headers=outsider_headers, json=_metric_payload())
    assert forbidden_create.status_code == 403

    forbidden_list = client.get(f"/api/players/{player_id}/metrics", headers=outsider_headers)
    assert forbidden_list.status_code == 403


def test_update_and_delete_metric_only_by_recorder(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(870004, first_name="Player")
    player_headers = {"Authorization": f"Bearer {player_token}"}
    _add_player_to_team(client, coach_token, team["id"], player_token)
    player_id = _member_user_id(client, team["id"], coach_token, 870004)

    metric = client.post(f"/api/players/{player_id}/metrics", headers=coach_headers, json=_metric_payload()).json()

    forbidden_update = client.put(
        f"/api/metrics/{metric['id']}", headers=player_headers, json=_metric_payload(value=80)
    )
    assert forbidden_update.status_code == 404

    ok_update = client.put(f"/api/metrics/{metric['id']}", headers=coach_headers, json=_metric_payload(value=80))
    assert ok_update.status_code == 200
    assert ok_update.json()["value"] == 80

    forbidden_delete = client.delete(f"/api/metrics/{metric['id']}", headers=player_headers)
    assert forbidden_delete.status_code == 404

    ok_delete = client.delete(f"/api/metrics/{metric['id']}", headers=coach_headers)
    assert ok_delete.status_code == 204
