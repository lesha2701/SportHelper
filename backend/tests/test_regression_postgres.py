"""End-to-end regression of the product's main flows under the NEW authentication,
exactly as the website drives them: real sign-up, e-mail confirmation, cookie
session + CSRF header, real SQL. (The rest of the HTTP suite is also run against
PostgreSQL with SAG_TEST_REAL_DB=1, see tests/real_db.py.)"""
from __future__ import annotations

import asyncio
from datetime import date, timedelta

import asyncpg

from tests.auth_helpers import PASSWORD, link_token
from tests.test_auth_postgres import live_client, pg  # noqa: F401  (fixtures)

_NEXT_MONDAY = date.today() + timedelta(days=(7 - date.today().weekday()) % 7 or 7)


class Browser:
    """One person's browser: its own cookie jar and CSRF token on the shared test client."""

    def __init__(self, client, email: str, first_name: str, role: str):
        self.client, self.email, self.cookies, self.csrf = client, email, {}, ""
        client.cookies.clear()
        assert client.post("/api/auth/register", json={
            "first_name": first_name, "email": email, "password": PASSWORD, "password_confirm": PASSWORD,
            "accept_terms": True, "role": role}).status_code == 201
        assert client.post("/api/auth/verify-email", json={"token": link_token(client.outbox[-1]), "password": PASSWORD}).status_code == 200
        login = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
        assert login.status_code == 200, login.text
        self.csrf = login.json()["csrf_token"]
        self.user_id = login.json()["id"]
        self.cookies = dict(client.cookies)

    def call(self, method: str, path: str, **kwargs):
        self.client.cookies.clear()
        for name, value in self.cookies.items():
            self.client.cookies.set(name, value)
        headers = {"X-CSRF-Token": self.csrf} if method != "GET" else {}
        return self.client.request(method, path, headers=headers, **kwargs)

    def ok(self, method: str, path: str, **kwargs):
        response = self.call(method, path, **kwargs)
        assert response.status_code == 200, f"{method} {path} -> {response.status_code}: {response.text}"
        return response.json()


def _guest(client, method: str, path: str, **kwargs):
    client.cookies.clear()
    return client.request(method, path, **kwargs)


def test_coach_publishes_a_listing_player_books_coach_confirms_and_both_see_it_in_the_schedule(live_client) -> None:  # noqa: F811
    client = live_client
    coach = Browser(client, "coach@example.com", "Тренер", "coach")
    player = Browser(client, "player@example.com", "Игрок", "player")

    # --- the coach creates a profile and publishes a listing -------------------------------------
    coach.ok("PUT", "/api/profile/coach", json={"full_name": "Анна Тренер", "sport": "Теннис", "experience_years": 5,
                                                  "specialization": None, "description": None})
    listing = coach.ok("POST", "/api/coach-listings", json={
        "title": "Теннис для взрослых", "description": "Индивидуально", "is_listed": False, "price_per_session": 2500,
        "currency": "RUB", "offers_online": True, "offers_offline": True, "location": "Москва", "session_duration_minutes": 60})
    coach.ok("PUT", f"/api/coach-listings/{listing['id']}/availability",
             json=[{"weekday": _NEXT_MONDAY.weekday(), "start_time": "10:00:00", "end_time": "12:00:00"}])
    published = coach.ok("PUT", f"/api/coach-listings/{listing['id']}", json={
        "title": "Теннис для взрослых", "description": "Индивидуально", "is_listed": True, "price_per_session": 2500,
        "currency": "RUB", "offers_online": True, "offers_offline": True, "location": "Москва", "session_duration_minutes": 60})
    assert published["is_listed"] is True
    assert [l["id"] for l in coach.ok("GET", "/api/coach-listings/me")] == [listing["id"]]

    # --- a guest can browse but not act ----------------------------------------------------------------
    catalogue = _guest(client, "GET", "/api/coach-listings")
    assert catalogue.status_code == 200 and [l["id"] for l in catalogue.json()] == [listing["id"]]
    slots = _guest(client, "GET", f"/api/coach-listings/{listing['id']}/slots",
                   params={"from_date": _NEXT_MONDAY.isoformat(), "to_date": _NEXT_MONDAY.isoformat()})
    assert slots.status_code == 200 and slots.json(), "the published listing must expose open slots"
    start = slots.json()[0]["starts_at"]
    assert _guest(client, "POST", "/api/bookings", json={"listing_id": listing["id"], "starts_at": start, "format": "online"}).status_code == 401

    # --- the player books --------------------------------------------------------------------------------------
    player.ok("PUT", "/api/profile/player", json={"full_name": "Игорь Игрок", "sport": "Теннис", "age": 28, "height_cm": None,
                                                    "weight_kg": None, "position": None, "level": "amateur", "goals": None,
                                                    "load_restrictions": None})
    # a booking POST that doesn't echo the CSRF token (as a forged cross-site form wouldn't) is refused
    client.cookies.clear()
    for name, value in player.cookies.items():
        client.cookies.set(name, value)
    assert client.post("/api/bookings", json={"listing_id": listing["id"], "starts_at": start, "format": "online"}).status_code == 403
    booking = player.ok("POST", "/api/bookings", json={"listing_id": listing["id"], "starts_at": start, "format": "online"})
    assert booking["status"] == "pending"
    assert [b["id"] for b in player.ok("GET", "/api/bookings/me")] == [booking["id"]]
    # the slot is taken now, for everybody
    still_open = _guest(client, "GET", f"/api/coach-listings/{listing['id']}/slots",
                        params={"from_date": _NEXT_MONDAY.isoformat(), "to_date": _NEXT_MONDAY.isoformat()}).json()
    assert start not in [slot["starts_at"] for slot in still_open]

    # --- the coach confirms; both calendars show the session ---------------------------------------------------------
    assert [b["id"] for b in coach.ok("GET", "/api/bookings/coach/pending")] == [booking["id"]]
    assert player.call("POST", f"/api/bookings/{booking['id']}/confirm").status_code == 403  # not the player's call
    confirmed = coach.ok("POST", f"/api/bookings/{booking['id']}/confirm")
    assert confirmed["status"] == "confirmed" and confirmed["training_id"]
    window = {"date_from": _NEXT_MONDAY.isoformat(), "date_to": (_NEXT_MONDAY + timedelta(days=1)).isoformat()}
    for person in (coach, player):
        events = person.ok("GET", "/api/calendar", params=window)
        assert [e["id"] for e in events if e["type"] == "training"] == [confirmed["training_id"]]

    # --- notifications travelled through the real tables ------------------------------------------------------------------
    assert {n["category"] for n in coach.ok("GET", "/api/notifications")} >= {"booking_requested"}
    assert {n["category"] for n in player.ok("GET", "/api/notifications")} >= {"booking_decided"}


def test_profiles_both_roles_and_switching_with_a_cookie_session(live_client) -> None:  # noqa: F811
    client = live_client
    person = Browser(client, "both@example.com", "Оба", "coach")

    assert person.ok("GET", "/api/profile/me")["coach"] is None
    person.ok("PUT", "/api/profile/coach", json={"full_name": "Тренер Оба", "sport": "Бег", "experience_years": 1,
                                                  "specialization": None, "description": None})
    person.ok("PUT", "/api/profile/player", json={"full_name": "Игрок Оба", "sport": "Бег", "age": 30, "height_cm": None,
                                                   "weight_kg": None, "position": None, "level": None, "goals": None,
                                                   "load_restrictions": None})
    assert person.ok("POST", "/api/profile/active-mode", json={"mode": "player"})["active_mode"] == "player"
    me = person.ok("GET", "/api/profile/me")
    assert me["coach"]["full_name"] == "Тренер Оба" and me["player"]["full_name"] == "Игрок Оба"
    assert person.call("POST", "/api/profile/active-mode", json={"mode": "admin"}).status_code == 422  # no self-promotion


def test_team_with_invite_application_schedule_tasks_and_matches(live_client) -> None:  # noqa: F811
    client = live_client
    coach = Browser(client, "tc@example.com", "Тренер", "coach")
    player = Browser(client, "tp@example.com", "Игрок", "player")
    stranger = Browser(client, "ts@example.com", "Чужой", "player")
    coach.ok("PUT", "/api/profile/coach", json={"full_name": "Тренер Команды", "sport": "Футбол", "experience_years": 3,
                                                 "specialization": None, "description": None})
    player.ok("PUT", "/api/profile/player", json={"full_name": "Игрок Команды", "sport": "Футбол", "age": 20, "height_cm": None,
                                                    "weight_kg": None, "position": "Вратарь", "level": None, "goals": None,
                                                    "load_restrictions": None})

    team = coach.ok("POST", "/api/teams", json={"name": "Ястребы", "description": None, "sport": "Футбол",
                                                  "age_category": "U-16", "level": "amateur"})
    assert team["my_role"] == "head_coach"
    invite = coach.ok("POST", f"/api/teams/{team['id']}/invites", json={"kind": "join"})
    token = invite["token"]
    assert player.call("POST", f"/api/invites/{token}/apply").status_code == 200
    application = coach.ok("GET", f"/api/teams/{team['id']}/applications")[0]
    assert coach.call("POST", f"/api/teams/{team['id']}/applications/{application['id']}/accept").status_code == 204

    members = coach.ok("GET", f"/api/teams/{team['id']}/members")
    assert {m["first_name"] for m in members} == {"Тренер", "Игрок"} and all("telegram_id" not in m for m in members)
    assert stranger.call("GET", f"/api/teams/{team['id']}/members").status_code == 403  # not a member

    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    training = coach.ok("POST", f"/api/teams/{team['id']}/trainings", json={
        "training_date": tomorrow, "start_time": "18:00:00", "duration_minutes": 90, "location": "Зал", "description": None,
        "plan_id": None, "reminder_minutes_before": 60, "repeat_weekly_until": None})[0]
    attendance = coach.ok("GET", f"/api/trainings/{training['id']}/attendance")
    assert {a["first_name"] for a in attendance} >= {"Игрок"}
    task = coach.ok("POST", f"/api/teams/{team['id']}/tasks", json={
        "title": "Пробежка", "description": None, "plan_id": None, "exercise_ids": [], "deadline": None, "metric_name": None,
        "metric_unit": None, "metric_target": None, "require_comment": False, "require_photo": False, "require_video": False,
        "require_sets_reps": False, "require_duration": False, "require_metric_value": False, "require_difficulty": False,
        "target_type": "team", "player_ids": [], "position": None, "training_id": None})
    assert task["title"] == "Пробежка"
    match = coach.ok("POST", f"/api/teams/{team['id']}/matches", json={
        "opponent_name": "Соседи", "match_date": tomorrow, "start_time": "15:00:00", "location": "Стадион", "is_home": True,
        "tournament": None})
    assert coach.ok("GET", f"/api/matches/{match['id']}")["opponent_name"] == "Соседи"

    events = player.ok("GET", "/api/calendar", params={"date_from": tomorrow, "date_to": tomorrow})
    assert {e["type"] for e in events} >= {"training", "match"}
    assert coach.call("GET", f"/api/teams/{team['id']}/stats").status_code == 200
    assert player.ok("GET", "/api/teams/mine")[0]["id"] == team["id"]


def test_background_tick_runs_on_the_real_schema_without_a_telegram_bot(pg) -> None:  # noqa: F811
    """The loop that sends notifications, expires bookings, schedules nudges, purges stale
    auth data and anonymises deleted accounts - all SQL, run once against PostgreSQL."""
    from app.config import Settings
    from app.database import create_pool, run_migrations
    from app.repositories import users as users_repo
    from app.services import background

    async def scenario():
        settings = Settings(_env_file=None, DATABASE_URL=pg, NUDGE_ENABLED="true", NUDGE_WINDOW_START_HOUR="0",
                            NUDGE_WINDOW_END_HOUR="24", ACCOUNT_DELETION_GRACE_DAYS="14")
        pool = await create_pool(settings)
        try:
            await run_migrations(pool)
            async with pool.acquire() as conn:
                # one person who left Telegram behind (gets nothing sent), one reachable through it
                email_only = await conn.fetchrow("INSERT INTO users (email, email_verified_at, first_name, last_login_at) "
                                                 "VALUES ('e@example.com', now(), 'Email', now() - interval '3 days') RETURNING id")
                telegram = await conn.fetchrow("INSERT INTO users (telegram_id, first_name, last_login_at) "
                                               "VALUES (4242, 'Tele', now() - interval '3 days') RETURNING id")
                leaving = await conn.fetchrow("INSERT INTO users (email, email_verified_at, first_name, deletion_requested_at) "
                                              "VALUES ('bye@example.com', now(), 'Bye', now() - interval '30 days') RETURNING id")
                background._last_nudge_check = None
                background._last_auth_cleanup = None
            await background.run_tick(pool, None, settings)
            async with pool.acquire() as conn:
                nudged = {r["user_id"] for r in await conn.fetch("SELECT user_id FROM notifications WHERE category = 'training_nudge'")}
                gone = await users_repo.get_by_id(conn, leaving["id"])
                return email_only["id"], telegram["id"], nudged, gone
        finally:
            await pool.close()

    email_only, telegram, nudged, gone = asyncio.run(scenario())

    assert telegram in nudged and email_only not in nudged  # a nudge is only queued where it can be delivered
    assert gone["deleted_at"] is not None and gone["email"] is None and gone["first_name"] == "Удалённый пользователь"


def test_the_bots_admin_queries_still_work_with_users_who_have_no_telegram(pg) -> None:  # noqa: F811
    from app.repositories import admin as admin_repo

    async def scenario():
        conn = await asyncpg.connect(pg)
        try:
            await _apply_all(conn)
            await conn.execute("INSERT INTO users (telegram_id, first_name) VALUES (111, 'Old')")
            await conn.execute("INSERT INTO users (email, email_verified_at, first_name) VALUES ('new@example.com', now(), 'New')")
            listed = await admin_repo.list_users(conn, limit=10, offset=0)
            detail = await admin_repo.get_user_detail(conn, 111)
            banned = await admin_repo.set_banned(conn, 111, True)
            recipients = await admin_repo.list_active_recipient_telegram_ids(conn)
            stats = await admin_repo.get_project_stats(conn)
            return listed, detail, banned, recipients, stats
        finally:
            await conn.close()

    listed, detail, banned, recipients, stats = asyncio.run(scenario())

    assert len(listed) == 2 and detail["telegram_id"] == 111 and banned["is_banned"] is True
    assert recipients == []  # banned, and the e-mail-only user has no chat to broadcast to
    assert stats["total_users"] == 2


async def _apply_all(conn) -> None:
    from tests.test_auth_postgres import _apply

    await _apply(conn)


def test_members_are_marked_present_on_trainings_that_took_place_and_only_on_those(pg) -> None:  # noqa: F811
    """The statistics count a training the coach marked as held even when its date is still ahead,
    so the "everyone is present unless marked absent" rows must exist for it - and not for
    trainings that did not happen, for people who joined later, or for coach-corrected rows."""
    from app.config import Settings
    from app.database import create_pool, run_migrations
    from app.services import background

    async def scenario():
        pool = await create_pool(Settings(_env_file=None, DATABASE_URL=pg))
        try:
            await run_migrations(pool)
            async with pool.acquire() as conn:
                coach = await conn.fetchval("INSERT INTO users (email, first_name) VALUES ('c@e.com', 'C') RETURNING id")
                early = await conn.fetchval("INSERT INTO users (email, first_name) VALUES ('p1@e.com', 'P1') RETURNING id")
                late = await conn.fetchval("INSERT INTO users (email, first_name) VALUES ('p2@e.com', 'P2') RETURNING id")
                team = await conn.fetchval("INSERT INTO teams (name, sport, created_by) VALUES ('T', 'Футбол', $1) RETURNING id", coach)
                await conn.execute("INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES "
                                   "($1, $2, 'head_coach', now() - interval '30 days'), ($1, $3, 'player', now() - interval '30 days'), "
                                   "($1, $4, 'player', now() + interval '10 days')", team, coach, early, late)

                async def training(day_offset: int, status: str) -> object:
                    return await conn.fetchval(
                        "INSERT INTO trainings (team_id, created_by, type, training_date, start_time, duration_minutes, status) "
                        "VALUES ($1, $2, 'team', CURRENT_DATE + $3::int, '18:00', 90, $4) RETURNING id", team, coach, day_offset, status)

                future_held = await training(5, "completed")
                past_unmarked = await training(-1, "scheduled")
                future_planned = await training(5, "scheduled")
                past_cancelled = await training(-1, "cancelled")
                corrected = await training(-2, "completed")
                await conn.execute("INSERT INTO training_attendance (training_id, user_id, status) VALUES ($1, $2, 'absent')", corrected, early)

                await background.sweep_attendance(conn)
                again = await background.sweep_attendance(conn)  # idempotent

                rows = await conn.fetch("SELECT training_id, user_id, status FROM training_attendance")
                return {(r["training_id"], r["user_id"]): r["status"] for r in rows}, again, (
                    future_held, past_unmarked, future_planned, past_cancelled, corrected), (coach, early, late)
        finally:
            await pool.close()

    rows, again, (future_held, past_unmarked, future_planned, past_cancelled, corrected), (coach, early, late) = asyncio.run(scenario())

    assert rows[(future_held, early)] == "present" and rows[(future_held, coach)] == "present"
    assert rows[(past_unmarked, early)] == "present"
    assert not any(t in (future_planned, past_cancelled) for t, _ in rows)  # didn't happen -> nothing recorded
    assert (future_held, late) not in rows  # joined after the training date
    assert rows[(corrected, early)] == "absent"  # the coach's correction is never overwritten
    assert not again  # nothing left to do on the second pass


def test_files_with_and_without_a_thumbnail_on_the_real_schema_and_the_purge_removes_both_copies(pg) -> None:  # noqa: F811
    """The thumbnail column is optional: rows written before it existed (NULL) behave exactly as before,
    new ones carry the path, and the retention job deletes the picture AND its thumbnail from the disk."""
    from datetime import datetime, timedelta, timezone

    from app.config import Settings
    from app.database import create_pool, run_migrations
    from app.repositories import files as files_repo
    from app.services import background

    deleted: list[str] = []

    class RecordingDisk:
        def __init__(self, settings):
            pass

        async def delete(self, path: str) -> None:
            deleted.append(path)

    async def scenario():
        settings = Settings(_env_file=None, DATABASE_URL=pg, YANDEX_DISK_OAUTH_TOKEN="test-token", SOFT_DELETE_RETENTION_DAYS="1")
        pool = await create_pool(settings)
        try:
            await run_migrations(pool)
            async with pool.acquire() as conn:
                owner = await conn.fetchval("INSERT INTO users (email, first_name) VALUES ('f@e.com', 'F') RETURNING id")
                common = dict(owner_id=owner, team_id=None, entity_type="coach_listing_photo", entity_id=None, filename="a.webp",
                              mime_type="image/webp", size_bytes=10, access_level="PUBLIC")
                legacy = await files_repo.create_file(conn, disk_path="/TeamFlow/main/old.jpg", **common)
                modern = await files_repo.create_file(conn, disk_path="/TeamFlow/main/new.webp", thumb_disk_path="/TeamFlow/main/new_thumb.webp", **common)
                fetched = [await files_repo.get_file(conn, legacy["id"]), await files_repo.get_file(conn, modern["id"])]
                await conn.execute("UPDATE files SET deleted_at = $1", datetime.now(timezone.utc) - timedelta(days=5))
                background.YandexDiskClient = RecordingDisk
                await background.purge_soft_deleted_files(conn, settings)
                left = await conn.fetchval("SELECT count(*) FROM files")
                return fetched, left
        finally:
            await pool.close()

    original = background.YandexDiskClient
    try:
        fetched, left = asyncio.run(scenario())
    finally:
        background.YandexDiskClient = original

    assert fetched[0]["thumb_disk_path"] is None and fetched[1]["thumb_disk_path"] == "/TeamFlow/main/new_thumb.webp"
    assert sorted(deleted) == ["/TeamFlow/main/new.webp", "/TeamFlow/main/new_thumb.webp", "/TeamFlow/main/old.jpg"]
    assert left == 0
