from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest

from app.config import Settings
from app.services import background, nudges


def _settings(**overrides) -> Settings:
    return Settings(TELEGRAM_BOT_TOKEN="x", JWT_SECRET="x", **overrides)


# 17:00-20:00 Europe/Moscow == 14:00-17:00 UTC
_IN_WINDOW = datetime(2026, 10, 7, 15, 0, tzinfo=timezone.utc)
_BEFORE_WINDOW = datetime(2026, 10, 7, 13, 59, tzinfo=timezone.utc)
_AFTER_WINDOW = datetime(2026, 10, 7, 17, 0, tzinfo=timezone.utc)


def test_send_window_is_in_the_configured_timezone() -> None:
    s = _settings()

    assert nudges.in_send_window(s, _IN_WINDOW)
    assert nudges.in_send_window(s, datetime(2026, 10, 7, 14, 0, tzinfo=timezone.utc))  # 17:00 local, inclusive
    assert not nudges.in_send_window(s, _BEFORE_WINDOW)
    assert not nudges.in_send_window(s, _AFTER_WINDOW)  # 20:00 local, exclusive


class _FakeRepos:
    """Stands in for the SQL-backed repo functions the service calls."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch, candidates: list[dict], open_tasks: dict | None = None) -> None:
        self.candidate_calls: list[dict] = []
        self.created: list[dict] = []
        self._candidates = candidates
        self._open_tasks = open_tasks or {}

        async def list_candidates(conn, **kwargs):
            self.candidate_calls.append(kwargs)
            return self._candidates

        async def count_open(conn, user_ids):
            return {u: n for u, n in self._open_tasks.items() if u in user_ids}

        async def create(conn, **kwargs):
            self.created.append(kwargs)

        monkeypatch.setattr(nudges.notifications_repo, "list_nudge_candidates", list_candidates)
        monkeypatch.setattr(nudges.tasks_repo, "count_open_assignments_for_users", count_open)
        monkeypatch.setattr(nudges.notifications_repo, "create_or_reschedule", create)


async def test_nothing_is_queued_outside_the_window_or_when_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    repos = _FakeRepos(monkeypatch, [{"user_id": uuid4(), "has_player_profile": True}])

    assert await nudges.schedule_training_nudges(None, _settings(), now=_BEFORE_WINDOW) == 0
    assert await nudges.schedule_training_nudges(None, _settings(NUDGE_ENABLED="false"), now=_IN_WINDOW) == 0

    assert repos.candidate_calls == [] and repos.created == []


async def test_queues_one_nudge_per_candidate_with_the_policy_applied(monkeypatch: pytest.MonkeyPatch) -> None:
    busy, idle = uuid4(), uuid4()
    repos = _FakeRepos(
        monkeypatch,
        [{"user_id": busy, "has_player_profile": True}, {"user_id": idle, "has_player_profile": True}],
        open_tasks={busy: 3},
    )

    queued = await nudges.schedule_training_nudges(None, _settings(), now=_IN_WINDOW)

    assert queued == 2
    # the candidate query got the policy: inactivity, minimum gap, unanswered cap, batch size
    call = repos.candidate_calls[0]
    assert call["inactive_before"] == _IN_WINDOW - timedelta(hours=24)
    assert call["min_gap_after"] == _IN_WINDOW - timedelta(hours=40)
    assert call["max_unanswered"] == 3 and call["limit"] == 200
    by_user = {c["user_id"]: c for c in repos.created}
    for user_id, created in by_user.items():
        assert created["category"] == "training_nudge"
        assert created["entity_type"] == "user" and created["entity_id"] == user_id  # deep link needs an id
        assert created["send_at"] == _IN_WINDOW
        assert created["dedup_key"] == f"training_nudge:{user_id}:2026-10-07"  # one per user per local day
    assert "3 невыполненных задания" in by_user[busy]["body"]
    assert "невыполнен" not in by_user[idle]["body"]


async def test_no_candidates_queues_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    repos = _FakeRepos(monkeypatch, [])

    assert await nudges.schedule_training_nudges(None, _settings(), now=_IN_WINDOW) == 0
    assert repos.created == []


def test_message_variants() -> None:
    user = UUID(int=7)
    today = date(2026, 10, 7)

    assert "1 невыполненное задание" in nudges.build_nudge_message(open_tasks=1, has_player_profile=True, user_id=user, today=today)[1]
    assert "2 невыполненных задания" in nudges.build_nudge_message(open_tasks=2, has_player_profile=True, user_id=user, today=today)[1]
    assert "5 невыполненных заданий" in nudges.build_nudge_message(open_tasks=5, has_player_profile=True, user_id=user, today=today)[1]
    assert "11 невыполненных заданий" in nudges.build_nudge_message(open_tasks=11, has_player_profile=True, user_id=user, today=today)[1]
    assert "21 невыполненное задание" in nudges.build_nudge_message(open_tasks=21, has_player_profile=True, user_id=user, today=today)[1]
    title, body = nudges.build_nudge_message(open_tasks=0, has_player_profile=False, user_id=user, today=today)
    assert "профиль" in body.lower()


def test_generic_message_rotates_from_day_to_day() -> None:
    user = UUID(int=7)
    texts = {
        nudges.build_nudge_message(open_tasks=0, has_player_profile=True, user_id=user, today=date(2026, 10, 1) + timedelta(days=i))
        for i in range(4)
    }

    assert len(texts) == 4  # a different line each day, no copy-paste feel


async def test_background_checks_for_nudges_at_most_every_ten_minutes(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[datetime] = []

    async def fake_schedule(conn, settings, *, now):
        calls.append(now)
        return 0

    monkeypatch.setattr(background.nudges_service, "schedule_training_nudges", fake_schedule)
    monkeypatch.setattr(background, "_last_nudge_check", None)

    await background.schedule_training_nudges(None, _settings())
    await background.schedule_training_nudges(None, _settings())  # the next 30s tick

    assert len(calls) == 1


async def test_a_failure_in_nudge_scheduling_never_breaks_the_tick(monkeypatch: pytest.MonkeyPatch) -> None:
    async def boom(conn, settings, *, now):
        raise RuntimeError("db hiccup")

    monkeypatch.setattr(background.nudges_service, "schedule_training_nudges", boom)
    monkeypatch.setattr(background, "_last_nudge_check", None)

    await background.schedule_training_nudges(None, _settings())  # must not raise
