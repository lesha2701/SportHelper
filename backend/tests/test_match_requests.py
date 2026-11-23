"""«Подобрать тренера»: an athlete fills the form (only the sport is required), the administrators see everything and work the queue -
real PostgreSQL, real sessions."""
from __future__ import annotations

import asyncio
from uuid import UUID

import asyncpg
import pytest

from app.repositories import users as users_repo

from tests.admin_world import Browser, live_client, pg, sql, world  # noqa: F401

MINE = "/api/match-requests"
QUEUE = "/api/admin/match-requests"

FULL = {
    "sport": "Теннис", "goal": "Поставить удар справа", "level": "amateur", "format": "offline", "city": "Москва",
    "budget_min": 1500, "budget_max": 3000, "currency": "RUB", "weekdays": [5, 1, 1], "day_parts": ["evening", "morning"],
    "schedule_note": "по будням после 19:00", "comment": "Занимался в детстве",
}


@pytest.fixture
def athlete(world) -> Browser:
    return Browser(world.client, "athlete@example.com", "Анна")


def test_only_the_sport_is_required(athlete) -> None:
    response = athlete.call("POST", MINE, json={"sport": "  Плавание "})

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["sport"] == "Плавание" and body["status"] == "new"
    assert body["goal"] is None and body["weekdays"] == [] and body["day_parts"] == [] and body["budget_min"] is None


def test_everything_the_person_fills_is_kept_tidy(world, athlete) -> None:
    athlete.ok("POST", MINE, json=FULL)

    row = sql(world.dsn, "SELECT * FROM coach_match_requests")[0]
    assert row["weekdays"] == [1, 5] and row["day_parts"] == ["morning", "evening"]
    assert row["user_id"] == athlete.user_id or str(row["user_id"]) == athlete.user_id
    assert row["city"] == "Москва" and row["level"] == "amateur" and row["currency"] == "RUB"


@pytest.mark.parametrize(
    "extra",
    [
        {"sport": ""}, {"sport": "я"}, {"sport": "x" * 101},
        {"level": "god"}, {"format": "mail"}, {"weekdays": [7]}, {"weekdays": [-1]}, {"day_parts": ["night"]},
        {"budget_min": 5000, "budget_max": 1000}, {"budget_min": -1}, {"currency": "RU"},
        {"goal": "я" * 1001}, {"comment": "я" * 1501}, {"schedule_note": "я" * 501}, {"city": "я" * 101},
        {"status": "closed"}, {"user_id": "00000000-0000-0000-0000-000000000000"},
    ],
)
def test_a_bad_or_forged_form_is_refused(athlete, extra) -> None:
    assert athlete.call("POST", MINE, json={"sport": "Теннис", **extra}).status_code == 422


def test_there_is_no_age_in_the_form(athlete) -> None:
    assert athlete.call("POST", MINE, json={"sport": "Теннис", "age": 12}).status_code == 422


def test_a_guest_cannot_send_a_request(world) -> None:
    world.client.cookies.clear()
    assert world.client.post(MINE, json={"sport": "Теннис"}).status_code == 401


def test_a_person_has_a_few_open_requests_at_most(athlete) -> None:
    for _ in range(3):
        assert athlete.call("POST", MINE, json={"sport": "Теннис"}).status_code == 201
    refused = athlete.call("POST", MINE, json={"sport": "Теннис"})
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "too_many_open"


def test_the_author_sees_only_their_own_requests(world, athlete) -> None:
    other = Browser(world.client, "other@example.com", "Борис")
    athlete.ok("POST", MINE, json={"sport": "Теннис"})
    other.ok("POST", MINE, json={"sport": "Бокс"})

    assert [r["sport"] for r in athlete.ok("GET", f"{MINE}/mine")] == ["Теннис"]
    assert [r["sport"] for r in other.ok("GET", f"{MINE}/mine")] == ["Бокс"]


def test_the_author_can_withdraw_an_open_request_but_not_another_persons(world, athlete) -> None:
    other = Browser(world.client, "other@example.com", "Борис")
    mine = athlete.ok("POST", MINE, json={"sport": "Теннис"})

    assert other.call("POST", f"{MINE}/{mine['id']}/cancel").status_code == 404
    assert athlete.ok("POST", f"{MINE}/{mine['id']}/cancel")["status"] == "canceled"
    again = athlete.call("POST", f"{MINE}/{mine['id']}/cancel")
    assert again.status_code == 409 and again.json()["error"]["code"] == "bad_transition"


def test_a_withdrawn_request_frees_a_place(athlete) -> None:
    ids = [athlete.ok("POST", MINE, json={"sport": "Теннис"})["id"] for _ in range(3)]
    athlete.ok("POST", f"{MINE}/{ids[0]}/cancel")
    assert athlete.call("POST", MINE, json={"sport": "Теннис"}).status_code == 201


# --- the administrators ----------------------------------------------------------------------------------------------


def test_the_queue_shows_everything_the_person_filled_and_who_they_are(world, athlete) -> None:
    athlete.ok("POST", MINE, json=FULL)

    page = world.admin.ok("GET", QUEUE)
    item = page["items"][0]

    assert page["total"] == 1
    assert item["sport"] == "Теннис" and item["goal"] == "Поставить удар справа" and item["weekdays"] == [1, 5]
    assert item["day_parts"] == ["morning", "evening"] and float(item["budget_max"]) == 3000
    assert item["author"]["email"] == "athlete@example.com" and item["status"] == "new"


def test_the_queue_is_for_administrators_only(world, athlete) -> None:
    assert athlete.call("GET", QUEUE).status_code in (401, 403)
    assert athlete.call("POST", f"{QUEUE}/00000000-0000-0000-0000-000000000000/take").status_code in (401, 403)


def test_the_longest_waiting_open_request_is_on_top_and_closed_ones_go_last(world, athlete) -> None:
    first = athlete.ok("POST", MINE, json={"sport": "Первая"})
    second = athlete.ok("POST", MINE, json={"sport": "Вторая"})
    world.admin.ok("POST", f"{QUEUE}/{first['id']}/close", json={"note": "нет тренеров"})

    assert [i["sport"] for i in world.admin.ok("GET", QUEUE)["items"]] == ["Вторая", "Первая"]
    assert world.admin.ok("GET", QUEUE, params={"status": "closed"})["total"] == 1
    assert world.admin.ok("GET", QUEUE, params={"q": "Втор"})["items"][0]["id"] == second["id"]


def test_taking_and_closing_follow_the_statuses_and_are_audited(world, athlete) -> None:
    created = athlete.ok("POST", MINE, json={"sport": "Теннис"})
    path = f"{QUEUE}/{created['id']}"

    taken = world.admin.ok("POST", f"{path}/take")
    assert taken["status"] == "in_progress" and taken["handled_by"]
    assert world.admin.call("POST", f"{path}/take").json()["error"]["code"] == "bad_transition"

    closed = world.admin.ok("POST", f"{path}/close", json={"note": "  Предложили\n\n\n\nтренеру Иванову  "})
    assert closed["status"] == "closed" and closed["admin_note"] == "Предложили\n\nтренеру Иванову"
    assert world.admin.call("POST", f"{path}/close", json={}).json()["error"]["code"] == "bad_transition"
    assert athlete.call("POST", f"{MINE}/{created['id']}/cancel").status_code == 409

    actions = [e["action"] for e in world.admin.ok("GET", "/api/admin/audit", params={"limit": 50})["items"]]
    assert "match_request_take" in actions and "match_request_close" in actions


def test_the_author_sees_the_status_but_never_the_admin_note(world, athlete) -> None:
    created = athlete.ok("POST", MINE, json={"sport": "Теннис"})
    world.admin.ok("POST", f"{QUEUE}/{created['id']}/close", json={"note": "внутреннее"})

    mine = athlete.ok("GET", f"{MINE}/mine")[0]
    assert mine["status"] == "closed" and "admin_note" not in mine and "author" not in mine


def test_deleting_an_account_removes_the_requests_but_not_other_peoples(world, athlete) -> None:
    other = Browser(world.client, "other@example.com", "Борис")
    athlete.ok("POST", MINE, json={"sport": "Теннис", "goal": "личное"})
    other.ok("POST", MINE, json={"sport": "Бокс"})

    async def erase() -> None:
        conn = await asyncpg.connect(world.dsn)
        try:
            await users_repo.anonymize(conn, UUID(athlete.user_id))
        finally:
            await conn.close()

    asyncio.run(erase())

    assert [r["sport"] for r in sql(world.dsn, "SELECT sport FROM coach_match_requests")] == ["Бокс"]
