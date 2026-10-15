"""Trainings (read-only) and coach listings (hide / restore / delete with the platform's own booking rules)."""
from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi.routing import APIRoute

from tests.admin_world import ADMIN_EMAIL, Browser, add_user, live_client, pg, publish_listing, sql, sql_value, world  # noqa: F401

_MONDAY = date.today() + timedelta(days=(7 - date.today().weekday()) % 7 or 7)


def _trainings(world, **params) -> dict:
    return world.admin.ok("GET", "/api/admin/trainings", params=params)


def _listings(world, **params) -> dict:
    return world.admin.ok("GET", "/api/admin/listings", params=params)


def _training(dsn: str, creator: str, *, kind="personal", status="scheduled", days=1, description=None, team=None, location=None) -> str:
    return str(
        sql_value(
            dsn,
            """
            INSERT INTO trainings (created_by, team_id, type, training_date, start_time, duration_minutes, status, description, location)
            VALUES ($1::uuid, $2::uuid, $3, CURRENT_DATE + $4::int, '10:00', 60, $5, $6, $7) RETURNING id
            """,
            creator, team, kind, days, status, description, location,
        )
    )


def _team(dsn: str, owner: str, name: str = "Ястребы", members: int = 0) -> str:
    team = str(sql_value(dsn, "INSERT INTO teams (name, sport, created_by) VALUES ($1, 'Футбол', $2::uuid) RETURNING id", name, owner))
    sql(dsn, "INSERT INTO team_members (team_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'head_coach')", team, owner)
    for i in range(members):
        member = add_user(dsn, f"member{i}-{owner[:8]}@example.com")
        sql(dsn, "INSERT INTO team_members (team_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'player')", team, member)
    return team


def _audit(world) -> list[dict]:
    return world.admin.ok("GET", "/api/admin/audit", params={"limit": 200})


# --- trainings ----------------------------------------------------------------------------------------------------


def test_trainings_are_listed_with_team_creator_status_and_participants(world) -> None:
    coach = add_user(world.dsn, "coach@example.com")
    team = _team(world.dsn, coach, members=3)
    group = _training(world.dsn, coach, kind="team", team=team, description="Отработка ударов", days=2)
    solo = _training(world.dsn, coach, kind="personal", description="Пробежка", days=-3, status="completed")

    page = _trainings(world)
    by_id = {t["id"]: t for t in page["items"]}

    assert page["total"] == 2
    assert by_id[group]["team"]["name"] == "Ястребы" and by_id[group]["participants"] == 4  # three players + the head coach
    assert by_id[group]["creator"]["email"] == "coach@example.com" and by_id[group]["status"] == "scheduled"
    assert by_id[solo]["participants"] == 1 and by_id[solo]["team"] is None and by_id[solo]["status"] == "completed"
    assert page["items"][0]["id"] == group  # newest date first


def test_attendance_records_count_when_they_exceed_the_roster(world) -> None:
    coach = add_user(world.dsn, "coach@example.com")
    team = _team(world.dsn, coach, members=0)
    training = _training(world.dsn, coach, kind="team", team=team)
    for i in range(3):
        guest = add_user(world.dsn, f"guest{i}@example.com")
        sql(world.dsn, "INSERT INTO training_attendance (training_id, user_id, status) VALUES ($1::uuid, $2::uuid, 'present')", training, guest)

    assert next(t for t in _trainings(world)["items"] if t["id"] == training)["participants"] == 3


def test_training_filters_and_search(world) -> None:
    coach = add_user(world.dsn, "coach@example.com")
    team = _team(world.dsn, coach, name="Соколы")
    a = _training(world.dsn, coach, kind="team", team=team, description="Силовая", days=3, location="Стадион")
    b = _training(world.dsn, coach, kind="personal", status="cancelled", description="Йога", days=-2)
    c = _training(world.dsn, coach, kind="independent", team=team, status="completed", description="Кросс", days=-5)

    ids = lambda **p: {t["id"] for t in _trainings(world, **p)["items"]}  # noqa: E731

    assert ids(status="cancelled") == {b} and ids(status="completed") == {c} and ids(type="team") == {a}
    assert ids(when="upcoming") == {a} and ids(when="past") == {b, c}
    assert ids(q="силов") == {a} and ids(q="Соколы") == {a, c} and ids(q="coach@example.com") == {a, b, c} and ids(q="стадион") == {a}
    assert ids(q=a) == {a} and ids(q=coach) == {a, b, c} and ids(q=team) == {a, c}
    assert ids(q="'; DROP TABLE trainings;--") == set() and sql_value(world.dsn, "SELECT count(*) FROM trainings") == 3
    assert [t["id"] for t in _trainings(world, sort="date_asc")["items"]] == [c, b, a]
    assert len(_trainings(world, limit=2)["items"]) == 2 and len(_trainings(world, limit=2, offset=2)["items"]) == 1


@pytest.mark.parametrize("params", [{"status": "deleted"}, {"type": "x"}, {"when": "never"}, {"sort": "price"}, {"limit": 101}, {"offset": -5}])
def test_training_list_parameters_are_validated(world, params) -> None:
    assert world.admin.call("GET", "/api/admin/trainings", params=params).status_code == 422


def test_deleted_trainings_are_not_listed(world) -> None:
    coach = add_user(world.dsn, "coach@example.com")
    gone = _training(world.dsn, coach)
    sql(world.dsn, "UPDATE trainings SET deleted_at = now() WHERE id = $1::uuid", gone)

    assert _trainings(world)["total"] == 0
    assert world.admin.call("GET", f"/api/admin/trainings/{gone}").status_code == 404


def test_the_training_detail_shows_people_and_bookings(world) -> None:
    coach = Browser(world.client, "coach@example.com", "Тренер", "coach")
    listing = publish_listing(coach)
    player = Browser(world.client, "player@example.com", "Игрок", "player")
    player.ok("PUT", "/api/profile/player", json={"full_name": "Игорь", "sport": "Теннис", "age": 20, "height_cm": None, "weight_kg": None,
                                                  "position": None, "level": "amateur", "goals": None, "load_restrictions": None})
    slots = player.ok("GET", f"/api/coach-listings/{listing['id']}/slots", params={"from_date": _MONDAY.isoformat(), "to_date": _MONDAY.isoformat()})
    booking = player.ok("POST", "/api/bookings", json={"listing_id": listing["id"], "starts_at": slots[0]["starts_at"], "format": "online"})
    coach.ok("POST", f"/api/bookings/{booking['id']}/confirm")
    training_id = sql_value(world.dsn, "SELECT training_id FROM bookings WHERE id = $1::uuid", booking["id"])

    detail = world.admin.ok("GET", f"/api/admin/trainings/{training_id}")

    assert detail["type"] == "personal" and detail["bookings"] == 1 and detail["participants"] == 2
    assert [b["status"] for b in detail["booking_list"]] == ["confirmed"]
    assert detail["booking_list"][0]["athlete"] == "Игрок" and detail["booking_list"][0]["coach"] == "Тренер"


def test_there_is_no_way_to_change_a_training_from_the_admin_api(world) -> None:
    routes = [r for r in world.client.app.routes if isinstance(r, APIRoute) and r.path.startswith("/api/admin/trainings")]

    assert routes and all(r.methods == {"GET"} for r in routes)


# --- listings: hide / restore --------------------------------------------------------------------------------------


def _public_ids(client_browser: Browser) -> list[str]:
    return [c["id"] for c in client_browser.ok("GET", "/api/coach-listings")]


def test_listings_are_listed_with_their_state(world) -> None:
    coach = Browser(world.client, "coach@example.com", "Тренер", "coach")
    public = publish_listing(coach, "Открытое")
    hidden = coach.ok("POST", "/api/coach-listings", json={"title": "Скрытое", "description": None, "is_listed": False, "price_per_session": 1000,
                                                           "currency": "RUB", "offers_online": True, "offers_offline": False, "location": None, "session_duration_minutes": 60})

    assert {l["id"]: l["state"] for l in _listings(world)["items"]} == {public["id"]: "public", hidden["id"]: "unlisted"}
    assert [l["id"] for l in _listings(world, state="public")["items"]] == [public["id"]]
    assert [l["id"] for l in _listings(world, q="Скрытое")["items"]] == [hidden["id"]]
    assert [l["id"] for l in _listings(world, q="coach@example.com", state="unlisted")["items"]] == [hidden["id"]]
    assert world.admin.call("GET", "/api/admin/listings", params={"state": "weird"}).status_code == 422


def test_a_hidden_listing_leaves_every_public_place_but_keeps_existing_bookings(world) -> None:
    coach = Browser(world.client, "coach@example.com", "Тренер", "coach")
    listing = publish_listing(coach)
    player = Browser(world.client, "player@example.com", "Игрок", "player")
    player.ok("PUT", "/api/profile/player", json={"full_name": "Игорь", "sport": "Теннис", "age": 20, "height_cm": None, "weight_kg": None,
                                                  "position": None, "level": "amateur", "goals": None, "load_restrictions": None})
    slots = player.ok("GET", f"/api/coach-listings/{listing['id']}/slots", params={"from_date": _MONDAY.isoformat(), "to_date": _MONDAY.isoformat()})
    booking = player.ok("POST", "/api/bookings", json={"listing_id": listing["id"], "starts_at": slots[0]["starts_at"], "format": "online"})
    assert _public_ids(player) == [listing["id"]]

    hidden = world.admin.call("POST", f"/api/admin/listings/{listing['id']}/hide", json={"reason": "Подозрение на мошенничество"})

    assert hidden.status_code == 200 and hidden.json()["state"] == "hidden" and hidden.json()["hidden_by"] == ADMIN_EMAIL
    assert _public_ids(player) == []
    assert player.call("GET", f"/api/coach-listings/{listing['id']}").status_code == 404
    assert player.call("GET", f"/api/coach-listings/{listing['id']}/slots", params={"from_date": _MONDAY.isoformat(), "to_date": _MONDAY.isoformat()}).status_code == 404
    fresh = Browser(world.client, "second@example.com", "Второй", "player")
    assert fresh.call("POST", "/api/bookings", json={"listing_id": listing["id"], "starts_at": slots[0]["starts_at"], "format": "online"}).status_code == 404
    assert player.ok("GET", "/api/bookings/me")[0]["id"] == booking["id"]  # what was already requested is not destroyed
    assert player.ok("GET", "/api/search", params={"q": "Теннис"}) is not None
    assert all(r["id"] != listing["id"] for r in player.ok("GET", "/api/search", params={"q": "Теннис"}))

    own = coach.ok("GET", "/api/coach-listings/me")[0]
    assert own["hidden_by_moderation"] is True and own["moderation_reason"] == "Подозрение на мошенничество"
    republish = coach.call("PUT", f"/api/coach-listings/{listing['id']}", json={
        "title": listing["title"], "description": None, "is_listed": True, "price_per_session": 2500, "currency": "RUB",
        "offers_online": True, "offers_offline": True, "location": "Москва", "session_duration_minutes": 60})
    assert republish.status_code == 200 and _public_ids(player) == []  # the coach cannot undo a moderator's decision

    restored = world.admin.call("POST", f"/api/admin/listings/{listing['id']}/restore", json={"reason": "Проверили, всё честно"})
    assert restored.status_code == 200 and restored.json()["state"] == "public"
    assert _public_ids(player) == [listing["id"]]
    assert coach.ok("GET", "/api/coach-listings/me")[0]["hidden_by_moderation"] is False


def test_hiding_twice_or_restoring_a_visible_listing_is_refused(world) -> None:
    listing = publish_listing(Browser(world.client, "coach@example.com", "Тренер", "coach"))

    assert world.admin.call("POST", f"/api/admin/listings/{listing['id']}/restore", json={"reason": "просто так"}).status_code == 409
    assert world.admin.call("POST", f"/api/admin/listings/{listing['id']}/hide", json={"reason": "нарушение"}).status_code == 200
    again = world.admin.call("POST", f"/api/admin/listings/{listing['id']}/hide", json={"reason": "нарушение"})

    assert again.status_code == 409 and again.json()["error"]["code"] == "already_hidden"
    assert [e["action"] for e in _audit(world) if e["target_id"] == listing["id"]] == ["listing_hide"]


def test_a_blocked_coachs_listings_leave_the_catalogue_and_return_with_the_unblock(world) -> None:
    coach = Browser(world.client, "coach@example.com", "Тренер", "coach")
    listing = publish_listing(coach)
    visitor = Browser(world.client, "visitor@example.com", "Гость")
    assert _public_ids(visitor) == [listing["id"]]

    world.admin.call("POST", f"/api/admin/users/{coach.user_id}/ban", json={"reason": "Нарушение правил площадки", "days": 7})
    assert _public_ids(visitor) == []
    assert visitor.call("GET", f"/api/coach-listings/{listing['id']}").status_code == 404

    world.admin.call("POST", f"/api/admin/users/{coach.user_id}/unban", json={"reason": "Срок вышел досрочно"})
    assert _public_ids(visitor) == [listing["id"]]


def test_hiding_a_listing_is_audited_with_before_and_after(world) -> None:
    listing = publish_listing(Browser(world.client, "coach@example.com", "Тренер", "coach"))
    world.admin.call("POST", f"/api/admin/listings/{listing['id']}/hide", json={"reason": "Ложная информация о квалификации"})

    entry = next(e for e in _audit(world) if e["target_id"] == listing["id"])

    assert entry["action"] == "listing_hide" and entry["reason"] == "Ложная информация о квалификации" and entry["admin"] == ADMIN_EMAIL
    assert entry["details"]["before"]["state"] == "public" and entry["details"]["after"]["state"] == "hidden"


# --- listings: delete -------------------------------------------------------------------------------------------------


def _delete_listing(world, listing_id: str, confirm: bool = True):
    return world.admin.call("POST", f"/api/admin/listings/{listing_id}/delete", json={"reason": "Нарушение правил", "confirm": confirm})


def test_a_listing_with_a_pending_or_upcoming_booking_cannot_be_deleted(world) -> None:
    coach = Browser(world.client, "coach@example.com", "Тренер", "coach")
    listing = publish_listing(coach)
    player = Browser(world.client, "player@example.com", "Игрок", "player")
    player.ok("PUT", "/api/profile/player", json={"full_name": "Игорь", "sport": "Теннис", "age": 20, "height_cm": None, "weight_kg": None,
                                                  "position": None, "level": "amateur", "goals": None, "load_restrictions": None})
    slots = player.ok("GET", f"/api/coach-listings/{listing['id']}/slots", params={"from_date": _MONDAY.isoformat(), "to_date": _MONDAY.isoformat()})
    player.ok("POST", "/api/bookings", json={"listing_id": listing["id"], "starts_at": slots[0]["starts_at"], "format": "online"})

    refused = _delete_listing(world, listing["id"])

    assert refused.status_code == 409 and refused.json()["error"]["code"] == "has_active_bookings"
    assert sql_value(world.dsn, "SELECT deleted_at IS NULL FROM coach_listings WHERE id = $1::uuid", listing["id"]) is True
    assert sql_value(world.dsn, "SELECT count(*) FROM bookings WHERE listing_id = $1::uuid AND status = 'pending'", listing["id"]) == 1
    assert [e["result"] for e in _audit(world) if e["action"] == "listing_delete"] == ["denied"]


def test_a_listing_nobody_booked_can_be_deleted_once_and_stays_deleted(world) -> None:
    coach = Browser(world.client, "coach@example.com", "Тренер", "coach")
    listing = publish_listing(coach)
    visitor = Browser(world.client, "visitor@example.com", "Гость")

    deleted = _delete_listing(world, listing["id"])

    assert deleted.status_code == 200 and deleted.json()["state"] == "deleted"
    assert _public_ids(visitor) == [] and coach.ok("GET", "/api/coach-listings/me") == []
    assert _delete_listing(world, listing["id"]).status_code == 404
    assert world.admin.call("POST", f"/api/admin/listings/{listing['id']}/hide", json={"reason": "нарушение"}).status_code == 404
    assert [e["action"] for e in _audit(world) if e["target_id"] == listing["id"]] == ["listing_delete"]


def test_deleting_a_listing_needs_confirmation_a_reason_and_a_recent_code(world) -> None:
    listing = publish_listing(Browser(world.client, "coach@example.com", "Тренер", "coach"))

    assert world.admin.call("POST", f"/api/admin/listings/{listing['id']}/delete", json={"reason": "Нарушение правил"}).status_code == 422
    assert _delete_listing(world, listing["id"], confirm=False).status_code == 422
    sql(world.dsn, "UPDATE user_sessions SET mfa_verified_at = now() - interval '30 minutes' WHERE user_id = $1::uuid", world.admin.user_id)

    stale = _delete_listing(world, listing["id"])

    assert stale.status_code == 403 and stale.json()["error"]["code"] == "mfa_recent_required"
    assert sql_value(world.dsn, "SELECT deleted_at IS NULL FROM coach_listings WHERE id = $1::uuid", listing["id"]) is True
    world.admin.unlock()
    assert _delete_listing(world, listing["id"]).status_code == 200


def test_only_an_unlocked_administrator_reaches_trainings_and_listings(world) -> None:
    coach = Browser(world.client, "coach@example.com", "Тренер", "coach")
    listing = publish_listing(coach)
    training = _training(world.dsn, coach.user_id)
    calls = [
        ("GET", "/api/admin/trainings", None), ("GET", f"/api/admin/trainings/{training}", None),
        ("GET", "/api/admin/listings", None), ("GET", f"/api/admin/listings/{listing['id']}", None),
        ("POST", f"/api/admin/listings/{listing['id']}/hide", {"reason": "нарушение правил"}),
        ("POST", f"/api/admin/listings/{listing['id']}/restore", {"reason": "ошибка модератора"}),
        ("POST", f"/api/admin/listings/{listing['id']}/delete", {"reason": "нарушение правил", "confirm": True}),
    ]
    for method, path, body in calls:
        world.client.cookies.clear()
        assert world.client.request(method, path, json=body).status_code == 401, ("guest", path)
        assert coach.call(method, path, json=body).status_code == 403, ("the listing's own coach", path)
        locked = world.admin.fresh_session().call(method, path, json=body)
        assert locked.status_code == 403 and locked.json()["error"]["code"] == "mfa_required", ("no second factor", path)
    assert sql_value(world.dsn, "SELECT moderation_hidden_at IS NULL AND deleted_at IS NULL FROM coach_listings WHERE id = $1::uuid", listing["id"]) is True
