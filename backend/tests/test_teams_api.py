from __future__ import annotations

from fastapi.testclient import TestClient


def _create_coach_profile(client: TestClient, token: str, sport: str = "Футбол") -> None:
    resp = client.put(
        "/api/profile/coach",
        headers={"Authorization": f"Bearer {token}"},
        json={"full_name": "Coach", "sport": sport, "experience_years": 5, "specialization": None, "description": None},
    )
    assert resp.status_code == 200


def _create_team(client: TestClient, token: str, name: str = "Ястребы") -> dict:
    resp = client.post(
        "/api/teams",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": name, "description": None, "sport": "Футбол", "age_category": "U-16", "level": "amateur"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_create_team_requires_coach_profile(logged_in_client) -> None:
    client, token = logged_in_client

    response = client.post(
        "/api/teams",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Ястребы", "description": None, "sport": "Футбол", "age_category": None, "level": None},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "coach_profile_required"


def test_create_team_makes_creator_head_coach(logged_in_client) -> None:
    client, token = logged_in_client
    _create_coach_profile(client, token)

    team = _create_team(client, token)

    assert team["my_role"] == "head_coach"
    assert team["members_count"] == 1
    assert team["status"] == "active"


def test_non_member_can_preview_team_via_invite_token(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token, name="Барсы")

    invite = client.post(
        f"/api/teams/{team['id']}/invites",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"kind": "join"},
    ).json()

    outsider_token = login_as(123123, first_name="Outsider")
    preview = client.get(
        f"/api/invites/{invite['token']}", headers={"Authorization": f"Bearer {outsider_token}"}
    )
    assert preview.status_code == 200
    assert preview.json()["name"] == "Барсы"
    assert preview.json()["my_role"] is None


def test_non_member_cannot_see_team(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    outsider_token = login_as(111222, first_name="Outsider")
    response = client.get(f"/api/teams/{team['id']}", headers={"Authorization": f"Bearer {outsider_token}"})

    assert response.status_code == 403


def test_invite_apply_and_accept_flow(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    invite_resp = client.post(
        f"/api/teams/{team['id']}/invites",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"kind": "join"},
    )
    assert invite_resp.status_code == 200
    token_value = invite_resp.json()["token"]
    assert "t.me" in invite_resp.json()["link"] or "invite=" in invite_resp.json()["link"]

    player_token = login_as(222333, first_name="Player")
    apply_resp = client.post(
        f"/api/invites/{token_value}/apply", headers={"Authorization": f"Bearer {player_token}"}
    )
    assert apply_resp.status_code == 200
    assert apply_resp.json()["status"] == "pending"

    # Applying twice is idempotent, not an error.
    apply_again = client.post(
        f"/api/invites/{token_value}/apply", headers={"Authorization": f"Bearer {player_token}"}
    )
    assert apply_again.status_code == 200

    applications = client.get(
        f"/api/teams/{team['id']}/applications", headers={"Authorization": f"Bearer {coach_token}"}
    ).json()
    assert len(applications) == 1
    request_id = applications[0]["id"]

    accept_resp = client.post(
        f"/api/teams/{team['id']}/applications/{request_id}/accept",
        headers={"Authorization": f"Bearer {coach_token}"},
    )
    assert accept_resp.status_code == 204

    members = client.get(
        f"/api/teams/{team['id']}/members", headers={"Authorization": f"Bearer {coach_token}"}
    ).json()
    roles = {m["telegram_id"]: m["role"] for m in members}
    assert roles[222333] == "player"


def test_blocked_user_cannot_apply(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(333444, first_name="Blocked")
    invite = client.post(
        f"/api/teams/{team['id']}/invites",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"kind": "join"},
    ).json()

    client.post(f"/api/invites/{invite['token']}/apply", headers={"Authorization": f"Bearer {player_token}"})
    applications = client.get(
        f"/api/teams/{team['id']}/applications", headers={"Authorization": f"Bearer {coach_token}"}
    ).json()
    client.post(
        f"/api/teams/{team['id']}/applications/{applications[0]['id']}/accept",
        headers={"Authorization": f"Bearer {coach_token}"},
    )

    # head coach blocks the (now member) player
    blocked_user_id = _member_user_id(client, team["id"], coach_token, 333444)
    block_resp = client.post(
        f"/api/teams/{team['id']}/members/{blocked_user_id}/block",
        headers={"Authorization": f"Bearer {coach_token}"},
    )
    assert block_resp.status_code == 204

    reapply = client.post(
        f"/api/invites/{invite['token']}/apply", headers={"Authorization": f"Bearer {player_token}"}
    )
    assert reapply.status_code == 403


def test_only_head_coach_can_block(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    assistant_token = login_as(444555, first_name="Assistant")
    invite = client.post(
        f"/api/teams/{team['id']}/invites",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"kind": "join"},
    ).json()
    client.post(f"/api/invites/{invite['token']}/apply", headers={"Authorization": f"Bearer {assistant_token}"})
    applications = client.get(
        f"/api/teams/{team['id']}/applications", headers={"Authorization": f"Bearer {coach_token}"}
    ).json()
    client.post(
        f"/api/teams/{team['id']}/applications/{applications[0]['id']}/accept",
        headers={"Authorization": f"Bearer {coach_token}"},
    )
    assistant_user_id = _member_user_id(client, team["id"], coach_token, 444555)
    client.patch(
        f"/api/teams/{team['id']}/members/{assistant_user_id}",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"role": "assistant_coach"},
    )

    response = client.post(
        f"/api/teams/{team['id']}/members/{assistant_user_id}/block",
        headers={"Authorization": f"Bearer {assistant_token}"},
    )
    assert response.status_code == 403


def test_only_one_captain_allowed(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    invite = client.post(
        f"/api/teams/{team['id']}/invites",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"kind": "join"},
    ).json()

    tokens = []
    for i, tid in enumerate([555666, 666777]):
        t = login_as(tid, first_name=f"Player{i}")
        client.post(f"/api/invites/{invite['token']}/apply", headers={"Authorization": f"Bearer {t}"})
        tokens.append(t)

    applications = client.get(
        f"/api/teams/{team['id']}/applications", headers={"Authorization": f"Bearer {coach_token}"}
    ).json()
    for app in applications:
        client.post(
            f"/api/teams/{team['id']}/applications/{app['id']}/accept",
            headers={"Authorization": f"Bearer {coach_token}"},
        )

    user_id_1 = _member_user_id(client, team["id"], coach_token, 555666)
    user_id_2 = _member_user_id(client, team["id"], coach_token, 666777)

    resp1 = client.patch(
        f"/api/teams/{team['id']}/members/{user_id_1}",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"role": "captain"},
    )
    assert resp1.status_code == 200

    resp2 = client.patch(
        f"/api/teams/{team['id']}/members/{user_id_2}",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"role": "captain"},
    )
    assert resp2.status_code == 409
    assert resp2.json()["error"]["code"] == "captain_already_assigned"


def test_head_coach_leaving_orphans_team_and_captain_can_invite_new_coach(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    captain_token = login_as(777888, first_name="Captain")
    invite = client.post(
        f"/api/teams/{team['id']}/invites",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"kind": "join"},
    ).json()
    client.post(f"/api/invites/{invite['token']}/apply", headers={"Authorization": f"Bearer {captain_token}"})
    applications = client.get(
        f"/api/teams/{team['id']}/applications", headers={"Authorization": f"Bearer {coach_token}"}
    ).json()
    client.post(
        f"/api/teams/{team['id']}/applications/{applications[0]['id']}/accept",
        headers={"Authorization": f"Bearer {coach_token}"},
    )
    captain_user_id = _member_user_id(client, team["id"], coach_token, 777888)
    client.patch(
        f"/api/teams/{team['id']}/members/{captain_user_id}",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"role": "captain"},
    )

    # Head coach leaves -> team becomes without_coach.
    leave_resp = client.post(f"/api/teams/{team['id']}/leave", headers={"Authorization": f"Bearer {coach_token}"})
    assert leave_resp.status_code == 204

    team_state = client.get(
        f"/api/teams/{team['id']}", headers={"Authorization": f"Bearer {captain_token}"}
    ).json()
    assert team_state["status"] == "without_coach"

    # A regular join invite can no longer be created by the (now former) coach staff -> only captain, head_coach kind.
    forbidden = client.post(
        f"/api/teams/{team['id']}/invites",
        headers={"Authorization": f"Bearer {captain_token}"},
        json={"kind": "join"},
    )
    assert forbidden.status_code == 403

    hc_invite = client.post(
        f"/api/teams/{team['id']}/invites",
        headers={"Authorization": f"Bearer {captain_token}"},
        json={"kind": "head_coach"},
    )
    assert hc_invite.status_code == 200
    hc_token_value = hc_invite.json()["token"]

    new_coach_token = login_as(888999, first_name="NewCoach")
    accept_resp = client.post(
        f"/api/invites/{hc_token_value}/apply", headers={"Authorization": f"Bearer {new_coach_token}"}
    )
    assert accept_resp.status_code == 200
    assert accept_resp.json()["status"] == "joined"
    assert accept_resp.json()["team"]["status"] == "active"


def test_transfer_ownership_requires_exact_phrase(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token, name="Соколы")

    successor_token = login_as(999000, first_name="Ivan", last_name="Petrov")
    invite = client.post(
        f"/api/teams/{team['id']}/invites",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"kind": "join"},
    ).json()
    client.post(f"/api/invites/{invite['token']}/apply", headers={"Authorization": f"Bearer {successor_token}"})
    applications = client.get(
        f"/api/teams/{team['id']}/applications", headers={"Authorization": f"Bearer {coach_token}"}
    ).json()
    client.post(
        f"/api/teams/{team['id']}/applications/{applications[0]['id']}/accept",
        headers={"Authorization": f"Bearer {coach_token}"},
    )

    wrong_phrase = client.post(
        f"/api/teams/{team['id']}/transfer-ownership",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"to_user_id": _member_user_id(client, team["id"], coach_token, 999000), "confirmation_phrase": "неверно"},
    )
    assert wrong_phrase.status_code == 400

    to_user_id = _member_user_id(client, team["id"], coach_token, 999000)
    correct_phrase = f"Я передаю роль основного тренера команды «Соколы» пользователю Ivan Petrov"
    ok_resp = client.post(
        f"/api/teams/{team['id']}/transfer-ownership",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"to_user_id": to_user_id, "confirmation_phrase": correct_phrase},
    )
    assert ok_resp.status_code == 204

    members = client.get(
        f"/api/teams/{team['id']}/members", headers={"Authorization": f"Bearer {coach_token}"}
    ).json()
    roles = {m["telegram_id"]: m["role"] for m in members}
    assert roles[999000] == "head_coach"
    assert roles[900001] == "assistant_coach"


def _member_user_id(client: TestClient, team_id: str, token: str, telegram_id: int) -> str:
    members = client.get(f"/api/teams/{team_id}/members", headers={"Authorization": f"Bearer {token}"}).json()
    return next(m["user_id"] for m in members if m["telegram_id"] == telegram_id)


def test_player_can_leave_team_voluntarily(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(112233, first_name="Leaver")
    invite = client.post(
        f"/api/teams/{team['id']}/invites",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"kind": "join"},
    ).json()
    client.post(f"/api/invites/{invite['token']}/apply", headers={"Authorization": f"Bearer {player_token}"})
    applications = client.get(
        f"/api/teams/{team['id']}/applications", headers={"Authorization": f"Bearer {coach_token}"}
    ).json()
    client.post(
        f"/api/teams/{team['id']}/applications/{applications[0]['id']}/accept",
        headers={"Authorization": f"Bearer {coach_token}"},
    )

    leave_resp = client.post(f"/api/teams/{team['id']}/leave", headers={"Authorization": f"Bearer {player_token}"})
    assert leave_resp.status_code == 204

    forbidden = client.get(f"/api/teams/{team['id']}", headers={"Authorization": f"Bearer {player_token}"})
    assert forbidden.status_code == 403


def _add_player_to_team(client: TestClient, coach_token: str, team_id: str, player_token: str) -> None:
    invite = client.post(
        f"/api/teams/{team_id}/invites", headers={"Authorization": f"Bearer {coach_token}"}, json={"kind": "join"}
    ).json()
    client.post(f"/api/invites/{invite['token']}/apply", headers={"Authorization": f"Bearer {player_token}"})
    applications = client.get(
        f"/api/teams/{team_id}/applications", headers={"Authorization": f"Bearer {coach_token}"}
    ).json()
    client.post(
        f"/api/teams/{team_id}/applications/{applications[0]['id']}/accept",
        headers={"Authorization": f"Bearer {coach_token}"},
    )


def test_coach_can_view_member_player_profile(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(500100, first_name="Player")
    client.put(
        "/api/profile/player",
        headers={"Authorization": f"Bearer {player_token}"},
        json={"full_name": "Игрок Один", "sport": "Футбол", "age": 20, "height_cm": 180, "weight_kg": 75, "position": "нападающий", "level": "amateur", "goals": None, "load_restrictions": None},
    )
    _add_player_to_team(client, coach_token, team["id"], player_token)
    player_id = _member_user_id(client, team["id"], coach_token, 500100)

    response = client.get(
        f"/api/teams/{team['id']}/members/{player_id}/profile", headers={"Authorization": f"Bearer {coach_token}"}
    )
    assert response.status_code == 200
    assert response.json()["full_name"] == "Игрок Один"


def test_player_cannot_view_another_members_profile(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(500101, first_name="Player")
    _add_player_to_team(client, coach_token, team["id"], player_token)
    player_id = _member_user_id(client, team["id"], coach_token, 500101)

    response = client.get(
        f"/api/teams/{team['id']}/members/{player_id}/profile", headers={"Authorization": f"Bearer {player_token}"}
    )
    assert response.status_code == 403


def test_view_profile_404_when_member_has_no_player_profile(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    player_token = login_as(500102, first_name="Player")
    _add_player_to_team(client, coach_token, team["id"], player_token)
    player_id = _member_user_id(client, team["id"], coach_token, 500102)

    response = client.get(
        f"/api/teams/{team['id']}/members/{player_id}/profile", headers={"Authorization": f"Bearer {coach_token}"}
    )
    assert response.status_code == 404


def test_head_coach_cannot_block_self(logged_in_client) -> None:
    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)
    coach_id = _member_user_id(client, team["id"], coach_token, 900001)

    response = client.post(
        f"/api/teams/{team['id']}/members/{coach_id}/block", headers={"Authorization": f"Bearer {coach_token}"}
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "bad_request"


def test_only_head_coach_can_promote_to_assistant(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)

    assistant_token = login_as(700001, first_name="Assistant")
    _add_player_to_team(client, coach_token, team["id"], assistant_token)
    assistant_id = _member_user_id(client, team["id"], coach_token, 700001)
    client.patch(f"/api/teams/{team['id']}/members/{assistant_id}", headers=coach_headers, json={"role": "assistant_coach"})

    other_player_token = login_as(700002, first_name="Other")
    _add_player_to_team(client, coach_token, team["id"], other_player_token)
    other_player_id = _member_user_id(client, team["id"], coach_token, 700002)

    response = client.patch(
        f"/api/teams/{team['id']}/members/{other_player_id}",
        headers={"Authorization": f"Bearer {assistant_token}"},
        json={"role": "assistant_coach"},
    )
    assert response.status_code == 403


def test_head_coach_cannot_be_removed_and_only_head_coach_removes_assistant(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)
    coach_id = _member_user_id(client, team["id"], coach_token, 900001)

    assistant_token = login_as(700003, first_name="Assistant")
    _add_player_to_team(client, coach_token, team["id"], assistant_token)
    assistant_id = _member_user_id(client, team["id"], coach_token, 700003)
    client.patch(f"/api/teams/{team['id']}/members/{assistant_id}", headers=coach_headers, json={"role": "assistant_coach"})

    remove_head_coach = client.delete(f"/api/teams/{team['id']}/members/{coach_id}", headers=coach_headers)
    assert remove_head_coach.status_code == 403

    remove_assistant_by_assistant = client.delete(
        f"/api/teams/{team['id']}/members/{assistant_id}", headers={"Authorization": f"Bearer {assistant_token}"}
    )
    assert remove_assistant_by_assistant.status_code == 403

    remove_assistant_by_head_coach = client.delete(f"/api/teams/{team['id']}/members/{assistant_id}", headers=coach_headers)
    assert remove_assistant_by_head_coach.status_code == 204
