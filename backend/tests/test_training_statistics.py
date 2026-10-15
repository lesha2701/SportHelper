"""What counts as "a training took place". The coach's explicit mark wins: a training marked
as held counts in the statistics at once - even one scheduled for a later date - and stops
being "upcoming". (Runs against the fakes and, with SAG_TEST_REAL_DB=1, against PostgreSQL.)"""
from __future__ import annotations

from datetime import date, timedelta

from tests.test_teams_api import _add_player_to_team, _create_coach_profile, _create_team, _member_user_id

_IN_A_WEEK = (date.today() + timedelta(days=7)).isoformat()
_YESTERDAY = (date.today() - timedelta(days=1)).isoformat()


def _payload(day: str) -> dict:
    return {"training_date": day, "start_time": "18:00:00", "duration_minutes": 90, "location": "Зал", "description": None,
            "plan_id": None, "reminder_minutes_before": None, "repeat_weekly_until": None, "is_independent": False,
            "responsible_user_id": None}


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _team_with_player(client, coach_token, login_as, number: int = 881001):
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)
    player_token = login_as(number, first_name="Игрок")
    _add_player_to_team(client, coach_token, team["id"], player_token)
    return team, player_token, _member_user_id(client, team["id"], coach_token, number)


def _schedule(client, coach_token, team_id: str, day: str) -> dict:
    resp = client.post(f"/api/teams/{team_id}/trainings", headers=_headers(coach_token), json=_payload(day))
    assert resp.status_code == 200, resp.text
    return resp.json()[0]


def _set_status(client, coach_token, training: dict, status: str) -> None:
    resp = client.put(
        f"/api/trainings/{training['id']}", headers=_headers(coach_token),
        json={"training_date": training["training_date"], "start_time": training["start_time"],
              "duration_minutes": training["duration_minutes"], "location": training["location"],
              "description": training["description"], "plan_id": training["plan_id"],
              "reminder_minutes_before": training["reminder_minutes_before"], "status": status,
              "is_independent": False, "responsible_user_id": None},
    )
    assert resp.status_code == 200, resp.text


def _team_stats(client, coach_token, team_id: str) -> dict:
    resp = client.get(f"/api/teams/{team_id}/stats", headers=_headers(coach_token))
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_a_future_training_marked_as_held_is_counted_and_is_no_longer_upcoming(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    team, _, _ = _team_with_player(client, coach_token, login_as)
    training = _schedule(client, coach_token, team["id"], _IN_A_WEEK)

    before = _team_stats(client, coach_token, team["id"])
    assert (before["trainings_completed"], before["trainings_upcoming"]) == (0, 1)

    _set_status(client, coach_token, training, "completed")

    after = _team_stats(client, coach_token, team["id"])
    assert (after["trainings_completed"], after["trainings_upcoming"]) == (1, 0)


def test_taking_it_back_makes_it_upcoming_again(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    team, _, _ = _team_with_player(client, coach_token, login_as)
    training = _schedule(client, coach_token, team["id"], _IN_A_WEEK)
    _set_status(client, coach_token, training, "completed")

    _set_status(client, coach_token, training, "scheduled")

    stats = _team_stats(client, coach_token, team["id"])
    assert (stats["trainings_completed"], stats["trainings_upcoming"]) == (0, 1)


def test_cancelled_trainings_are_never_counted_past_or_future(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    team, _, _ = _team_with_player(client, coach_token, login_as)
    past = _schedule(client, coach_token, team["id"], _YESTERDAY)
    future = _schedule(client, coach_token, team["id"], _IN_A_WEEK)

    _set_status(client, coach_token, past, "cancelled")
    _set_status(client, coach_token, future, "cancelled")

    stats = _team_stats(client, coach_token, team["id"])
    assert (stats["trainings_completed"], stats["trainings_upcoming"]) == (0, 0)


def test_a_past_training_nobody_marked_still_counts_as_held(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    team, _, _ = _team_with_player(client, coach_token, login_as)
    _schedule(client, coach_token, team["id"], _YESTERDAY)

    stats = _team_stats(client, coach_token, team["id"])

    assert (stats["trainings_completed"], stats["trainings_upcoming"]) == (1, 0)


def test_marking_a_training_held_counts_the_whole_team_as_present_right_away(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    team, player_token, player_id = _team_with_player(client, coach_token, login_as)
    training = _schedule(client, coach_token, team["id"], _IN_A_WEEK)

    _set_status(client, coach_token, training, "completed")  # the coach never opens the attendance screen

    mine = client.get(f"/api/players/{player_id}/stats", headers=_headers(player_token)).json()
    assert mine["trainings_attended"] == 1 and mine["attendance_rate"] == 1.0
    roster = _team_stats(client, coach_token, team["id"])["attendance"] if "attendance" in _team_stats(client, coach_token, team["id"]) else None
    if roster is not None:
        assert all(row["absent_count"] == 0 for row in roster)


def test_the_coach_can_still_flip_someone_to_absent_afterwards(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    team, player_token, player_id = _team_with_player(client, coach_token, login_as)
    training = _schedule(client, coach_token, team["id"], _IN_A_WEEK)
    _set_status(client, coach_token, training, "completed")

    flipped = client.patch(f"/api/trainings/{training['id']}/attendance/{player_id}", headers=_headers(coach_token), json={"status": "absent"})

    assert flipped.status_code == 200
    mine = client.get(f"/api/players/{player_id}/stats", headers=_headers(player_token)).json()
    assert mine["trainings_attended"] == 0 and mine["attendance_rate"] == 0.0


def test_a_personal_training_marked_held_counts_for_the_athlete(logged_in_client) -> None:
    client, token = logged_in_client
    created = client.post("/api/trainings/personal", headers=_headers(token), json={**_payload(_IN_A_WEEK), "is_independent": False})
    assert created.status_code == 200, created.text
    training = created.json()[0]
    me = client.get("/api/auth/me", headers=_headers(token)).json()["id"]
    assert client.get(f"/api/players/{me}/stats", headers=_headers(token)).json()["personal_trainings_count"] == 0

    client.put(f"/api/trainings/{training['id']}", headers=_headers(token), json={
        "training_date": training["training_date"], "start_time": training["start_time"], "duration_minutes": 90,
        "location": None, "description": None, "plan_id": None, "reminder_minutes_before": None,
        "status": "completed", "is_independent": False, "responsible_user_id": None})

    assert client.get(f"/api/players/{me}/stats", headers=_headers(token)).json()["personal_trainings_count"] == 1


async def test_the_background_pass_marks_members_present_on_trainings_that_took_place_unattended(logged_in_client, login_as) -> None:
    from app.services import background

    client, coach_token = logged_in_client
    team, player_token, player_id = _team_with_player(client, coach_token, login_as)
    _schedule(client, coach_token, team["id"], _YESTERDAY)  # nobody marked it, nobody opened the attendance

    await background.sweep_attendance(None)

    mine = client.get(f"/api/players/{player_id}/stats", headers=_headers(player_token)).json()
    assert mine["trainings_attended"] == 1


# --- the coach's rating of the team ---------------------------------------------------------------


def _held_training(client, coach_token, team_id: str) -> dict:
    training = _schedule(client, coach_token, team_id, _IN_A_WEEK)
    _set_status(client, coach_token, training, "completed")
    return training


def test_the_coach_can_rate_how_the_team_did(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    team, _, _ = _team_with_player(client, coach_token, login_as)
    training = _held_training(client, coach_token, team["id"])

    resp = client.post(f"/api/trainings/{training['id']}/feedback", headers=_headers(coach_token),
                       json={"team_rating": 4, "difficulty": 7, "comment": "Хорошо работали в защите"})

    assert resp.status_code == 200, resp.text
    assert resp.json()["team_rating"] == 4 and resp.json()["comment"] == "Хорошо работали в защите"
    again = client.get(f"/api/trainings/{training['id']}/feedback", headers=_headers(coach_token)).json()
    assert again["team_rating"] == 4 and again["wellbeing"] is None


def test_a_player_cannot_leave_a_team_rating_but_can_still_rate_their_own_wellbeing(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    team, player_token, _ = _team_with_player(client, coach_token, login_as)
    training = _held_training(client, coach_token, team["id"])

    forged = client.post(f"/api/trainings/{training['id']}/feedback", headers=_headers(player_token), json={"team_rating": 5})
    own = client.post(f"/api/trainings/{training['id']}/feedback", headers=_headers(player_token), json={"wellbeing": 4})

    assert forged.status_code == 403
    assert own.status_code == 200 and own.json()["wellbeing"] == 4 and own.json()["team_rating"] is None


def test_the_team_rating_is_between_one_and_five_and_not_for_personal_trainings(logged_in_client) -> None:
    client, token = logged_in_client
    personal = client.post("/api/trainings/personal", headers=_headers(token), json=_payload(_YESTERDAY)).json()[0]
    client.put(f"/api/trainings/{personal['id']}", headers=_headers(token), json={
        "training_date": personal["training_date"], "start_time": personal["start_time"], "duration_minutes": 90,
        "location": None, "description": None, "plan_id": None, "reminder_minutes_before": None,
        "status": "completed", "is_independent": False, "responsible_user_id": None})

    assert client.post(f"/api/trainings/{personal['id']}/feedback", headers=_headers(token), json={"team_rating": 4}).status_code == 400
    assert client.post(f"/api/trainings/{personal['id']}/feedback", headers=_headers(token), json={"team_rating": 6}).status_code == 422
    assert client.post(f"/api/trainings/{personal['id']}/feedback", headers=_headers(token), json={"team_rating": 0}).status_code == 422


def test_the_players_never_see_the_coachs_rating(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    team, player_token, _ = _team_with_player(client, coach_token, login_as)
    training = _held_training(client, coach_token, team["id"])
    client.post(f"/api/trainings/{training['id']}/feedback", headers=_headers(coach_token), json={"team_rating": 2})

    assert client.get(f"/api/trainings/{training['id']}/feedback", headers=_headers(player_token)).json() is None
