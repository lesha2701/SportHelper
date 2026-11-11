"""Session times on the platform's clock (REF-19).

Coach hours, bookings, trainings and matches are wall-clock times ("в 10:00") of one platform zone, SESSION_TIMEZONE
(Europe/Moscow by default; users have no zone of their own). `bookings.starts_at` keeps that wall-clock time with a UTC
label: 10:00Z means "10:00 in Moscow", and the website, iOS and Android all show its UTC hours as they are. Trainings and
matches keep a plain DATE + TIME.

So a session time is never compared with the real current moment (`now()`, `datetime.now(timezone.utc)`) directly — for
Moscow that runs every rule three hours late. Two rules instead:

* "has it started / is it over / how long is left": compare the stored time with `wall_now()` (Python) or `sql_wall_now()`
  (SQL) — the current moment written the same way. "Which day is today" is `wall_today()` / `sql_wall_today()`.
* a moment for the real world's queue (a reminder's `send_at`): turn the session time into a real instant with
  `instant_of()` / `instant_of_wall()`.

Durations measured on the wall clock differ from real ones only across a daylight-saving change (Moscow has none).
"""
from __future__ import annotations

from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from app.config import get_settings

# The API contract's words for every session time sent as a date-time (starts_at, free_cancel_until, next_available_slot).
WALL_CLOCK_DOC = (
    "The session's wall-clock time on the platform's clock (SESSION_TIMEZONE, Europe/Moscow) written with a UTC label: "
    "10:00Z means 10:00 in Moscow. Show its UTC hours as they are; do not convert it to the device's time zone, and do not "
    "compare it with the device's clock (use has_started / can_cancel)."
)


def zone_name() -> str:
    return get_settings().session_timezone


def zone() -> ZoneInfo:
    return ZoneInfo(zone_name())


def wall_now(now: datetime | None = None) -> datetime:
    """The current moment (or the real instant `now`) as the platform's wall clock reads it, with a UTC label — the form
    `bookings.starts_at` is kept in, so the two compare directly."""
    real = now or datetime.now(timezone.utc)
    return real.astimezone(zone()).replace(tzinfo=timezone.utc)


def wall_today(now: datetime | None = None) -> date:
    """Today's date on the platform's clock (not the server's, not UTC's)."""
    return wall_now(now).date()


def instant_of_wall(wall: datetime) -> datetime:
    """The real instant (in UTC) of a wall-clock time kept with a UTC label, e.g. bookings.starts_at."""
    return wall.astimezone(timezone.utc).replace(tzinfo=zone()).astimezone(timezone.utc)


def instant_of(day: date, at: time) -> datetime:
    """The real instant (in UTC) of a training's / match's date and time."""
    return datetime.combine(day, at.replace(tzinfo=None), tzinfo=zone()).astimezone(timezone.utc)


def sql_wall_now() -> str:
    """SQL for wall_now(): compares directly with bookings.starts_at. The zone name is validated by Settings."""
    return f"((now() AT TIME ZONE '{zone_name()}') AT TIME ZONE 'UTC')"


def sql_wall_today() -> str:
    """SQL for wall_today(): compares directly with trainings.training_date / matches.match_date (instead of CURRENT_DATE,
    which is the database session's date — UTC on the server)."""
    return f"((now() AT TIME ZONE '{zone_name()}')::date)"
