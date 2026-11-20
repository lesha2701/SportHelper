"""The Pro status of a trainer (database/patches/0054), against a real PostgreSQL: an administrator gives and takes it back in the user card,
every place where a player meets the trainer carries it, and only an administrator who may write can change it."""
from __future__ import annotations

from tests.admin_world import add_user, live_client, pg, publish_listing, world  # noqa: F401  (fixtures and helpers)
from tests.live_helpers import Browser, sql, sql_value
from tests.test_admin_users import _emails  # noqa: F401


def status(world, user_id: str, is_pro: bool, reason: str = "Проверенный тренер, договор подписан"):
    return world.admin.call("PUT", f"/api/admin/users/{user_id}/coach-status", json={"is_pro": is_pro, "reason": reason})


def trainer(world, email: str = "coach@example.com"):
    coach = Browser(world.client, email, "Тренер", "coach")
    listing = publish_listing(coach)
    return coach, listing


def test_a_trainer_is_an_ordinary_one_until_an_administrator_says_otherwise(world) -> None:
    coach, listing = trainer(world)
    assert coach.ok("GET", "/api/profile/me")["coach"]["is_pro"] is False
    card = world.admin.ok("GET", f"/api/admin/users/{coach.user_id}")
    assert card["is_coach"] is True and card["coach_is_pro"] is False
    player = Browser(world.client, "player@example.com", "Игрок", "player")
    assert player.ok("GET", f"/api/coach-listings/{listing['id']}")["coach_is_pro"] is False


def test_the_status_is_given_and_taken_back_with_a_reason_and_an_audit_trail(world) -> None:
    coach, _ = trainer(world)
    granted = status(world, coach.user_id, True)
    assert granted.status_code == 200 and granted.json()["coach_is_pro"] is True
    assert world.admin.ok("GET", f"/api/admin/users?role=coach")["items"][0]["coach_is_pro"] is True

    revoked = status(world, coach.user_id, False, "Договор расторгнут")
    assert revoked.json()["coach_is_pro"] is False
    actions = [r["action"] for r in sql(world.dsn, "SELECT action FROM admin_audit_log WHERE action LIKE 'coach.pro.%' ORDER BY created_at")]
    assert actions == ["coach.pro.grant", "coach.pro.revoke"]
    history = world.admin.ok("GET", f"/api/admin/users/{coach.user_id}")["history"]
    assert {h["action"] for h in history} >= {"coach.pro.grant", "coach.pro.revoke"} and history[0]["reason"] == "Договор расторгнут"


def test_every_place_a_player_meets_the_trainer_shows_the_status(world) -> None:
    coach, listing = trainer(world)
    status(world, coach.user_id, True)
    player = Browser(world.client, "player@example.com", "Игрок", "player")
    player.ok("PUT", "/api/profile/player", json={"full_name": "Игорь", "sport": "Теннис", "age": 20, "height_cm": None, "weight_kg": None,
                                                  "position": None, "level": "amateur", "goals": None, "load_restrictions": None})

    assert coach.ok("GET", "/api/profile/me")["coach"]["is_pro"] is True
    assert [c["coach_is_pro"] for c in player.ok("GET", "/api/coach-listings")] == [True]
    assert player.ok("GET", f"/api/coach-listings/{listing['id']}")["coach_is_pro"] is True
    assert player.ok("GET", f"/api/coaches/{coach.user_id}/profile")["is_pro"] is True
    assert [c["coach_is_pro"] for c in player.ok("GET", f"/api/coaches/{coach.user_id}/listings")] == [True]

    from tests.finance_helpers import MONDAY
    slots = player.ok("GET", f"/api/coach-listings/{listing['id']}/slots", params={"from_date": MONDAY.isoformat(), "to_date": MONDAY.isoformat()})
    booking = player.ok("POST", "/api/bookings", json={"listing_id": listing["id"], "starts_at": slots[0]["starts_at"], "format": "online"})
    assert booking["coach_is_pro"] is True
    assert [b["coach_is_pro"] for b in player.ok("GET", "/api/bookings/me")] == [True]

    status(world, coach.user_id, False)
    assert [c["coach_is_pro"] for c in player.ok("GET", "/api/coach-listings")] == [False]  # taken back: the mark goes at once


def test_the_same_status_twice_a_non_trainer_and_a_missing_user_are_refused(world) -> None:
    coach, _ = trainer(world)
    assert status(world, coach.user_id, False).json()["error"]["code"] == "coach_status_unchanged"
    status(world, coach.user_id, True)
    assert status(world, coach.user_id, True).json()["error"]["code"] == "coach_status_unchanged"
    plain = add_user(world.dsn, "plain@example.com")
    assert status(world, plain, True).status_code == 404
    assert status(world, "00000000-0000-4000-8000-000000000000", True).status_code == 404
    assert world.admin.ok("GET", f"/api/admin/users/{plain}")["coach_is_pro"] is None  # not a trainer: no status at all


def test_a_reason_is_required_and_nobody_but_an_administrator_can_set_it(world) -> None:
    coach, _ = trainer(world)
    url = f"/api/admin/users/{coach.user_id}/coach-status"
    for body in ({"is_pro": True, "reason": ""}, {"is_pro": True, "reason": "  "}, {"is_pro": True}, {"reason": "без статуса"}, {"is_pro": "maybe", "reason": "xxx"}):
        assert world.admin.call("PUT", url, json=body).status_code == 422, body
    assert coach.call("PUT", url, json={"is_pro": True, "reason": "сам себе"}).status_code == 403  # a trainer cannot promote himself
    assert sql_value(world.dsn, "SELECT is_pro FROM coach_profiles WHERE user_id = $1::uuid", coach.user_id) is False
