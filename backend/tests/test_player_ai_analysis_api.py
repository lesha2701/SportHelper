from __future__ import annotations

import json
from datetime import date

from tests.conftest import ai_prompts_sent
from tests.test_ai_api import _create_player_profile
from tests.test_booking_confirmation_api import _create_pending_booking
from tests.test_exercises_api import _EXERCISE_PAYLOAD
from tests.test_metrics_api import _metric_payload

_AI_UNKNOWN_ID = "11111111-1111-1111-1111-111111111111"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _analysis_json(**overrides) -> str:
    data = {
        "summary": "Игрок-любитель, цель — стать быстрее.",
        "strengths": ["Регулярные тренировки"],
        "attention_points": ["Мало данных по выносливости"],
        "recent_dynamics": [],
        "recommendations": ["Начать с короткой диагностики"],
        "session_focus": "Скорость первых шагов",
        "session_plan": [
            {"stage": "Разминка", "description": "Суставная разминка 10 минут", "exercise_id": None},
        ],
        "data_notes": None,
    }
    data.update(overrides)
    return json.dumps(data, ensure_ascii=False)


def _confirmed_session(client, coach_token, login_as, telegram_id=890301):
    """A confirmed personal training: returns (training_id, athlete_token, athlete_user_id)."""
    _listing, athlete_token, booking = _create_pending_booking(client, coach_token, login_as, telegram_id)
    confirmed = client.post(f"/api/bookings/{booking['id']}/confirm", headers=_headers(coach_token))
    assert confirmed.status_code == 200, confirmed.text
    athlete_id = client.get("/api/auth/me", headers=_headers(athlete_token)).json()["id"]
    return confirmed.json()["training_id"], athlete_token, athlete_id


def _set_consent(client, token, allowed: bool):
    return client.put(
        "/api/users/me/privacy", headers=_headers(token), json={"allow_ai_analysis_by_personal_coach": allowed}
    )


def _analysis_url(training_id: str) -> str:
    return f"/api/trainings/{training_id}/ai/player-analysis"


# --- Settings -----------------------------------------------------------------


def test_ai_analysis_consent_is_off_by_default(logged_in_client) -> None:
    client, token = logged_in_client

    resp = client.get("/api/users/me/privacy", headers=_headers(token))

    assert resp.status_code == 200
    assert resp.json() == {"allow_ai_analysis_by_personal_coach": False}


def test_player_can_turn_consent_on_and_off(logged_in_client) -> None:
    client, token = logged_in_client

    assert _set_consent(client, token, True).json() == {"allow_ai_analysis_by_personal_coach": True}
    assert client.get("/api/users/me/privacy", headers=_headers(token)).json()["allow_ai_analysis_by_personal_coach"] is True

    assert _set_consent(client, token, False).json() == {"allow_ai_analysis_by_personal_coach": False}
    assert client.get("/api/users/me/privacy", headers=_headers(token)).json()["allow_ai_analysis_by_personal_coach"] is False


def test_privacy_setting_cannot_be_changed_for_someone_else(logged_in_client, login_as) -> None:
    client, token = logged_in_client
    other_token = login_as(890302, first_name="Other")

    # The endpoint has no user id anywhere: it only ever edits the caller's own value.
    assert _set_consent(client, other_token, True).status_code == 200
    assert client.get("/api/users/me/privacy", headers=_headers(token)).json()["allow_ai_analysis_by_personal_coach"] is False
    assert client.put("/api/users/me/privacy").status_code in (401, 405)


# --- Access -------------------------------------------------------------------


def test_session_coach_can_analyze_when_player_allows(logged_in_client, login_as, queue_ai_response) -> None:
    client, coach_token = logged_in_client
    training_id, athlete_token, _ = _confirmed_session(client, coach_token, login_as)
    _create_player_profile(client, athlete_token, sport="Теннис")
    _set_consent(client, athlete_token, True)
    queue_ai_response(_analysis_json())

    resp = client.post(_analysis_url(training_id), headers=_headers(coach_token))

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["summary"].startswith("Игрок-любитель")
    assert body["session_plan"][0]["stage"] == "Разминка"
    assert body["data_sufficiency"] == "insufficient"  # no history yet, only a profile


def test_analysis_denied_when_player_has_not_allowed(logged_in_client, login_as, queue_ai_response) -> None:
    client, coach_token = logged_in_client
    training_id, _athlete_token, _ = _confirmed_session(client, coach_token, login_as)
    queue_ai_response(_analysis_json())

    resp = client.post(_analysis_url(training_id), headers=_headers(coach_token))

    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "player_ai_analysis_disabled"
    assert ai_prompts_sent == []  # the model was never called

    status = client.get(_analysis_url(training_id), headers=_headers(coach_token))
    assert status.status_code == 200
    assert status.json() == {"allowed": False, "analysis": None}


def test_other_coach_cannot_analyze(logged_in_client, login_as, queue_ai_response) -> None:
    client, coach_token = logged_in_client
    training_id, athlete_token, _ = _confirmed_session(client, coach_token, login_as)
    _set_consent(client, athlete_token, True)
    stranger_token = login_as(890303, first_name="Stranger")
    queue_ai_response(_analysis_json())

    for method in (client.post, client.get):
        resp = method(_analysis_url(training_id), headers=_headers(stranger_token))
        assert resp.status_code == 403
        assert resp.json()["error"]["code"] == "not_session_coach"
    assert ai_prompts_sent == []


def test_athlete_cannot_analyze_through_the_coach_endpoint(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    training_id, athlete_token, _ = _confirmed_session(client, coach_token, login_as)
    _set_consent(client, athlete_token, True)

    resp = client.post(_analysis_url(training_id), headers=_headers(athlete_token))

    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "not_session_coach"


def test_player_id_in_request_is_ignored(logged_in_client, login_as, queue_ai_response) -> None:
    """The athlete comes from the training; a client-supplied player id changes nothing."""
    client, coach_token = logged_in_client
    training_id, athlete_token, athlete_id = _confirmed_session(client, coach_token, login_as, 890304)
    # A second athlete who did allow analysis, but has no session with this coach.
    other_athlete_token = login_as(890305, first_name="Other")
    other_id = client.get("/api/auth/me", headers=_headers(other_athlete_token)).json()["id"]
    _set_consent(client, other_athlete_token, True)  # the real athlete (890304) has NOT allowed
    queue_ai_response(_analysis_json())

    resp = client.post(
        _analysis_url(training_id),
        headers=_headers(coach_token),
        params={"player_id": other_id},
        json={"player_id": other_id},
    )

    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "player_ai_analysis_disabled"
    assert athlete_id != other_id


def test_unknown_training_is_404(logged_in_client) -> None:
    client, coach_token = logged_in_client

    resp = client.post(_analysis_url(_AI_UNKNOWN_ID), headers=_headers(coach_token))

    assert resp.status_code == 404


def test_unconfirmed_or_declined_booking_gives_no_access(logged_in_client, login_as, queue_ai_response) -> None:
    client, coach_token = logged_in_client
    _listing, athlete_token, booking = _create_pending_booking(client, coach_token, login_as, 890306)
    _set_consent(client, athlete_token, True)
    queue_ai_response(_analysis_json())
    # A pending booking has no training at all, so there is nothing to analyze...
    assert booking["training_id"] is None

    # ...and a booking that was confirmed and later stopped being 'confirmed'
    # (e.g. cancelled) must not keep the door open.
    confirmed = client.post(f"/api/bookings/{booking['id']}/confirm", headers=_headers(coach_token)).json()
    client.bookings_store[next(iter(client.bookings_store))]["status"] = "cancelled"

    resp = client.post(_analysis_url(confirmed["training_id"]), headers=_headers(coach_token))

    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "not_session_coach"


def test_non_personal_training_is_not_analyzable(logged_in_client, queue_ai_response) -> None:
    from tests.test_teams_api import _create_coach_profile, _create_team

    client, coach_token = logged_in_client
    _create_coach_profile(client, coach_token)
    team = _create_team(client, coach_token)
    created = client.post(
        f"/api/teams/{team['id']}/trainings",
        headers=_headers(coach_token),
        json={
            "training_date": date.today().isoformat(),
            "start_time": "18:00:00",
            "duration_minutes": 60,
            "location": None,
            "description": None,
            "reminder_minutes_before": None,
        },
    )
    assert created.status_code == 200, created.text
    team_training_id = created.json()[0]["id"]

    resp = client.post(_analysis_url(team_training_id), headers=_headers(coach_token))

    assert resp.status_code == 403


# --- Stored result & withdrawing consent ---------------------------------------


def test_result_is_kept_and_served_only_while_consent_is_on(logged_in_client, login_as, queue_ai_response) -> None:
    client, coach_token = logged_in_client
    training_id, athlete_token, _ = _confirmed_session(client, coach_token, login_as)
    _set_consent(client, athlete_token, True)
    queue_ai_response(_analysis_json(summary="Первый анализ"))
    assert client.post(_analysis_url(training_id), headers=_headers(coach_token)).status_code == 200

    saved = client.get(_analysis_url(training_id), headers=_headers(coach_token)).json()
    assert saved["allowed"] is True
    assert saved["analysis"]["summary"] == "Первый анализ"

    # Re-running replaces it (one analysis per training, not a growing profile).
    queue_ai_response(_analysis_json(summary="Обновлённый анализ"))
    client.post(_analysis_url(training_id), headers=_headers(coach_token))
    assert client.get(_analysis_url(training_id), headers=_headers(coach_token)).json()["analysis"]["summary"] == (
        "Обновлённый анализ"
    )
    assert len(client.ai_analyses_store) == 1

    # The player withdraws consent: nothing stored is served, and nothing is left stored.
    _set_consent(client, athlete_token, False)
    after = client.get(_analysis_url(training_id), headers=_headers(coach_token))
    assert after.json() == {"allowed": False, "analysis": None}
    assert client.ai_analyses_store == {}
    assert client.post(_analysis_url(training_id), headers=_headers(coach_token)).status_code == 403


# --- What the model sees ---------------------------------------------------------


def test_prompt_contains_sports_data_but_no_identifiers(logged_in_client, login_as, queue_ai_response) -> None:
    client, coach_token = logged_in_client
    training_id, athlete_token, athlete_id = _confirmed_session(client, coach_token, login_as, 890307)
    _create_player_profile(client, athlete_token, sport="Теннис")
    _set_consent(client, athlete_token, True)
    for i in range(6):
        client.post(
            f"/api/players/{athlete_id}/metrics",
            headers=_headers(athlete_token),
            json=_metric_payload(name="Скорость подачи", unit="км/ч", value=150 + i),
        )
    queue_ai_response(_analysis_json())

    resp = client.post(_analysis_url(training_id), headers=_headers(coach_token))

    assert resp.status_code == 200
    assert resp.json()["data_sufficiency"] == "sufficient"
    (system_prompt, user_prompt), = ai_prompts_sent
    assert "Скорость подачи" in user_prompt
    assert "стать быстрее" in user_prompt  # the player's own goal
    athlete = client.get("/api/auth/me", headers=_headers(athlete_token)).json()
    for secret in (
        str(athlete["telegram_id"]),
        athlete["username"] or "~none~",
        athlete["first_name"],
        athlete_id,
        training_id,
        athlete_token,
        coach_token,
        "Игрок",  # the profile's full_name
    ):
        assert secret not in user_prompt, f"{secret!r} leaked into the AI prompt"
        assert secret not in system_prompt


def test_only_the_coachs_own_library_exercises_are_referenced(logged_in_client, login_as, queue_ai_response) -> None:
    client, coach_token = logged_in_client
    training_id, athlete_token, _ = _confirmed_session(client, coach_token, login_as, 890308)
    _create_player_profile(client, athlete_token, sport="Теннис")
    _set_consent(client, athlete_token, True)
    own = client.post(
        "/api/exercises", headers=_headers(coach_token), json={**_EXERCISE_PAYLOAD, "sport": "Теннис", "name": "Подача по линиям"}
    ).json()
    queue_ai_response(
        _analysis_json(
            session_plan=[
                {"stage": "Основной блок", "description": "Отработка подачи", "exercise_id": own["id"]},
                {"stage": "Игровая часть", "description": "Розыгрыши", "exercise_id": _AI_UNKNOWN_ID},
            ]
        )
    )

    resp = client.post(_analysis_url(training_id), headers=_headers(coach_token))

    assert resp.status_code == 200
    plan = resp.json()["session_plan"]
    assert plan[0]["exercise_id"] == own["id"]
    assert plan[0]["exercise_name"] == "Подача по линиям"  # the name comes from the library, not the model
    assert plan[1]["exercise_id"] is None and plan[1]["exercise_name"] is None
    (_system, user_prompt), = ai_prompts_sent
    assert own["id"] in user_prompt and "Подача по линиям" in user_prompt


def test_ai_failure_is_reported_cleanly(logged_in_client, login_as, queue_ai_response) -> None:
    client, coach_token = logged_in_client
    training_id, athlete_token, _ = _confirmed_session(client, coach_token, login_as)
    _set_consent(client, athlete_token, True)
    queue_ai_response("это вообще не JSON")

    resp = client.post(_analysis_url(training_id), headers=_headers(coach_token))

    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "ai_unavailable"
    assert client.ai_analyses_store == {}  # nothing half-saved
