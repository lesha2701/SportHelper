"""«Подобрать тренера», stage 2: a trainer agrees to be recommended, the administrators offer them a request, the trainer and then the
athlete answer - real PostgreSQL, real sessions. The trainer never sees the athlete's name or contacts."""
from __future__ import annotations

import asyncio
from uuid import UUID

import asyncpg
import pytest

from app.repositories import users as users_repo
from app.services import match_offers as svc

from tests.admin_world import Browser, live_client, pg, publish_listing, sql, world  # noqa: F401
from tests.finance_helpers import confirmed_booking
from tests.live_helpers import sql_value

MINE = "/api/match-requests"
QUEUE = "/api/admin/match-requests"
SETTINGS = "/api/match-offers/settings"
INCOMING = "/api/match-offers/incoming"

CONTACTS = "Звоните +7 999 123-45-67, пишите ivan@mail.ru или @ivan_tennis, ещё https://t.me/ivan"


@pytest.fixture
def athlete(world) -> Browser:
    return Browser(world.client, "athlete@example.com", "Анна")


def make_coach(world, email: str = "coach@example.com", *, opted_in: bool = True, listed: bool = True, title: str = "Теннис для взрослых") -> Browser:
    coach = Browser(world.client, email, "Тренер", "coach")
    publish_listing(coach, title, listed=listed)
    if opted_in:
        opt_in(coach)
    return coach


def opt_in(coach: Browser) -> None:
    version = coach.ok("GET", SETTINGS)["current_version"]
    coach.ok("PUT", SETTINGS, json={"enabled": True, "accept_terms_version": version})


def new_request(athlete: Browser, **extra) -> dict:
    return athlete.ok("POST", MINE, json={"sport": "Теннис", "goal": "Поставить удар справа", **extra})


def offer(world, request_id: str, coach: Browser, message: str | None = None) -> dict:
    return world.admin.ok("POST", f"{QUEUE}/{request_id}/offers", json={"coach_user_id": coach.user_id, "message": message})


def offer_id(world, request_id: str, coach: Browser) -> str:
    return next(o["id"] for o in world.admin.ok("GET", f"{QUEUE}/{request_id}")["offers"] if o["coach"]["id"] == coach.user_id)


def error_code(response) -> str:
    return response.json()["error"]["code"]


# --- the trainer's consent -------------------------------------------------------------------------------------------


def test_the_matching_is_off_until_the_trainer_accepts_the_terms(world) -> None:
    coach = make_coach(world, opted_in=False)

    settings = coach.ok("GET", SETTINGS)

    assert settings["enabled"] is False and settings["terms_accepted"] is False and settings["accepted_version"] is None
    assert settings["first_session_percent"] == 50
    text = " ".join(settings["terms"])
    assert "50%" in text and "разово" in text and "контакты спортсмена" in text


def test_switching_on_needs_the_current_terms_and_records_them(world) -> None:
    coach = make_coach(world, opted_in=False)

    assert error_code(coach.call("PUT", SETTINGS, json={"enabled": True})) == "terms_required"
    assert error_code(coach.call("PUT", SETTINGS, json={"enabled": True, "accept_terms_version": "old"})) == "terms_required"
    on = coach.ok("PUT", SETTINGS, json={"enabled": True, "accept_terms_version": svc.TERMS_VERSION})

    assert on["enabled"] is True and on["accepted_version"] == svc.TERMS_VERSION
    row = sql(world.dsn, "SELECT match_terms_version, match_terms_accepted_at FROM coach_profiles")[0]
    assert row["match_terms_version"] == svc.TERMS_VERSION and row["match_terms_accepted_at"] is not None
    assert coach.ok("PUT", SETTINGS, json={"enabled": False})["enabled"] is False


def test_new_terms_switch_the_matching_off_until_accepted_again(world) -> None:
    coach = make_coach(world)
    sql(world.dsn, "UPDATE coach_profiles SET match_terms_version = '2020-01-01'")

    settings = coach.ok("GET", SETTINGS)

    assert settings["enabled"] is False and settings["terms_accepted"] is False


def test_only_a_trainer_has_these_settings(world, athlete) -> None:
    assert athlete.call("GET", SETTINGS).status_code == 409
    assert athlete.call("GET", INCOMING).status_code == 409
    world.client.cookies.clear()
    assert world.client.get(SETTINGS).status_code == 401


# --- who can be offered ----------------------------------------------------------------------------------------------


def test_candidates_are_the_opted_in_trainers_with_a_published_listing(world, athlete) -> None:
    good = make_coach(world, "good@example.com")
    make_coach(world, "off@example.com", opted_in=False)
    make_coach(world, "hidden@example.com", listed=False)
    request = new_request(athlete)

    found = world.admin.ok("GET", f"{QUEUE}/{request['id']}/candidates")

    assert [c["coach_user_id"] for c in found] == [good.user_id]
    assert found[0]["same_sport"] is True and found[0]["already_offered"] is False


def test_candidates_put_the_same_sport_and_pro_first_and_can_be_searched(world, athlete) -> None:
    other_sport = make_coach(world, "box@example.com", title="Бокс")
    sql(world.dsn, "UPDATE coach_profiles SET sport = 'Бокс' WHERE user_id = $1::uuid", other_sport.user_id)
    plain = make_coach(world, "plain@example.com", title="Обычный")
    pro = make_coach(world, "pro@example.com", title="Про")
    sql(world.dsn, "UPDATE coach_profiles SET is_pro = TRUE WHERE user_id = $1::uuid", pro.user_id)
    request = new_request(athlete)

    ids = [c["coach_user_id"] for c in world.admin.ok("GET", f"{QUEUE}/{request['id']}/candidates")]
    assert ids == [pro.user_id, plain.user_id, other_sport.user_id]
    assert [c["coach_user_id"] for c in world.admin.ok("GET", f"{QUEUE}/{request['id']}/candidates", params={"q": "Бокс"})] == [other_sport.user_id]


def test_nobody_is_a_candidate_for_their_own_request(world) -> None:
    coach = make_coach(world)
    request = new_request(coach)

    assert world.admin.ok("GET", f"{QUEUE}/{request['id']}/candidates") == []


def test_a_blocked_pair_is_not_offered_in_either_direction(world, athlete) -> None:
    by_athlete = make_coach(world, "a@example.com")
    by_coach = make_coach(world, "b@example.com", title="Другой")
    request = new_request(athlete)
    sql(world.dsn, "INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1::uuid, $2::uuid)", athlete.user_id, by_athlete.user_id)
    sql(world.dsn, "INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1::uuid, $2::uuid)", by_coach.user_id, athlete.user_id)

    assert world.admin.ok("GET", f"{QUEUE}/{request['id']}/candidates") == []
    refused = world.admin.call("POST", f"{QUEUE}/{request['id']}/offers", json={"coach_user_id": by_coach.user_id})
    assert refused.status_code == 409 and error_code(refused) == "not_eligible"


def test_a_trainer_who_already_has_the_athlete_is_not_offered(world) -> None:
    coach, player, _ = confirmed_booking(world, coach_email="has@example.com", player_email="client@example.com")
    opt_in(coach)
    request = new_request(player)

    assert world.admin.ok("GET", f"{QUEUE}/{request['id']}/candidates") == []


def test_a_trainer_who_leads_a_team_with_the_athlete_is_not_offered(world, athlete) -> None:
    coach = make_coach(world)
    team = coach.ok("POST", "/api/teams", json={"name": "Ястребы", "description": None, "sport": "Теннис", "age_category": None, "level": None})
    sql(world.dsn, "INSERT INTO team_members (team_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'player')", team["id"], athlete.user_id)
    request = new_request(athlete)

    assert world.admin.ok("GET", f"{QUEUE}/{request['id']}/candidates") == []


# --- creating an offer -----------------------------------------------------------------------------------------------


def test_an_offer_takes_the_request_into_work_fixes_the_percent_and_tells_the_trainer(world, athlete) -> None:
    coach = make_coach(world)
    request = new_request(athlete)

    detail = offer(world, request["id"], coach, "Подходит по уровню")

    assert detail["status"] == "in_progress" and detail["handled_by"]
    first = detail["offers"][0]
    assert first["status"] == "proposed" and first["first_session_percent"] == 50 and first["coach"]["id"] == coach.user_id
    assert first["admin_message"] == "Подходит по уровню"
    notified = sql(world.dsn, "SELECT category, entity_type FROM notifications WHERE user_id = $1::uuid", coach.user_id)
    assert [(n["category"], n["entity_type"]) for n in notified] == [("match_offer", "match_offer")]
    audit = sql(world.dsn, "SELECT action FROM admin_audit_log WHERE action = 'match_offer_create'")
    assert len(audit) == 1


def test_a_later_change_of_the_setting_does_not_change_an_offer_already_made(world, athlete, monkeypatch) -> None:
    coach = make_coach(world)
    request = new_request(athlete)
    offer(world, request["id"], coach)

    monkeypatch.setenv("MATCH_FIRST_SESSION_COMMISSION_PERCENT", "35")
    from app.config import get_settings

    get_settings.cache_clear()

    assert coach.ok("GET", INCOMING)[0]["first_session_percent"] == 50
    assert coach.ok("GET", SETTINGS)["first_session_percent"] == 35


def test_one_trainer_gets_a_request_once_and_not_too_many_at_a_time(world, athlete, monkeypatch) -> None:
    first = make_coach(world, "one@example.com")
    second = make_coach(world, "two@example.com", title="Второй")
    request = new_request(athlete)
    offer(world, request["id"], first)

    again = world.admin.call("POST", f"{QUEUE}/{request['id']}/offers", json={"coach_user_id": first.user_id})
    assert again.status_code == 409 and error_code(again) == "already_offered"

    monkeypatch.setattr("app.repositories.match_offers.MAX_ACTIVE_PER_REQUEST", 1)
    many = world.admin.call("POST", f"{QUEUE}/{request['id']}/offers", json={"coach_user_id": second.user_id})
    assert many.status_code == 409 and error_code(many) == "too_many_offers"


def test_only_administrators_make_offers_and_only_for_open_requests(world, athlete) -> None:
    coach = make_coach(world)
    request = new_request(athlete)

    assert coach.call("POST", f"{QUEUE}/{request['id']}/offers", json={"coach_user_id": coach.user_id}).status_code in (401, 403)
    assert coach.call("GET", f"{QUEUE}/{request['id']}/candidates").status_code in (401, 403)
    world.admin.ok("POST", f"{QUEUE}/{request['id']}/close", json={"note": None})
    closed = world.admin.call("POST", f"{QUEUE}/{request['id']}/offers", json={"coach_user_id": coach.user_id})
    assert closed.status_code == 409 and error_code(closed) == "bad_transition"
    missing = world.admin.call("POST", f"{QUEUE}/00000000-0000-0000-0000-000000000000/offers", json={"coach_user_id": coach.user_id})
    assert missing.status_code == 404


# --- what the trainer sees -------------------------------------------------------------------------------------------


def test_the_trainer_sees_the_request_without_the_athlete_and_without_contacts(world, athlete) -> None:
    coach = make_coach(world)
    request = new_request(athlete, comment=CONTACTS, schedule_note="пишите на a@b.ru", city="Москва", level="amateur", budget_max=3000)
    offer(world, request["id"], coach, "Свяжитесь: +79991234567")

    shown = coach.ok("GET", INCOMING)[0]

    assert shown["request"]["sport"] == "Теннис" and shown["request"]["city"] == "Москва" and shown["request"]["level"] == "amateur"
    text = str(shown)
    for secret in ("999", "ivan", "t.me", "a@b.ru", "athlete@example.com", "Анна", athlete.user_id):
        assert secret not in text, secret
    assert svc.HIDDEN in shown["request"]["comment"] and svc.HIDDEN in shown["request"]["schedule_note"] and svc.HIDDEN in shown["admin_message"]


def test_a_trainer_sees_only_their_own_offers(world, athlete) -> None:
    first = make_coach(world, "one@example.com")
    second = make_coach(world, "two@example.com", title="Второй")
    request = new_request(athlete)
    offer(world, request["id"], first)

    assert len(first.ok("GET", INCOMING)) == 1
    assert second.ok("GET", INCOMING) == []
    own = offer_id(world, request["id"], first)
    assert second.call("POST", f"/api/match-offers/{own}/accept").status_code == 404
    assert second.call("POST", f"/api/match-offers/{own}/decline", json={}).status_code == 404


@pytest.mark.parametrize(
    "text, expected",
    [
        ("+7 (999) 123-45-67", svc.HIDDEN), ("8 999 123 45 67", svc.HIDDEN), ("почта a.b@c-d.ru тут", f"почта {svc.HIDDEN} тут"),
        ("@ivan_tennis", svc.HIDDEN), ("https://vk.com/ivan", svc.HIDDEN), ("t.me/ivan", svc.HIDDEN),
        ("играю 3 раза в неделю, с 2015 года", "играю 3 раза в неделю, с 2015 года"), ("бюджет 3000-5000", "бюджет 3000-5000"),
    ],
)
def test_contacts_are_masked_in_free_text(text, expected) -> None:
    assert svc.mask_contacts(text) == expected


def test_the_percent_is_shown_without_noise() -> None:
    assert svc.format_percent(50) == "50" and svc.format_percent(12.5) == "12,5" and svc.format_percent("50.00") == "50"


# --- the trainer answers ---------------------------------------------------------------------------------------------


def test_the_trainer_accepts_and_the_athlete_is_told(world, athlete) -> None:
    coach = make_coach(world)
    request = new_request(athlete)
    offer(world, request["id"], coach)

    answered = coach.ok("POST", f"/api/match-offers/{offer_id(world, request['id'], coach)}/accept")

    assert answered["status"] == "coach_accepted"
    told = sql(world.dsn, "SELECT category, entity_type, entity_id::text FROM notifications WHERE user_id = $1::uuid", athlete.user_id)
    assert [(n["category"], n["entity_type"], n["entity_id"]) for n in told] == [("match_offer_reply", "match_request", request["id"])]
    admin_view = world.admin.ok("GET", f"{QUEUE}/{request['id']}")["offers"][0]
    assert admin_view["status"] == "coach_accepted" and admin_view["coach_responded_at"] and admin_view["athlete_expires_at"]


def test_the_trainer_declines_with_a_reason_the_administrators_see(world, athlete) -> None:
    coach = make_coach(world)
    request = new_request(athlete)
    offer(world, request["id"], coach)

    declined = coach.ok("POST", f"/api/match-offers/{offer_id(world, request['id'], coach)}/decline", json={"reason": "  Нет   времени "})

    assert declined["status"] == "coach_declined"
    assert world.admin.ok("GET", f"{QUEUE}/{request['id']}")["offers"][0]["coach_decline_reason"] == "Нет времени"
    assert sql(world.dsn, "SELECT 1 FROM notifications WHERE user_id = $1::uuid", athlete.user_id) == []
    assert athlete.ok("GET", f"{MINE}/mine")[0]["offers"] == []


def test_an_answer_is_given_once(world, athlete) -> None:
    coach = make_coach(world)
    request = new_request(athlete)
    offer(world, request["id"], coach)
    path = f"/api/match-offers/{offer_id(world, request['id'], coach)}"
    coach.ok("POST", f"{path}/accept")

    for action, body in (("accept", None), ("decline", {})):
        response = coach.call("POST", f"{path}/{action}", json=body)
        assert response.status_code == 409 and error_code(response) == "offer_closed"


def test_the_first_trainer_to_accept_wins_and_the_other_offers_close(world, athlete) -> None:
    first = make_coach(world, "one@example.com")
    second = make_coach(world, "two@example.com", title="Второй")
    request = new_request(athlete)
    offer(world, request["id"], first)
    offer(world, request["id"], second)

    second.ok("POST", f"/api/match-offers/{offer_id(world, request['id'], second)}/accept")
    late = first.call("POST", f"/api/match-offers/{offer_id(world, request['id'], first)}/accept")

    assert late.status_code == 409 and error_code(late) == "offer_closed"
    statuses = {o["coach"]["id"]: o["status"] for o in world.admin.ok("GET", f"{QUEUE}/{request['id']}")["offers"]}
    assert statuses == {first.user_id: "withdrawn", second.user_id: "coach_accepted"}
    assert first.ok("GET", INCOMING)[0]["status"] == "withdrawn"


def test_an_offer_nobody_answered_expires(world, athlete) -> None:
    coach = make_coach(world)
    request = new_request(athlete)
    offer(world, request["id"], coach)
    sql(world.dsn, "UPDATE coach_match_offers SET expires_at = now() - interval '1 minute'")

    assert coach.ok("GET", INCOMING)[0]["status"] == "expired"
    assert world.admin.ok("GET", f"{QUEUE}/{request['id']}")["offers"][0]["status"] == "expired"
    late = coach.call("POST", f"/api/match-offers/{offer_id(world, request['id'], coach)}/accept")
    assert late.status_code == 409 and error_code(late) == "offer_closed"
    # An expired offer no longer counts against the limit of offers waiting for an answer.
    assert world.admin.ok("GET", f"{QUEUE}/{request['id']}/candidates")[0]["already_offered"] is True


def test_a_trainer_who_switched_the_matching_off_cannot_accept(world, athlete) -> None:
    coach = make_coach(world)
    request = new_request(athlete)
    offer(world, request["id"], coach)
    coach.ok("PUT", SETTINGS, json={"enabled": False})

    refused = coach.call("POST", f"/api/match-offers/{offer_id(world, request['id'], coach)}/accept")
    assert refused.status_code == 409 and error_code(refused) == "not_available"
    # ...but may still say no.
    assert coach.ok("POST", f"/api/match-offers/{offer_id(world, request['id'], coach)}/decline", json={})["status"] == "coach_declined"


def test_a_block_made_after_the_offer_stops_the_acceptance(world, athlete) -> None:
    coach = make_coach(world)
    request = new_request(athlete)
    offer(world, request["id"], coach)
    sql(world.dsn, "INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1::uuid, $2::uuid)", coach.user_id, athlete.user_id)

    refused = coach.call("POST", f"/api/match-offers/{offer_id(world, request['id'], coach)}/accept")
    assert refused.status_code == 409 and error_code(refused) == "not_available"


# --- the athlete answers ---------------------------------------------------------------------------------------------


def test_the_athlete_sees_only_trainers_who_agreed_with_their_cards(world, athlete) -> None:
    agreed = make_coach(world, "yes@example.com", title="Согласный")
    waiting = make_coach(world, "wait@example.com", title="Ждёт")
    request = new_request(athlete)
    offer(world, request["id"], agreed)
    offer(world, request["id"], waiting)
    assert athlete.ok("GET", f"{MINE}/mine")[0]["offers"] == []

    agreed.ok("POST", f"/api/match-offers/{offer_id(world, request['id'], agreed)}/accept")
    shown = athlete.ok("GET", f"{MINE}/mine")[0]["offers"]

    assert len(shown) == 1 and shown[0]["status"] == "coach_accepted" and shown[0]["expires_at"]
    assert shown[0]["coach"]["user_id"] == agreed.user_id and shown[0]["coach"]["is_pro"] is False
    assert [card["title"] for card in shown[0]["listings"]] == ["Согласный"]
    text = str(shown)
    assert "@example.com" not in text and "first_session_percent" not in text


def test_the_athlete_chooses_the_trainer(world, athlete) -> None:
    coach = make_coach(world)
    request = new_request(athlete)
    offer(world, request["id"], coach)
    coach.ok("POST", f"/api/match-offers/{offer_id(world, request['id'], coach)}/accept")
    chosen = athlete.ok("GET", f"{MINE}/mine")[0]["offers"][0]["id"]

    after = athlete.ok("POST", f"{MINE}/offers/{chosen}/accept")

    assert after["status"] == "matched" and after["offers"][0]["status"] == "athlete_accepted" and after["offers"][0]["expires_at"] is None
    assert world.admin.ok("GET", f"{QUEUE}/{request['id']}")["status"] == "matched"
    assert athlete.call("POST", f"{MINE}/offers/{chosen}/accept").status_code == 409
    # A matched request is no longer "open": the athlete may ask again, and the queue does not offer it to anyone else.
    refused = world.admin.call("POST", f"{QUEUE}/{request['id']}/offers", json={"coach_user_id": coach.user_id})
    assert refused.status_code == 409


def test_the_athlete_declines_and_the_request_stays_with_the_administrators(world, athlete) -> None:
    coach = make_coach(world)
    request = new_request(athlete)
    offer(world, request["id"], coach)
    coach.ok("POST", f"/api/match-offers/{offer_id(world, request['id'], coach)}/accept")
    chosen = athlete.ok("GET", f"{MINE}/mine")[0]["offers"][0]["id"]

    after = athlete.ok("POST", f"{MINE}/offers/{chosen}/decline")

    assert after["status"] == "in_progress" and after["offers"] == []
    assert world.admin.ok("GET", f"{QUEUE}/{request['id']}")["offers"][0]["status"] == "athlete_declined"


def test_only_the_author_answers_and_only_while_the_time_lasts(world, athlete) -> None:
    other = Browser(world.client, "other@example.com", "Борис")
    coach = make_coach(world)
    request = new_request(athlete)
    offer(world, request["id"], coach)
    oid = offer_id(world, request["id"], coach)
    early = athlete.call("POST", f"{MINE}/offers/{oid}/accept")
    assert early.status_code == 409 and error_code(early) == "offer_closed"  # the trainer has not agreed yet

    coach.ok("POST", f"/api/match-offers/{oid}/accept")
    assert other.call("POST", f"{MINE}/offers/{oid}/accept").status_code == 404
    assert coach.call("POST", f"{MINE}/offers/{oid}/accept").status_code == 404
    sql(world.dsn, "UPDATE coach_match_offers SET athlete_expires_at = now() - interval '1 minute'")
    assert athlete.ok("GET", f"{MINE}/mine")[0]["offers"] == []
    late = athlete.call("POST", f"{MINE}/offers/{oid}/accept")
    assert late.status_code == 409 and error_code(late) == "offer_closed"


# --- ending a request, taking an offer back, deleting accounts --------------------------------------------------------


def test_withdrawing_an_offer_closes_it_and_is_audited(world, athlete) -> None:
    coach = make_coach(world)
    request = new_request(athlete)
    offer(world, request["id"], coach)
    oid = offer_id(world, request["id"], coach)

    detail = world.admin.ok("POST", f"{QUEUE}/offers/{oid}/withdraw")

    assert detail["offers"][0]["status"] == "withdrawn"
    assert coach.ok("GET", INCOMING)[0]["status"] == "withdrawn"
    again = world.admin.call("POST", f"{QUEUE}/offers/{oid}/withdraw")
    assert again.status_code == 409 and error_code(again) == "offer_closed"
    assert world.admin.call("POST", f"{QUEUE}/offers/00000000-0000-0000-0000-000000000000/withdraw").status_code == 404
    assert coach.call("POST", f"{QUEUE}/offers/{oid}/withdraw").status_code in (401, 403)
    assert len(sql(world.dsn, "SELECT 1 FROM admin_audit_log WHERE action = 'match_offer_withdraw'")) == 1


def test_withdrawing_or_closing_the_request_takes_back_waiting_offers(world, athlete) -> None:
    coach = make_coach(world)
    first = new_request(athlete)
    second = new_request(athlete, sport="Бокс")
    offer(world, first["id"], coach)
    sql(world.dsn, "UPDATE coach_profiles SET sport = 'Бокс'")
    offer(world, second["id"], coach)

    athlete.ok("POST", f"{MINE}/{first['id']}/cancel")
    world.admin.ok("POST", f"{QUEUE}/{second['id']}/close", json={"note": "не нужно"})

    assert {o["status"] for o in coach.ok("GET", INCOMING)} == {"withdrawn"}


def test_a_matched_request_can_be_closed_by_an_administrator_but_not_withdrawn_by_the_athlete(world, athlete) -> None:
    coach = make_coach(world)
    request = new_request(athlete)
    offer(world, request["id"], coach)
    coach.ok("POST", f"/api/match-offers/{offer_id(world, request['id'], coach)}/accept")
    athlete.ok("POST", f"{MINE}/offers/{athlete.ok('GET', f'{MINE}/mine')[0]['offers'][0]['id']}/accept")

    assert athlete.call("POST", f"{MINE}/{request['id']}/cancel").status_code == 409
    closed = world.admin.ok("POST", f"{QUEUE}/{request['id']}/close", json={"note": "занимаются"})
    assert closed["status"] == "closed" and closed["offers"][0]["status"] == "athlete_accepted"


def test_deleting_the_athlete_removes_their_requests_and_offers(world, athlete) -> None:
    coach = make_coach(world)
    request = new_request(athlete)
    offer(world, request["id"], coach)

    async def erase() -> None:
        conn = await asyncpg.connect(world.dsn)
        try:
            await users_repo.anonymize(conn, UUID(athlete.user_id))
        finally:
            await conn.close()

    asyncio.run(erase())

    assert sql_value(world.dsn, "SELECT count(*) FROM coach_match_offers") == 0
    assert coach.ok("GET", INCOMING) == []
