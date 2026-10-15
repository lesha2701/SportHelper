"""The administration dashboard and the activity tracking behind DAU/WAU/MAU - real PostgreSQL, real sessions.
Every number is checked against rows the test itself put in the database."""
from __future__ import annotations

import pytest

from app.services import activity as activity_service
from tests.admin_world import Browser, add_user, live_client, pg, sql, sql_value, world  # noqa: F401  (fixtures)
from tests.admin_world import today as _today


_add_user = add_user


def _active(dsn: str, user_id: str, days_ago: int) -> None:
    sql(dsn, "INSERT INTO user_activity_days (user_id, day) VALUES ($1, (now() AT TIME ZONE 'UTC')::date - $2::int)", user_id, days_ago)


def _dashboard(world) -> dict:
    return world.admin.ok("GET", "/api/admin/dashboard")


# --- an empty platform --------------------------------------------------------------------------------


def test_a_platform_with_one_account_shows_zeros_not_invented_numbers(world) -> None:
    d = _dashboard(world)

    assert d["users"] == {"total": 1, "new_today": 1, "new_7d": 1, "new_30d": 1, "players": 0, "coaches": 0, "banned": 0}
    assert d["activity"] == {"dau": 0, "wau": 0, "mau": 0, "tracking_since": None}
    assert d["trainings"] == {"total": 0, "active": 0, "upcoming": 0, "completed": 0}
    assert d["bookings"] == {"total": 0, "confirmed": 0, "upcoming": 0}
    for chart in ("registrations", "active_users", "trainings_created", "bookings_created"):
        assert len(d[chart]) == 30, chart
    assert sum(point["count"] for point in d["active_users"]) == 0
    assert d["registrations"][-1]["count"] == 1  # today is the last point; the admin just registered


def test_chart_days_are_consecutive_utc_dates_ending_today(world) -> None:
    from datetime import date, timedelta

    days = [date.fromisoformat(p["day"]) for p in _dashboard(world)["registrations"]]

    assert days[-1] == _today(world.dsn)
    assert all(b - a == timedelta(days=1) for a, b in zip(days, days[1:]))


# --- registrations ----------------------------------------------------------------------------------------


def test_new_user_windows_count_calendar_days_and_ignore_deleted_accounts(world) -> None:
    for name, ago in [("today", 0), ("three", 3), ("six", 6), ("seven", 7), ("twentynine", 29), ("thirty", 30), ("old", 200)]:
        _add_user(world.dsn, f"{name}@example.com", days_ago=ago)
    _add_user(world.dsn, "gone@example.com", days_ago=0, deleted=True)

    users = _dashboard(world)["users"]

    # the administrator registered today as well: today=2, last 7 days (today-6..today)=4, last 30 (today-29..today)=6
    assert users["new_today"] == 2
    assert users["new_7d"] == 4
    assert users["new_30d"] == 6
    assert users["total"] == 1 + 7  # deleted accounts are not "registered users"


def test_registrations_chart_has_one_point_per_day_with_the_right_counts(world) -> None:
    _add_user(world.dsn, "a@example.com", days_ago=2)
    _add_user(world.dsn, "b@example.com", days_ago=2)
    _add_user(world.dsn, "c@example.com", days_ago=10)
    _add_user(world.dsn, "d@example.com", days_ago=45)  # outside the chart

    series = {p["day"]: p["count"] for p in _dashboard(world)["registrations"]}
    today = _today(world.dsn)

    from datetime import timedelta

    assert series[str(today - timedelta(days=2))] == 2
    assert series[str(today - timedelta(days=10))] == 1
    assert sum(series.values()) == 4  # + the administrator today


def test_players_coaches_and_blocked_accounts_are_counted_from_real_rows(world) -> None:
    p1 = _add_user(world.dsn, "p1@example.com")
    p2 = _add_user(world.dsn, "p2@example.com")
    both = _add_user(world.dsn, "both@example.com")
    coach = _add_user(world.dsn, "coach@example.com")
    banned = _add_user(world.dsn, "banned@example.com", banned=True)
    for uid in (p1, p2, both):
        sql(world.dsn, "INSERT INTO player_profiles (user_id, full_name, sport) VALUES ($1, 'P', 'Теннис')", uid)
    for uid in (both, coach):
        sql(world.dsn, "INSERT INTO coach_profiles (user_id, full_name, sport) VALUES ($1, 'C', 'Теннис')", uid)

    users = _dashboard(world)["users"]

    assert users["players"] == 3 and users["coaches"] == 2 and users["banned"] == 1
    assert banned  # sanity


def test_only_blocks_still_in_force_are_counted(world) -> None:
    for email, until in [("running@example.com", "now() + interval '2 days'"), ("expired@example.com", "now() - interval '1 hour'"), ("forever@example.com", "NULL")]:
        user = _add_user(world.dsn, email, banned=True)
        sql(world.dsn, f"UPDATE users SET banned_until = {until} WHERE id = $1::uuid", user)

    assert _dashboard(world)["users"]["banned"] == 2


# --- DAU / WAU / MAU ----------------------------------------------------------------------------------------


def test_dau_wau_mau_count_distinct_people_in_exact_windows(world) -> None:
    today_only = _add_user(world.dsn, "t@example.com")
    week_edge = _add_user(world.dsn, "w6@example.com")  # active 6 days ago: still inside the 7-day window
    just_out_of_week = _add_user(world.dsn, "w7@example.com")  # 7 days ago: inside MAU only
    month_edge = _add_user(world.dsn, "m29@example.com")  # 29 days ago: inside the 30-day window
    just_out_of_month = _add_user(world.dsn, "m30@example.com")  # 30 days ago: outside everything
    daily = _add_user(world.dsn, "daily@example.com")
    _active(world.dsn, today_only, 0)
    _active(world.dsn, week_edge, 6)
    _active(world.dsn, just_out_of_week, 7)
    _active(world.dsn, month_edge, 29)
    _active(world.dsn, just_out_of_month, 30)
    for ago in (0, 1, 2, 3, 20):  # many active days: still ONE person in every window
        _active(world.dsn, daily, ago)

    activity = _dashboard(world)["activity"]

    assert activity["dau"] == 2  # today_only, daily
    assert activity["wau"] == 3  # + week_edge
    assert activity["mau"] == 5  # + just_out_of_week, month_edge
    assert activity["tracking_since"] is not None


def test_deleted_accounts_do_not_count_as_active(world) -> None:
    gone = _add_user(world.dsn, "gone@example.com", deleted=True)
    _active(world.dsn, gone, 0)

    assert _dashboard(world)["activity"]["dau"] == 0


def test_the_activity_chart_shows_distinct_people_per_day(world) -> None:
    a, b = _add_user(world.dsn, "a@example.com"), _add_user(world.dsn, "b@example.com")
    for uid, ago in [(a, 0), (b, 0), (a, 1), (a, 5)]:
        _active(world.dsn, uid, ago)
    series = _dashboard(world)["active_users"]

    assert [p["count"] for p in series[-6:]] == [1, 0, 0, 0, 1, 2]


# --- the heartbeat -----------------------------------------------------------------------------------------------


def test_a_signed_in_person_is_recorded_once_per_day_however_often_the_page_pings(world) -> None:
    player = Browser(world.client, "player@example.com", "Игрок")

    for _ in range(5):
        assert player.call("POST", "/api/activity").status_code == 204

    rows = sql(world.dsn, "SELECT day FROM user_activity_days WHERE user_id = $1::uuid", player.user_id)
    assert len(rows) == 1
    assert sql_value(world.dsn, "SELECT last_active_at IS NOT NULL FROM users WHERE id = $1::uuid", player.user_id) is True


def test_pings_are_thinned_out_before_they_reach_the_database(world, monkeypatch) -> None:
    from app.repositories import activity as activity_repo

    writes = []
    real = activity_repo.record

    async def counting(conn, user_id):
        writes.append(user_id)
        await real(conn, user_id)

    monkeypatch.setattr(activity_repo, "record", counting)
    player = Browser(world.client, "player@example.com", "Игрок")

    for _ in range(20):
        player.call("POST", "/api/activity")

    assert len(writes) == 1  # not one write per request


def test_two_devices_of_one_person_are_one_active_user(world) -> None:
    laptop = Browser(world.client, "dual@example.com", "Двойной")
    laptop.call("POST", "/api/activity")
    phone = Browser.__new__(Browser)  # the same account signed in on a second device
    phone.client, phone.email, phone.password = world.client, laptop.email, laptop.password
    phone.login()
    activity_service.forget_all()  # as if the phone talked to another backend process
    phone.call("POST", "/api/activity")

    assert sql_value(world.dsn, "SELECT count(*) FROM user_activity_days WHERE user_id = $1::uuid", laptop.user_id) == 1


def test_guests_are_never_recorded(world) -> None:
    world.client.cookies.clear()

    assert world.client.post("/api/activity").status_code in (401, 403)
    assert sql_value(world.dsn, "SELECT count(*) FROM user_activity_days") == 0


def test_a_blocked_account_cannot_record_activity(world) -> None:
    victim = Browser(world.client, "victim@example.com", "Жертва")
    sql(world.dsn, "UPDATE users SET is_banned = TRUE WHERE id = $1::uuid", victim.user_id)

    assert victim.call("POST", "/api/activity").status_code == 403
    assert sql_value(world.dsn, "SELECT count(*) FROM user_activity_days WHERE user_id = $1::uuid", victim.user_id) == 0


def test_background_polling_endpoints_do_not_count_as_activity(world) -> None:
    player = Browser(world.client, "poller@example.com", "Поллер")

    for path in ("/api/notifications", "/api/auth/me", "/api/profile/me"):
        player.call("GET", path)

    assert sql_value(world.dsn, "SELECT count(*) FROM user_activity_days WHERE user_id = $1::uuid", player.user_id) == 0


# --- trainings and bookings ------------------------------------------------------------------------------------


def _training(dsn: str, creator: str, *, status: str = "scheduled", days_from_now: int = 1, deleted: bool = False, days_ago_created: int = 0) -> str:
    return str(
        sql_value(
            dsn,
            """
            INSERT INTO trainings (created_by, type, training_date, start_time, duration_minutes, status, deleted_at, created_at)
            VALUES ($1::uuid, 'personal', CURRENT_DATE + $2::int, '10:00', 60, $3, CASE WHEN $4 THEN now() END,
                    ((now() AT TIME ZONE 'UTC')::date - $5::int + time '12:00') AT TIME ZONE 'UTC')
            RETURNING id
            """,
            creator, days_from_now, status, deleted, days_ago_created,
        )
    )


def test_training_figures_separate_active_upcoming_and_completed(world) -> None:
    owner = _add_user(world.dsn, "owner@example.com")
    _training(world.dsn, owner, days_from_now=2)  # upcoming
    _training(world.dsn, owner, days_from_now=0)  # today: still upcoming
    _training(world.dsn, owner, days_from_now=-3)  # scheduled in the past: active, not upcoming
    _training(world.dsn, owner, status="completed", days_from_now=-1)
    _training(world.dsn, owner, status="cancelled", days_from_now=5)
    _training(world.dsn, owner, deleted=True)

    trainings = _dashboard(world)["trainings"]

    assert trainings == {"total": 5, "active": 3, "upcoming": 2, "completed": 1}


def test_bookings_and_the_creation_charts_come_from_real_rows(world) -> None:
    coach = _add_user(world.dsn, "coach@example.com")
    athlete = _add_user(world.dsn, "athlete@example.com")
    sql(world.dsn, "INSERT INTO coach_profiles (user_id, full_name, sport) VALUES ($1::uuid, 'C', 'Теннис')", coach)
    for hour, status, offset in [(10, "confirmed", 2), (11, "confirmed", -2), (12, "cancelled", 3)]:
        training = _training(world.dsn, athlete, days_ago_created=1)
        sql(
            world.dsn,
            """
            INSERT INTO bookings (coach_user_id, athlete_user_id, starts_at, duration_minutes, format, currency, status, training_id, created_at)
            VALUES ($1::uuid, $2::uuid, now() + make_interval(days => $3) + make_interval(hours => $4), 60, 'online', 'RUB', $5, $6::uuid,
                    ((now() AT TIME ZONE 'UTC')::date - 1 + time '12:00') AT TIME ZONE 'UTC')
            """,
            coach, athlete, offset, hour, status, training,
        )

    d = _dashboard(world)

    assert d["bookings"] == {"total": 3, "confirmed": 2, "upcoming": 1}
    assert d["bookings_created"][-2]["count"] == 3  # all created yesterday
    assert d["trainings_created"][-2]["count"] == 3
    assert d["trainings_created"][-1]["count"] == 0
