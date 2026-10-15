"""User complaints (the public side) and the administrators' queue - real PostgreSQL, real sessions."""
from __future__ import annotations

import pytest

from app.config import get_settings
from app.repositories import complaints as complaints_repo
from tests.admin_world import ADMIN_EMAIL, Browser, add_user, live_client, pg, publish_listing, sql, sql_value, upload, world  # noqa: F401
from tests.image_helpers import jpeg_bytes


class Scene:
    def __init__(self, world):
        self.world = world
        self.reporter = Browser(world.client, "reporter@example.com", "Жалобщик")
        self.coach = Browser(world.client, "coach@example.com", "Тренер", "coach")
        self.listing = publish_listing(self.coach, "Тренировки для всех")
        self.photo = upload(self.coach, f"/api/coach-listings/{self.listing['id']}/photo", jpeg_bytes((900, 700))).json()["photo_file_id"]
        self.other = Browser(world.client, "other@example.com", "Другой")


@pytest.fixture
def scene(world) -> Scene:
    return Scene(world)


def _report(who: Browser, target_type: str, target_id: str, reason: str = "spam", comment: str | None = None):
    body = {"target_type": target_type, "target_id": target_id, "reason": reason}
    if comment is not None:
        body["comment"] = comment
    return who.call("POST", "/api/complaints", json=body)


def _queue(world, **params) -> dict:
    return world.admin.ok("GET", "/api/admin/complaints", params=params)


def _audit(world) -> list[dict]:
    return world.admin.ok("GET", "/api/admin/audit", params={"limit": 200})["items"]


# --- filing a complaint --------------------------------------------------------------------------------------------


def test_a_user_can_report_a_profile_a_listing_and_a_public_photo(scene) -> None:
    for kind, target in [("user", scene.coach.user_id), ("listing", scene.listing["id"]), ("media", scene.photo)]:
        response = _report(scene.reporter, kind, target)

        assert response.status_code == 201, (kind, response.text)
        assert set(response.json()) == {"id", "status"} and response.json()["status"] == "new"


def test_the_complaint_remembers_whose_content_it_is_about(world, scene) -> None:
    _report(scene.reporter, "listing", scene.listing["id"], "fraud", "  Обещают  невозможное ")

    row = sql(world.dsn, "SELECT target_user_id::text AS owner, reason, comment, status FROM complaints")[0]

    assert row["owner"] == scene.coach.user_id and row["reason"] == "fraud" and row["comment"] == "Обещают невозможное" and row["status"] == "new"


@pytest.mark.parametrize(
    "body",
    [
        {"target_type": "team", "reason": "spam"},
        {"target_type": "user", "reason": "rudeness"},
        {"target_type": "user", "reason": "spam", "status": "resolved"},
        {"target_type": "user", "reason": "spam", "reporter_id": "00000000-0000-0000-0000-000000000000"},
        {"target_type": "user", "reason": "other"},
        {"target_type": "user", "reason": "other", "comment": "  "},
        {"target_type": "user", "reason": "other", "comment": "ab"},
        {"target_type": "user", "reason": "spam", "comment": "я" * 1001},
        {"target_type": "user", "reason": "spam", "target_id": "not-a-uuid"},
    ],
)
def test_the_complaint_form_is_validated_on_the_server(scene, body) -> None:
    body = {"target_id": scene.coach.user_id, **body}

    assert scene.reporter.call("POST", "/api/complaints", json=body).status_code == 422


def test_a_complaint_of_type_other_needs_words(scene) -> None:
    assert _report(scene.reporter, "user", scene.coach.user_id, "other", "Выдаёт себя за другого человека").status_code == 201


def test_you_cannot_report_yourself_or_your_own_things(scene) -> None:
    assert _report(scene.coach, "user", scene.coach.user_id).status_code == 400
    assert _report(scene.coach, "listing", scene.listing["id"]).status_code == 400
    assert _report(scene.coach, "media", scene.photo).json()["error"]["code"] == "cannot_report_self"


def test_things_that_do_not_exist_or_are_not_public_look_the_same(world, scene) -> None:
    sql(world.dsn, "UPDATE files SET access_level = 'PRIVATE' WHERE id = $1::uuid", scene.photo)
    gone = add_user(world.dsn, "gone@example.com", deleted=True)

    for kind, target in [
        ("user", "00000000-0000-0000-0000-000000000000"),
        ("user", gone),
        ("listing", "00000000-0000-0000-0000-000000000000"),
        ("media", scene.photo),  # a private file
    ]:
        response = _report(scene.reporter, kind, target)
        assert response.status_code == 404 and response.json()["error"]["code"] == "target_not_found", (kind, target)


def test_hidden_or_unlisted_content_cannot_be_reported(world, scene) -> None:
    world.admin.call("POST", f"/api/admin/listings/{scene.listing['id']}/hide", json={"reason": "Нарушение правил"})
    world.admin.call("POST", f"/api/admin/media/{scene.photo}/hide", json={"reason": "Нарушение правил"})

    assert _report(scene.reporter, "listing", scene.listing["id"]).status_code == 404
    assert _report(scene.reporter, "media", scene.photo).status_code == 404


def test_the_same_open_complaint_cannot_be_filed_twice_but_others_can_join(world, scene) -> None:
    assert _report(scene.reporter, "user", scene.coach.user_id).status_code == 201

    again = _report(scene.reporter, "user", scene.coach.user_id, "fraud")

    assert again.status_code == 409 and again.json()["error"]["code"] == "already_reported"
    assert _report(scene.other, "user", scene.coach.user_id).status_code == 201  # a different person may report the same thing
    assert sql_value(world.dsn, "SELECT count(*) FROM complaints") == 2


def test_after_a_decision_the_same_person_may_report_again(world, scene) -> None:
    first = _report(scene.reporter, "user", scene.coach.user_id).json()["id"]
    world.admin.call("POST", f"/api/admin/complaints/{first}/resolve", json={"status": "rejected", "resolution": "Нарушений не найдено"})

    assert _report(scene.reporter, "user", scene.coach.user_id).status_code == 201


def test_a_flood_of_complaints_is_stopped(world, scene, monkeypatch) -> None:
    monkeypatch.setenv("AUTH_RATE_LIMIT_ENABLED", "true")
    get_settings.cache_clear()
    targets = [add_user(world.dsn, f"victim{i}@example.com") for i in range(12)]

    statuses = [_report(scene.reporter, "user", t).status_code for t in targets]

    assert statuses[:10] == [201] * 10
    assert statuses[10:] == [429, 429]
    assert sql_value(world.dsn, "SELECT count(*) FROM complaints") == 10


def test_a_person_cannot_keep_unlimited_complaints_waiting(world, scene, monkeypatch) -> None:
    monkeypatch.setattr(complaints_repo, "MAX_OPEN_PER_REPORTER", 2)
    targets = [add_user(world.dsn, f"victim{i}@example.com") for i in range(3)]

    statuses = [_report(scene.reporter, "user", t) for t in targets]

    assert [r.status_code for r in statuses] == [201, 201, 409] and statuses[2].json()["error"]["code"] == "too_many_open"


def test_guests_and_blocked_users_cannot_file_complaints(world, scene) -> None:
    world.client.cookies.clear()
    assert world.client.post("/api/complaints", json={"target_type": "user", "target_id": scene.coach.user_id, "reason": "spam"}).status_code == 401
    sql(world.dsn, "UPDATE users SET is_banned = TRUE WHERE id = $1::uuid", scene.reporter.user_id)
    assert _report(scene.reporter, "user", scene.coach.user_id).status_code == 403


def test_a_complaint_post_without_the_csrf_token_is_refused(world, scene) -> None:
    world.client.cookies.clear()
    for name, value in scene.reporter.cookies.items():
        world.client.cookies.set(name, value)

    forged = world.client.post("/api/complaints", json={"target_type": "user", "target_id": scene.coach.user_id, "reason": "spam"})

    assert forged.status_code == 403 and sql_value(world.dsn, "SELECT count(*) FROM complaints") == 0


def test_users_have_no_way_to_read_complaints(world, scene) -> None:
    created = _report(scene.reporter, "user", scene.coach.user_id).json()["id"]

    for who in (scene.reporter, scene.other, scene.coach):
        assert who.call("GET", "/api/complaints").status_code in (404, 405)
        assert who.call("GET", f"/api/complaints/{created}").status_code in (404, 405)
        assert who.call("GET", "/api/admin/complaints").status_code == 403
        assert who.call("GET", f"/api/admin/complaints/{created}").status_code == 403
    assert scene.reporter.call("POST", f"/api/admin/complaints/{created}/resolve", json={"status": "resolved", "resolution": "сам себе"}).status_code == 403


# --- the administrators' queue ----------------------------------------------------------------------------------------


def test_the_queue_shows_who_complained_about_what_with_the_target_state(world, scene) -> None:
    _report(scene.reporter, "listing", scene.listing["id"], "fraud", "Обман")
    _report(scene.other, "listing", scene.listing["id"], "spam")

    page = _queue(world)
    first = page["items"][0]

    assert page["total"] == 2 and first["status"] == "new"
    assert first["target"]["type"] == "listing" and first["target"]["label"] == "Тренировки для всех" and first["target"]["state"] == "visible"
    assert first["target"]["owner"]["email"] == "coach@example.com"
    assert first["reporter"]["email"] in ("reporter@example.com", "other@example.com") and first["other_open_on_target"] == 1


def test_the_queue_filters_and_searches(world, scene) -> None:
    a = _report(scene.reporter, "user", scene.coach.user_id, "fraud").json()["id"]
    b = _report(scene.reporter, "listing", scene.listing["id"], "spam").json()["id"]
    c = _report(scene.other, "media", scene.photo, "inappropriate").json()["id"]
    world.admin.call("POST", f"/api/admin/complaints/{c}/take")

    ids = lambda **p: {i["id"] for i in _queue(world, **p)["items"]}  # noqa: E731

    assert ids(status="new") == {a, b} and ids(status="in_progress") == {c} and ids(status="resolved") == set()
    assert ids(target_type="listing") == {b} and ids(reason="fraud") == {a}
    assert ids(q="other@example.com") == {c} and ids(q="coach@example.com") == {a, b, c}
    assert ids(q=scene.coach.user_id) == {a, b, c} and ids(q=a) == {a} and ids(q=scene.reporter.user_id) == {a, b}
    assert ids(q="%") == set() and len(_queue(world, limit=2)["items"]) == 2 and len(_queue(world, limit=2, offset=2)["items"]) == 1
    for bad in ({"status": "done"}, {"target_type": "team"}, {"reason": "mean"}, {"limit": 101}, {"offset": -1}):
        assert world.admin.call("GET", "/api/admin/complaints", params=bad).status_code == 422


def test_open_complaints_come_before_closed_ones(world, scene) -> None:
    old = _report(scene.reporter, "user", scene.coach.user_id).json()["id"]
    world.admin.call("POST", f"/api/admin/complaints/{old}/resolve", json={"status": "resolved", "resolution": "Принято меры"})
    fresh = _report(scene.other, "user", scene.coach.user_id).json()["id"]

    assert [i["id"] for i in _queue(world)["items"]] == [fresh, old]


def test_taking_a_complaint_moves_it_to_in_progress_once(world, scene) -> None:
    cid = _report(scene.reporter, "user", scene.coach.user_id).json()["id"]

    taken = world.admin.call("POST", f"/api/admin/complaints/{cid}/take")

    assert taken.status_code == 200 and taken.json()["status"] == "in_progress"
    again = world.admin.call("POST", f"/api/admin/complaints/{cid}/take")
    assert again.status_code == 409 and again.json()["error"]["code"] == "bad_transition"
    assert [e["action"] for e in _audit(world) if e["target_id"] == cid] == ["complaint_take"]


def test_a_decision_is_final_and_recorded(world, scene) -> None:
    cid = _report(scene.reporter, "user", scene.coach.user_id).json()["id"]
    world.admin.call("POST", f"/api/admin/complaints/{cid}/take")

    done = world.admin.call("POST", f"/api/admin/complaints/{cid}/resolve", json={"status": "resolved", "resolution": "Пользователь предупреждён"})

    assert done.status_code == 200
    body = done.json()
    assert body["status"] == "resolved" and body["resolution"] == "Пользователь предупреждён" and body["handled_by"] == ADMIN_EMAIL and body["handled_at"]
    for path, payload in [("resolve", {"status": "rejected", "resolution": "передумали"}), ("take", None)]:
        again = world.admin.call("POST", f"/api/admin/complaints/{cid}/{path}", json=payload)
        assert again.status_code == 409, path
    entry = next(e for e in _audit(world) if e["action"] == "complaint_resolved")
    assert entry["reason"] == "Пользователь предупреждён" and entry["details"]["before"]["status"] == "in_progress" and entry["details"]["after"]["status"] == "resolved"


def test_a_decision_needs_a_status_and_a_written_resolution(world, scene) -> None:
    cid = _report(scene.reporter, "user", scene.coach.user_id).json()["id"]

    for body in ({}, {"status": "resolved"}, {"resolution": "хорошо"}, {"status": "new", "resolution": "хорошо"}, {"status": "resolved", "resolution": "ab"},
                 {"status": "resolved", "resolution": "хорошо", "handled_by": "x"}):
        assert world.admin.call("POST", f"/api/admin/complaints/{cid}/resolve", json=body).status_code == 422
    assert _queue(world)["items"][0]["status"] == "new"


def test_acting_on_the_target_is_visible_in_the_queue(world, scene) -> None:
    on_user = _report(scene.reporter, "user", scene.coach.user_id).json()["id"]
    on_media = _report(scene.reporter, "media", scene.photo).json()["id"]
    world.admin.call("POST", f"/api/admin/users/{scene.coach.user_id}/ban", json={"reason": "Подтверждённое мошенничество"})
    world.admin.call("POST", f"/api/admin/media/{scene.photo}/hide", json={"reason": "Неприемлемый контент"})

    states = {i["id"]: i["target"]["state"] for i in _queue(world)["items"]}

    assert states == {on_user: "blocked", on_media: "hidden"}
    assert world.admin.ok("GET", f"/api/admin/media/{scene.photo}")["open_complaints"] == 1


def test_a_missing_complaint_is_a_clean_404(world) -> None:
    missing = "00000000-0000-0000-0000-000000000000"

    assert world.admin.call("GET", f"/api/admin/complaints/{missing}").status_code == 404
    assert world.admin.call("POST", f"/api/admin/complaints/{missing}/take").status_code == 404
    assert world.admin.call("POST", f"/api/admin/complaints/{missing}/resolve", json={"status": "rejected", "resolution": "нет такой"}).status_code == 404


def test_the_dashboard_counts_new_complaints_and_content_waiting_for_review(world, scene) -> None:
    assert world.admin.ok("GET", "/api/admin/dashboard")["moderation"] == {"new_complaints": 0, "content_pending": 0}
    a = _report(scene.reporter, "user", scene.coach.user_id).json()["id"]
    _report(scene.reporter, "media", scene.photo)
    _report(scene.other, "listing", scene.listing["id"])

    assert world.admin.ok("GET", "/api/admin/dashboard")["moderation"] == {"new_complaints": 3, "content_pending": 2}
    world.admin.call("POST", f"/api/admin/complaints/{a}/take")
    assert world.admin.ok("GET", "/api/admin/dashboard")["moderation"] == {"new_complaints": 2, "content_pending": 2}
    world.admin.call("POST", f"/api/admin/complaints/{a}/resolve", json={"status": "resolved", "resolution": "Разобрались"})
    assert world.admin.ok("GET", "/api/admin/dashboard")["moderation"] == {"new_complaints": 2, "content_pending": 2}


def test_only_an_unlocked_administrator_reaches_the_queue(world, scene) -> None:
    cid = _report(scene.reporter, "user", scene.coach.user_id).json()["id"]
    calls = [
        ("GET", "/api/admin/complaints", None), ("GET", f"/api/admin/complaints/{cid}", None),
        ("POST", f"/api/admin/complaints/{cid}/take", None),
        ("POST", f"/api/admin/complaints/{cid}/resolve", {"status": "resolved", "resolution": "самовольное решение"}),
    ]
    for method, path, body in calls:
        world.client.cookies.clear()
        assert world.client.request(method, path, json=body).status_code == 401, ("guest", path)
        assert scene.reporter.call(method, path, json=body).status_code == 403, ("the reporter", path)
        locked = world.admin.fresh_session().call(method, path, json=body)
        assert locked.status_code == 403 and locked.json()["error"]["code"] == "mfa_required", ("no second factor", path)
    assert sql_value(world.dsn, "SELECT status FROM complaints WHERE id = $1::uuid", cid) == "new"
