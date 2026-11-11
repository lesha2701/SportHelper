"""REF-19: session times are wall-clock times of the platform's zone (SESSION_TIMEZONE, Europe/Moscow), kept in
bookings.starts_at with a UTC label (10:00Z = "в 10:00 по Москве"). Every rule that asks "has it started / how long is
left / which day is today" must read them on that clock, not as real UTC instants — that ran every rule 3 hours late.

The clock is frozen here at a known real moment; each case is one that the old comparison got wrong."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from app.config import Settings, get_settings
from app.core import session_time
from app.repositories import bookings as bookings_repo
from app.repositories import coach_listings as listings_repo
from app.repositories import matches as matches_repo
from app.repositories import trainings as trainings_repo
from app.services import cancellations as cancellations_service
from app.services import notifications as notifications_service
from app.services import payments as payments_service
from app.core.exceptions import APIError
from tests.test_auth_postgres import conn, pg  # noqa: F401  (fixtures)

pytestmark = pytest.mark.filterwarnings("ignore::DeprecationWarning")

# Monday 16 November 2026, 10:30 in Moscow (07:30 UTC).
REAL_NOW = datetime(2026, 11, 16, 7, 30, tzinfo=timezone.utc)


def wall(hour: int, minute: int = 0, day: int = 16) -> datetime:
    """A session time as it is stored: Moscow wall-clock time with a UTC label."""
    return datetime(2026, 11, day, hour, minute, tzinfo=timezone.utc)


@pytest.fixture
def frozen(monkeypatch):
    """The real clock stands at REAL_NOW for everything that reads it through app/core/session_time.py."""

    class Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            return REAL_NOW if tz is None else REAL_NOW.astimezone(tz)

    monkeypatch.setattr(session_time, "datetime", Frozen)
    return REAL_NOW


@pytest.fixture
def zone(monkeypatch):
    def use(name: str) -> None:
        monkeypatch.setenv("SESSION_TIMEZONE", name)
        get_settings.cache_clear()

    yield use
    get_settings.cache_clear()


def booking(starts_at: datetime, **extra) -> dict:
    return {"status": "confirmed", "training_status": "scheduled", "starts_at": starts_at, "duration_minutes": 60, **extra}


# --- the clock itself ---------------------------------------------------------------------------------------------------------


def test_the_platform_clock_reads_moscow_time_written_as_utc(frozen) -> None:
    assert session_time.wall_now() == wall(10, 30)
    assert session_time.instant_of_wall(wall(10, 0)) == datetime(2026, 11, 16, 7, 0, tzinfo=timezone.utc)
    assert session_time.instant_of(date(2026, 11, 20), time(10, 0)) == datetime(2026, 11, 20, 7, 0, tzinfo=timezone.utc)


def test_today_is_the_moscow_date_even_while_utc_is_still_on_yesterday() -> None:
    late_evening_utc = datetime(2026, 11, 16, 22, 30, tzinfo=timezone.utc)  # 01:30 on the 17th in Moscow
    assert session_time.wall_today(late_evening_utc) == date(2026, 11, 17)


def test_another_zone_is_honoured(frozen, zone) -> None:
    zone("Asia/Yekaterinburg")  # UTC+5
    assert session_time.wall_now() == wall(12, 30)
    assert session_time.instant_of(date(2026, 11, 20), time(10, 0)) == datetime(2026, 11, 20, 5, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize("name", ["Mars/Olympus", "Europe/Moscow'; DROP TABLE bookings; --", ""])
def test_an_unknown_or_unsafe_zone_is_refused(name) -> None:
    with pytest.raises(ValueError):
        Settings(_env_file=None, SESSION_TIMEZONE=name)


# --- bookings: started, cancellable, conducted, payable ---------------------------------------------------------------------------


def test_a_session_at_10_has_started_at_10_30_moscow_time(frozen) -> None:
    started = booking(wall(10, 0))
    assert bookings_repo.has_started(started) is True
    assert bookings_repo.can_cancel(started) is False  # the old comparison allowed cancelling until 13:00 Moscow time
    assert bookings_repo.has_started(booking(wall(11, 0))) is False
    assert bookings_repo.can_cancel(booking(wall(11, 0))) is True


def test_cancelling_a_started_session_is_refused(frozen) -> None:
    with pytest.raises(APIError) as refused:
        cancellations_service.check_cancellable(booking(wall(10, 0)), now=session_time.wall_now())
    assert refused.value.code == "session_started"


def test_the_free_cancellation_window_is_a_full_24_hours(frozen) -> None:
    settings = Settings(_env_file=None, CANCEL_FREE_HOURS=24)
    paid = {"status": "paid", "gross_kopecks": 250000, "refund_reserved_kopecks": 0}
    now = session_time.wall_now()

    # 22 hours before a session at 08:30 tomorrow: late. (The old clock counted 25 hours and returned everything.)
    late = cancellations_service.make_plan(booking(wall(8, 30, day=17)), paid, "athlete", now=now, settings=settings)
    assert (late.policy, late.refund_percent, late.hours_before_start) == ("athlete_late", 0, Decimal("22.00"))
    assert late.free_cancel_until == wall(8, 30, day=16)  # told on the same clock as starts_at

    early = cancellations_service.make_plan(booking(wall(11, 0, day=17)), paid, "athlete", now=now, settings=settings)
    assert (early.policy, early.refund_percent, early.hours_before_start) == ("athlete_early", 100, Decimal("24.50"))


def test_reviews_open_when_the_session_is_over_on_the_platform_clock(frozen) -> None:
    assert bookings_repo.is_completed(booking(wall(9, 0))) is True  # 09:00-10:00, it is 10:30
    assert bookings_repo.is_completed(booking(wall(10, 0))) is False  # 10:00-11:00, still on


def test_a_session_that_is_over_cannot_be_paid(frozen) -> None:
    over = booking(wall(9, 0), price_per_session=2500, currency="RUB")
    with pytest.raises(APIError) as refused:
        payments_service.ensure_payable(over)
    assert refused.value.code == "booking_closed"
    payments_service.ensure_payable(booking(wall(10, 0), price_per_session=2500, currency="RUB"))  # still on: payable


# --- slots ------------------------------------------------------------------------------------------------------------------------


async def test_slots_that_have_begun_on_the_platform_clock_are_not_offered(frozen, monkeypatch) -> None:
    listing_id, coach_id = uuid4(), uuid4()

    async def get_listing(conn, lid):
        return {"id": lid, "coach_user_id": coach_id, "session_duration_minutes": 60}

    async def list_availability(conn, lid):
        return [{"weekday": 0, "start_time": time(9, 0), "end_time": time(13, 0)}]  # Mondays 09:00-13:00

    class NoBookings:
        async def fetch(self, *args):
            return []

    monkeypatch.setattr(listings_repo, "get_listing", get_listing)
    monkeypatch.setattr(listings_repo, "list_availability", list_availability)

    slots = await listings_repo.compute_open_slots(NoBookings(), listing_id, date(2026, 11, 16), date(2026, 11, 16))

    # It is 10:30 in Moscow: 09:00 and 10:00 have begun. (The old clock still offered both.)
    assert [s["starts_at"] for s in slots] == [wall(11, 0), wall(12, 0)]


# --- training reminders -----------------------------------------------------------------------------------------------------------


async def test_a_training_reminder_is_queued_for_the_real_moment(monkeypatch) -> None:
    queued: list[dict] = []

    async def cancel_pending_for_entity(conn, entity_type, entity_id):
        return None

    async def create_or_reschedule(conn, **fields):
        queued.append(fields)

    monkeypatch.setattr(notifications_service.notifications_repo, "cancel_pending_for_entity", cancel_pending_for_entity)
    monkeypatch.setattr(notifications_service.notifications_repo, "create_or_reschedule", create_or_reschedule)
    training = {
        "id": uuid4(), "type": "personal", "created_by": uuid4(), "team_id": None, "status": "scheduled", "location": None,
        "training_date": date(2026, 11, 20), "start_time": time(10, 0), "reminder_minutes_before": 60,
    }

    await notifications_service.schedule_training_reminders(None, training)

    # 09:00 in Moscow is 06:00 UTC (it used to be queued for 09:00 UTC = 12:00 in Moscow, two hours after the start).
    assert queued[0]["send_at"] == datetime(2026, 11, 20, 6, 0, tzinfo=timezone.utc)
    assert queued[0]["body"] == "Тренировка 20.11 в 10:00"  # the text keeps the time people know


# --- SQL: the database reads the same clock ------------------------------------------------------------------------------------


async def test_sql_reads_the_same_clock_as_python(conn, zone) -> None:  # noqa: F811
    for name in ("Europe/Moscow", "Pacific/Kiritimati", "Pacific/Pago_Pago"):
        zone(name)
        db_now, db_today = await conn.fetchrow(f"SELECT {session_time.sql_wall_now()}, {session_time.sql_wall_today()}")
        assert abs(db_now - session_time.wall_now()) < timedelta(seconds=30), name
        assert db_today == session_time.wall_today(), name


def test_no_session_query_uses_the_databases_own_date() -> None:
    for sql in (trainings_repo._held("t"), trainings_repo._upcoming(), trainings_repo._upcoming_first_order(), matches_repo._upcoming_first_order()):
        assert "CURRENT_DATE" not in sql and session_time.sql_wall_today() in sql


async def _user(conn) -> object:  # noqa: F811
    return await conn.fetchval(
        "INSERT INTO users (email, email_verified_at, first_name, password_hash) VALUES ($1, now(), 'U', 'hash') RETURNING id",
        f"u-{uuid4().hex[:12]}@example.com",
    )


async def test_a_pending_request_whose_session_has_begun_expires(conn) -> None:  # noqa: F811
    coach, athlete = await _user(conn), await _user(conn)
    await conn.execute("INSERT INTO coach_profiles (user_id, full_name, sport) VALUES ($1, 'Тренер', 'Теннис')", coach)
    begun, ahead = [
        await conn.fetchval(
            "INSERT INTO bookings (coach_user_id, athlete_user_id, starts_at, duration_minutes, format, currency, status) "
            f"VALUES ($1, $2, {session_time.sql_wall_now()} + make_interval(mins => $3), 60, 'online', 'RUB', 'pending') RETURNING id",
            coach, athlete, minutes,
        )
        for minutes in (-60, 90)
    ]
    # (one hour after the start the old `starts_at < now()` still saw two hours to go)
    expired = await bookings_repo.sweep_expired(conn, older_than=datetime.now(timezone.utc) - timedelta(hours=24))
    assert [row["id"] for row in expired] == [begun]
    assert await conn.fetchval("SELECT status FROM bookings WHERE id = $1", ahead) == "pending"


async def test_queued_reminders_are_moved_to_the_real_moment_by_patch_0044(conn) -> None:  # noqa: F811
    from app.config import DATABASE_DIR

    owner = await _user(conn)
    today = session_time.wall_today()

    async def training_with_reminder(day: date, at: str) -> tuple[object, object]:
        training = await conn.fetchval(
            "INSERT INTO trainings (created_by, type, training_date, start_time, duration_minutes, reminder_minutes_before) "
            "VALUES ($1, 'personal', $2, $3::time, 60, 60) RETURNING id",
            owner, day, time.fromisoformat(at),
        )
        old_send_at = datetime.combine(day, time.fromisoformat(at), tzinfo=timezone.utc) - timedelta(minutes=60)  # the old way
        reminder = await conn.fetchval(
            "INSERT INTO notifications (user_id, category, title, body, entity_type, entity_id, send_at, dedup_key) "
            "VALUES ($1, 'training_reminder', 'Скоро тренировка', 'x', 'training', $2, $3, $4) RETURNING id",
            owner, training, old_send_at, f"training_reminder:{training}:{owner}",
        )
        return training, reminder

    _future, coming = await training_with_reminder(today + timedelta(days=3), "10:00")
    _past, stale = await training_with_reminder(today - timedelta(days=1), "10:00")

    await conn.execute((DATABASE_DIR / "patches" / "0044_training_reminders_session_time.sql").read_text(encoding="utf-8"))

    moved = await conn.fetchrow("SELECT send_at, status FROM notifications WHERE id = $1", coming)
    assert moved["status"] == "pending"
    assert moved["send_at"] == session_time.instant_of(today + timedelta(days=3), time(9, 0))
    assert await conn.fetchval("SELECT status FROM notifications WHERE id = $1", stale) == "cancelled"

    # running it again changes nothing
    await conn.execute((DATABASE_DIR / "patches" / "0044_training_reminders_session_time.sql").read_text(encoding="utf-8"))
    assert await conn.fetchval("SELECT send_at FROM notifications WHERE id = $1", coming) == moved["send_at"]
