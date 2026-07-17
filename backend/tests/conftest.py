from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlencode
from uuid import uuid4

import asyncpg
import pytest
from fastapi.testclient import TestClient

BOT_TOKEN = "123456:test-bot-token"

_shared_disk_storage: dict[str, bytes] = {}


class _FakeYandexDiskClient:
    """In-memory stand-in for YandexDiskClient so tests never hit the real
    Yandex.Disk API or require a configured OAuth token."""

    def __init__(self, settings):
        self.storage: dict[str, bytes] = _shared_disk_storage

    async def ensure_folder(self, path: str) -> None:
        return None

    async def upload(self, path: str, content) -> None:
        chunks = []
        async for chunk in content:
            chunks.append(chunk)
        self.storage[path] = b"".join(chunks)

    async def stream_download(self, path: str):
        yield self.storage.get(path, b"")


@pytest.fixture(autouse=True)
def _fake_disk(monkeypatch: pytest.MonkeyPatch):
    """Replaces YandexDiskClient everywhere it's imported (the download path
    in api.routes.files, and the upload path in services.uploads) so tests
    never hit the real Yandex.Disk API even if a real token is configured
    in the developer's .env."""
    _shared_disk_storage.clear()
    import app.api.routes.files as files_module
    import app.services.uploads as uploads_module

    monkeypatch.setattr(files_module, "YandexDiskClient", _FakeYandexDiskClient)
    monkeypatch.setattr(uploads_module, "YandexDiskClient", _FakeYandexDiskClient)


_ai_response_queue: list[str] = []


class _FakeYandexAIClient:
    """In-memory stand-in for YandexAIClient so tests never hit the real
    Yandex AI Studio API or require a configured API key. Tests queue up
    canned responses (JSON text for the draft features, plain text for the
    analysis features) via the queue_ai_response fixture."""

    def __init__(self, settings):
        pass

    async def complete(self, *, system_prompt: str, user_prompt: str) -> str:
        if _ai_response_queue:
            return _ai_response_queue.pop(0)
        return "Заглушка ответа ИИ."


@pytest.fixture(autouse=True)
def _fake_ai(monkeypatch: pytest.MonkeyPatch):
    _ai_response_queue.clear()
    import app.services.ai as ai_service_module

    monkeypatch.setattr(ai_service_module, "YandexAIClient", _FakeYandexAIClient)


@pytest.fixture
def queue_ai_response():
    def _queue(text: str) -> None:
        _ai_response_queue.append(text)

    return _queue


def build_init_data(
    bot_token: str,
    *,
    user_id: int = 123456789,
    first_name: str = "Ivan",
    last_name: str | None = None,
    username: str = "ivanov",
    auth_date: int | None = None,
) -> str:
    """Build a validly-signed Telegram Mini App initData string for tests."""
    user_dict = {"id": user_id, "first_name": first_name, "username": username}
    if last_name is not None:
        user_dict["last_name"] = last_name
    user_payload = json.dumps(user_dict, separators=(",", ":"))
    fields = {
        "auth_date": str(auth_date if auth_date is not None else int(time.time())),
        "query_id": "AAABBBCCC",
        "user": user_payload,
    }
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    computed_hash = hmac.new(
        secret_key, data_check_string.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    fields["hash"] = computed_hash
    return urlencode(fields)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    """A TestClient wired to in-memory fake repositories instead of a real
    database, with TELEGRAM_BOT_TOKEN/JWT_SECRET set to known test values."""
    import app.api.deps as deps
    import app.main as main_module
    import app.repositories.exercises as exercises_module
    import app.repositories.files as files_module
    import app.repositories.plans as plans_module
    import app.repositories.profiles as profiles_module
    import app.repositories.teams as teams_module
    import app.repositories.matches as matches_module
    import app.repositories.metrics as metrics_module
    import app.repositories.notifications as notifications_module
    import app.repositories.reports as reports_module
    import app.repositories.task_templates as task_templates_module
    import app.repositories.tasks as tasks_module
    import app.repositories.trainings as trainings_module
    import app.repositories.training_feedback as training_feedback_module
    import app.repositories.users as users_module
    from app.config import get_settings

    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", BOT_TOKEN)
    monkeypatch.setenv("JWT_SECRET", "test-jwt-secret")
    # The rate limiter is real (not mocked) in tests — a single test can
    # legitimately fire more requests than a human would in a minute, so
    # keep it out of the way here rather than tripping on busy tests.
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "100000")
    # Never let tests fall through to a real YANDEX_DISK_OAUTH_TOKEN that
    # might be sitting in the developer's real .env — routes that forget to
    # mock YandexDiskClient must fail loudly (RuntimeError), not silently
    # hit the real Yandex.Disk API.
    monkeypatch.setenv("YANDEX_DISK_OAUTH_TOKEN", "")
    get_settings.cache_clear()

    class FakePool:
        async def close(self) -> None:
            return None

    async def fake_create_pool(settings):
        return FakePool()

    async def fake_run_migrations(pool):
        return None

    async def fake_start_background_task(pool, settings):
        # The real background loop makes live Telegram API calls — never
        # start it against the fake pool used by the test client.
        return None

    def fake_attach_error_log_handler(pool):
        # Avoid piling up logging.Handler instances on the shared root
        # logger across the whole test session.
        return None

    monkeypatch.setattr(main_module, "create_pool", fake_create_pool)
    monkeypatch.setattr(main_module, "run_migrations", fake_run_migrations)
    monkeypatch.setattr(main_module, "_start_background_task", fake_start_background_task)
    monkeypatch.setattr(main_module, "_attach_error_log_handler", fake_attach_error_log_handler)

    users_store: dict[int, dict] = {}
    player_store: dict = {}
    coach_store: dict = {}

    async def fake_upsert_from_telegram(conn, telegram_user):
        existing = users_store.get(telegram_user.id)
        user = existing or {
            "id": uuid4(),
            "telegram_id": telegram_user.id,
            "created_at": datetime.now(timezone.utc),
            "is_banned": False,
            "banned_at": None,
            "active_mode": None,
        }
        user.update(
            {
                "username": telegram_user.username,
                "first_name": telegram_user.first_name,
                "last_name": telegram_user.last_name,
                "photo_url": telegram_user.photo_url,
                "language_code": telegram_user.language_code,
                "last_login_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }
        )
        users_store[telegram_user.id] = user
        return user

    async def fake_get_by_id(conn, user_id):
        for user in users_store.values():
            if user["id"] == user_id:
                return user
        return None

    async def fake_set_active_mode(conn, user_id, mode):
        for user in users_store.values():
            if user["id"] == user_id:
                user["active_mode"] = mode
                return user
        return None

    async def fake_get_player_profile(conn, user_id):
        return player_store.get(user_id)

    async def fake_get_coach_profile(conn, user_id):
        return coach_store.get(user_id)

    async def fake_upsert_player_profile(conn, user_id, **fields):
        now = datetime.now(timezone.utc)
        profile = player_store.get(user_id) or {"user_id": user_id, "created_at": now}
        profile.update(fields)
        profile["updated_at"] = now
        player_store[user_id] = profile
        return profile

    async def fake_upsert_coach_profile(conn, user_id, **fields):
        now = datetime.now(timezone.utc)
        profile = coach_store.get(user_id) or {"user_id": user_id, "created_at": now}
        profile.update(fields)
        profile["updated_at"] = now
        coach_store[user_id] = profile
        return profile

    monkeypatch.setattr(users_module, "upsert_from_telegram", fake_upsert_from_telegram)
    monkeypatch.setattr(users_module, "get_by_id", fake_get_by_id)
    monkeypatch.setattr(users_module, "set_active_mode", fake_set_active_mode)
    monkeypatch.setattr(profiles_module, "get_player_profile", fake_get_player_profile)
    monkeypatch.setattr(profiles_module, "get_coach_profile", fake_get_coach_profile)
    monkeypatch.setattr(profiles_module, "upsert_player_profile", fake_upsert_player_profile)
    monkeypatch.setattr(profiles_module, "upsert_coach_profile", fake_upsert_coach_profile)

    def _find_user_by_id(user_id):
        for user in users_store.values():
            if user["id"] == user_id:
                return user
        return None

    teams_store: dict = {}
    members_store: dict = {}
    invites_store: dict = {}
    requests_store: dict = {}
    blocks_store: set = set()

    async def fake_create_team(conn, creator_id, data):
        team_id = uuid4()
        now = datetime.now(timezone.utc)
        team = {
            "id": team_id,
            "name": data["name"],
            "description": data.get("description"),
            "sport": data["sport"],
            "age_category": data.get("age_category"),
            "level": data.get("level"),
            "status": "active",
            "created_by": creator_id,
            "logo_file_id": None,
            "created_at": now,
            "updated_at": now,
        }
        teams_store[team_id] = team
        members_store[(team_id, creator_id)] = {
            "team_id": team_id,
            "user_id": creator_id,
            "role": "head_coach",
            "position": None,
            "joined_at": now,
        }
        return dict(team)

    async def fake_get_team(conn, team_id):
        team = teams_store.get(team_id)
        return dict(team) if team else None

    async def fake_update_team(conn, team_id, data):
        team = teams_store[team_id]
        team.update(
            {
                "name": data["name"],
                "description": data.get("description"),
                "sport": data["sport"],
                "age_category": data.get("age_category"),
                "level": data.get("level"),
                "updated_at": datetime.now(timezone.utc),
            }
        )
        return dict(team)

    async def fake_list_my_teams(conn, user_id):
        result = []
        for (team_id, uid), member in members_store.items():
            if uid != user_id:
                continue
            team = teams_store[team_id]
            count = sum(1 for (tid, _uid) in members_store if tid == team_id)
            result.append({**team, "my_role": member["role"], "members_count": count})
        return result

    async def fake_get_member(conn, team_id, user_id):
        member = members_store.get((team_id, user_id))
        return dict(member) if member else None

    async def fake_get_member_detail(conn, team_id, user_id):
        member = members_store.get((team_id, user_id))
        if member is None:
            return None
        user = _find_user_by_id(user_id)
        return {
            "user_id": user_id,
            "telegram_id": user["telegram_id"],
            "first_name": user["first_name"],
            "last_name": user["last_name"],
            "username": user["username"],
            "photo_url": user["photo_url"],
            "role": member["role"],
            "position": member["position"],
            "joined_at": member["joined_at"],
        }

    async def fake_count_members(conn, team_id):
        return sum(1 for (tid, _uid) in members_store if tid == team_id)

    async def fake_get_captain(conn, team_id):
        for (tid, _uid), member in members_store.items():
            if tid == team_id and member["role"] == "captain":
                return dict(member)
        return None

    async def fake_list_members(conn, team_id):
        result = []
        for (tid, uid), member in members_store.items():
            if tid != team_id:
                continue
            user = _find_user_by_id(uid)
            result.append(
                {
                    "user_id": uid,
                    "telegram_id": user["telegram_id"],
                    "first_name": user["first_name"],
                    "last_name": user["last_name"],
                    "username": user["username"],
                    "photo_url": user["photo_url"],
                    "role": member["role"],
                    "position": member["position"],
                    "joined_at": member["joined_at"],
                }
            )
        return result

    async def fake_get_player_position(conn, user_id):
        profile = player_store.get(user_id)
        return profile["position"] if profile else None

    async def fake_update_member(conn, team_id, user_id, *, role, position, position_set):
        member = members_store.get((team_id, user_id))
        if member is None:
            return None
        if role == "captain":
            for (tid, uid2), other in members_store.items():
                if tid == team_id and uid2 != user_id and other["role"] == "captain":
                    raise asyncpg.UniqueViolationError("duplicate key value violates unique constraint")
        if role is not None:
            member["role"] = role
        if position_set:
            member["position"] = position
        return dict(member)

    async def fake_remove_member(conn, team_id, user_id):
        members_store.pop((team_id, user_id), None)

    async def fake_leave_team(conn, team_id, user_id):
        member = members_store.pop((team_id, user_id), None)
        if member is None:
            return None
        if member["role"] == "head_coach":
            teams_store[team_id]["status"] = "without_coach"
        return member["role"]

    async def fake_transfer_ownership(conn, team_id, from_user_id, to_user_id):
        members_store[(team_id, from_user_id)]["role"] = "assistant_coach"
        members_store[(team_id, to_user_id)]["role"] = "head_coach"
        teams_store[team_id]["status"] = "active"

    async def fake_promote_to_head_coach(conn, team_id, user_id):
        now = datetime.now(timezone.utc)
        existing = members_store.get((team_id, user_id))
        if existing:
            existing["role"] = "head_coach"
        else:
            members_store[(team_id, user_id)] = {
                "team_id": team_id,
                "user_id": user_id,
                "role": "head_coach",
                "position": None,
                "joined_at": now,
            }
        teams_store[team_id]["status"] = "active"

    async def fake_block_member(conn, team_id, user_id, blocked_by):
        members_store.pop((team_id, user_id), None)
        blocks_store.add((team_id, user_id))

    async def fake_is_blocked(conn, team_id, user_id):
        return (team_id, user_id) in blocks_store

    async def fake_shares_team_as_coach(conn, coach_id, player_id):
        coach_team_ids = {
            tid for (tid, uid), m in members_store.items() if uid == coach_id and m["role"] in ("head_coach", "assistant_coach")
        }
        player_team_ids = {tid for (tid, uid) in members_store if uid == player_id}
        return bool(coach_team_ids & player_team_ids)

    async def fake_create_invite(conn, team_id, created_by, kind, ttl_hours):
        token = uuid4().hex
        invite_id = uuid4()
        now = datetime.now(timezone.utc)
        invite = {
            "id": invite_id,
            "team_id": team_id,
            "token": token,
            "kind": kind,
            "created_by": created_by,
            "expires_at": now + timedelta(hours=ttl_hours),
            "created_at": now,
        }
        invites_store[token] = invite
        return dict(invite)

    async def fake_list_invites(conn, team_id):
        now = datetime.now(timezone.utc)
        return [dict(inv) for inv in invites_store.values() if inv["team_id"] == team_id and inv["expires_at"] > now]

    async def fake_get_invite_by_token(conn, token):
        invite = invites_store.get(token)
        return dict(invite) if invite else None

    async def fake_get_pending_request(conn, team_id, user_id):
        for req in requests_store.values():
            if req["team_id"] == team_id and req["user_id"] == user_id and req["status"] == "pending":
                return dict(req)
        return None

    async def fake_create_join_request(conn, team_id, user_id, invite_id):
        request_id = uuid4()
        now = datetime.now(timezone.utc)
        request = {
            "id": request_id,
            "team_id": team_id,
            "user_id": user_id,
            "invite_id": invite_id,
            "status": "pending",
            "reviewed_by": None,
            "reviewed_at": None,
            "created_at": now,
        }
        requests_store[request_id] = request
        return dict(request)

    async def fake_list_pending_requests(conn, team_id):
        result = []
        for req in requests_store.values():
            if req["team_id"] != team_id or req["status"] != "pending":
                continue
            user = _find_user_by_id(req["user_id"])
            result.append(
                {
                    "id": req["id"],
                    "team_id": team_id,
                    "user_id": req["user_id"],
                    "first_name": user["first_name"],
                    "last_name": user["last_name"],
                    "username": user["username"],
                    "photo_url": user["photo_url"],
                    "status": req["status"],
                    "created_at": req["created_at"],
                }
            )
        return result

    async def fake_get_request(conn, team_id, request_id):
        req = requests_store.get(request_id)
        if req is None or req["team_id"] != team_id:
            return None
        return dict(req)

    async def fake_accept_request(conn, request_id, team_id, user_id, reviewed_by):
        count = sum(1 for (tid, _uid) in members_store if tid == team_id)
        if count >= 50:
            raise asyncpg.CheckViolationError("team already has the maximum of 50 members")
        req = requests_store[request_id]
        req["status"] = "accepted"
        req["reviewed_by"] = reviewed_by
        req["reviewed_at"] = datetime.now(timezone.utc)
        position = await fake_get_player_position(conn, user_id)
        members_store[(team_id, user_id)] = {
            "team_id": team_id,
            "user_id": user_id,
            "role": "player",
            "position": position,
            "joined_at": datetime.now(timezone.utc),
        }

    async def fake_reject_request(conn, request_id, reviewed_by):
        req = requests_store[request_id]
        req["status"] = "rejected"
        req["reviewed_by"] = reviewed_by
        req["reviewed_at"] = datetime.now(timezone.utc)

    monkeypatch.setattr(teams_module, "create_team", fake_create_team)
    monkeypatch.setattr(teams_module, "get_team", fake_get_team)
    monkeypatch.setattr(teams_module, "update_team", fake_update_team)
    monkeypatch.setattr(teams_module, "list_my_teams", fake_list_my_teams)
    monkeypatch.setattr(teams_module, "get_member", fake_get_member)
    monkeypatch.setattr(teams_module, "get_member_detail", fake_get_member_detail)
    monkeypatch.setattr(teams_module, "count_members", fake_count_members)
    monkeypatch.setattr(teams_module, "get_captain", fake_get_captain)
    monkeypatch.setattr(teams_module, "list_members", fake_list_members)
    monkeypatch.setattr(teams_module, "get_player_position", fake_get_player_position)
    monkeypatch.setattr(teams_module, "update_member", fake_update_member)
    monkeypatch.setattr(teams_module, "remove_member", fake_remove_member)
    monkeypatch.setattr(teams_module, "leave_team", fake_leave_team)
    monkeypatch.setattr(teams_module, "transfer_ownership", fake_transfer_ownership)
    monkeypatch.setattr(teams_module, "promote_to_head_coach", fake_promote_to_head_coach)
    monkeypatch.setattr(teams_module, "block_member", fake_block_member)
    monkeypatch.setattr(teams_module, "is_blocked", fake_is_blocked)
    monkeypatch.setattr(teams_module, "shares_team_as_coach", fake_shares_team_as_coach)
    monkeypatch.setattr(teams_module, "create_invite", fake_create_invite)
    monkeypatch.setattr(teams_module, "list_invites", fake_list_invites)
    monkeypatch.setattr(teams_module, "get_invite_by_token", fake_get_invite_by_token)
    monkeypatch.setattr(teams_module, "get_pending_request", fake_get_pending_request)
    monkeypatch.setattr(teams_module, "create_join_request", fake_create_join_request)
    monkeypatch.setattr(teams_module, "list_pending_requests", fake_list_pending_requests)
    monkeypatch.setattr(teams_module, "get_request", fake_get_request)
    monkeypatch.setattr(teams_module, "accept_request", fake_accept_request)
    monkeypatch.setattr(teams_module, "reject_request", fake_reject_request)

    files_store: dict = {}

    async def fake_create_file(conn, **fields):
        file_id = uuid4()
        now = datetime.now(timezone.utc)
        record = {
            "id": file_id,
            "status": "ready",
            "created_at": now,
            "updated_at": now,
            "deleted_at": None,
            **fields,
        }
        files_store[file_id] = record
        return dict(record)

    async def fake_get_file(conn, file_id):
        record = files_store.get(file_id)
        if record is None or record["deleted_at"] is not None:
            return None
        return dict(record)

    async def fake_replace_team_logo(conn, team_id, new_file_id):
        old_file_id = teams_store[team_id].get("logo_file_id")
        teams_store[team_id]["logo_file_id"] = new_file_id
        if old_file_id is not None and old_file_id in files_store:
            files_store[old_file_id]["deleted_at"] = datetime.now(timezone.utc)
        return old_file_id

    monkeypatch.setattr(files_module, "create_file", fake_create_file)
    monkeypatch.setattr(files_module, "get_file", fake_get_file)
    monkeypatch.setattr(files_module, "replace_team_logo", fake_replace_team_logo)

    exercises_store: dict = {}
    exercise_shares_store: dict = {}  # (exercise_id, team_id) -> shared_by

    async def fake_create_exercise(conn, owner_id, **fields):
        exercise_id = uuid4()
        now = datetime.now(timezone.utc)
        record = {
            "id": exercise_id,
            "owner_id": owner_id,
            "photo_file_id": None,
            "video_file_id": None,
            "created_at": now,
            "updated_at": now,
            **fields,
        }
        exercises_store[exercise_id] = record
        return dict(record)

    async def fake_update_exercise(conn, exercise_id, owner_id, **fields):
        record = exercises_store.get(exercise_id)
        if record is None or record["owner_id"] != owner_id:
            return None
        record.update(fields)
        record["updated_at"] = datetime.now(timezone.utc)
        return dict(record)

    async def fake_get_exercise(conn, exercise_id):
        record = exercises_store.get(exercise_id)
        return dict(record) if record else None

    async def fake_list_owned_exercises(conn, owner_id):
        return [dict(r) for r in exercises_store.values() if r["owner_id"] == owner_id]

    async def fake_list_shared_with_team(conn, team_id):
        ids = [ex_id for (ex_id, t_id) in exercise_shares_store if t_id == team_id]
        return [dict(exercises_store[ex_id]) for ex_id in ids if ex_id in exercises_store]

    async def fake_soft_delete_exercise(conn, exercise_id, owner_id):
        record = exercises_store.get(exercise_id)
        if record is None or record["owner_id"] != owner_id:
            return False
        del exercises_store[exercise_id]
        return True

    async def fake_share_with_team(conn, exercise_id, team_id, shared_by):
        exercise_shares_store[(exercise_id, team_id)] = shared_by

    async def fake_unshare_from_team(conn, exercise_id, team_id):
        exercise_shares_store.pop((exercise_id, team_id), None)

    async def fake_list_shared_team_ids(conn, exercise_id):
        return [t_id for (ex_id, t_id) in exercise_shares_store if ex_id == exercise_id]

    async def fake_list_shared_team_ids_batch(conn, exercise_ids):
        result = {ex_id: [] for ex_id in exercise_ids}
        for (ex_id, t_id) in exercise_shares_store:
            if ex_id in result:
                result[ex_id].append(t_id)
        return result

    monkeypatch.setattr(exercises_module, "create_exercise", fake_create_exercise)
    monkeypatch.setattr(exercises_module, "update_exercise", fake_update_exercise)
    monkeypatch.setattr(exercises_module, "get_exercise", fake_get_exercise)
    monkeypatch.setattr(exercises_module, "list_owned", fake_list_owned_exercises)
    monkeypatch.setattr(exercises_module, "list_shared_with_team", fake_list_shared_with_team)
    monkeypatch.setattr(exercises_module, "soft_delete", fake_soft_delete_exercise)
    monkeypatch.setattr(exercises_module, "share_with_team", fake_share_with_team)
    monkeypatch.setattr(exercises_module, "unshare_from_team", fake_unshare_from_team)
    monkeypatch.setattr(exercises_module, "list_shared_team_ids", fake_list_shared_team_ids)
    monkeypatch.setattr(exercises_module, "list_shared_team_ids_batch", fake_list_shared_team_ids_batch)

    plans_store: dict = {}
    plan_exercises_store: dict = {}
    plan_shares_store: dict = {}  # (plan_id, team_id) -> shared_by

    def _plan_exercise_view(record):
        exercise = exercises_store.get(record["exercise_id"])
        return {**record, "exercise_name": exercise["name"] if exercise else None}

    async def fake_create_plan(conn, owner_id, **fields):
        plan_id = uuid4()
        now = datetime.now(timezone.utc)
        record = {"id": plan_id, "owner_id": owner_id, "created_at": now, "updated_at": now, **fields}
        plans_store[plan_id] = record
        return dict(record)

    async def fake_update_plan(conn, plan_id, owner_id, **fields):
        record = plans_store.get(plan_id)
        if record is None or record["owner_id"] != owner_id:
            return None
        record.update(fields)
        record["updated_at"] = datetime.now(timezone.utc)
        return dict(record)

    async def fake_get_plan(conn, plan_id):
        record = plans_store.get(plan_id)
        return dict(record) if record else None

    async def fake_list_owned_plans(conn, owner_id):
        return [dict(r) for r in plans_store.values() if r["owner_id"] == owner_id]

    async def fake_soft_delete_plan(conn, plan_id, owner_id):
        record = plans_store.get(plan_id)
        if record is None or record["owner_id"] != owner_id:
            return False
        del plans_store[plan_id]
        return True

    async def fake_duplicate_plan(conn, plan_id, owner_id):
        original = plans_store.get(plan_id)
        if original is None or original["owner_id"] != owner_id:
            return None
        new_id = uuid4()
        now = datetime.now(timezone.utc)
        new_plan = {
            **original,
            "id": new_id,
            "name": f"{original['name']} (копия)",
            "created_at": now,
            "updated_at": now,
        }
        plans_store[new_id] = new_plan
        for pe in list(plan_exercises_store.values()):
            if pe["plan_id"] == plan_id:
                new_pe_id = uuid4()
                plan_exercises_store[new_pe_id] = {**pe, "id": new_pe_id, "plan_id": new_id}
        return dict(new_plan)

    async def fake_list_plan_exercises(conn, plan_id):
        items = [_plan_exercise_view(r) for r in plan_exercises_store.values() if r["plan_id"] == plan_id]
        return sorted(items, key=lambda r: (r["section"], r["order_index"]))

    async def fake_add_plan_exercise(conn, plan_id, **fields):
        pe_id = uuid4()
        record = {"id": pe_id, "plan_id": plan_id, **fields}
        plan_exercises_store[pe_id] = record
        return _plan_exercise_view(record)

    async def fake_update_plan_exercise(conn, plan_exercise_id, plan_id, **fields):
        record = plan_exercises_store.get(plan_exercise_id)
        if record is None or record["plan_id"] != plan_id:
            return None
        record.update(fields)
        return _plan_exercise_view(record)

    async def fake_remove_plan_exercise(conn, plan_exercise_id, plan_id):
        record = plan_exercises_store.get(plan_exercise_id)
        if record is None or record["plan_id"] != plan_id:
            return False
        del plan_exercises_store[plan_exercise_id]
        return True

    async def fake_share_plan_with_team(conn, plan_id, team_id, shared_by):
        plan_shares_store[(plan_id, team_id)] = shared_by

    async def fake_unshare_plan_from_team(conn, plan_id, team_id):
        plan_shares_store.pop((plan_id, team_id), None)

    async def fake_list_plan_shared_team_ids(conn, plan_id):
        return [t_id for (p_id, t_id) in plan_shares_store if p_id == plan_id]

    async def fake_list_plan_shared_team_ids_batch(conn, plan_ids):
        result = {p_id: [] for p_id in plan_ids}
        for (p_id, t_id) in plan_shares_store:
            if p_id in result:
                result[p_id].append(t_id)
        return result

    async def fake_list_plans_shared_with_team(conn, team_id):
        ids = [p_id for (p_id, t_id) in plan_shares_store if t_id == team_id]
        return [dict(plans_store[p_id]) for p_id in ids if p_id in plans_store]

    monkeypatch.setattr(plans_module, "create_plan", fake_create_plan)
    monkeypatch.setattr(plans_module, "update_plan", fake_update_plan)
    monkeypatch.setattr(plans_module, "get_plan", fake_get_plan)
    monkeypatch.setattr(plans_module, "list_owned", fake_list_owned_plans)
    monkeypatch.setattr(plans_module, "soft_delete", fake_soft_delete_plan)
    monkeypatch.setattr(plans_module, "duplicate_plan", fake_duplicate_plan)
    monkeypatch.setattr(plans_module, "list_plan_exercises", fake_list_plan_exercises)
    monkeypatch.setattr(plans_module, "add_plan_exercise", fake_add_plan_exercise)
    monkeypatch.setattr(plans_module, "update_plan_exercise", fake_update_plan_exercise)
    monkeypatch.setattr(plans_module, "remove_plan_exercise", fake_remove_plan_exercise)
    monkeypatch.setattr(plans_module, "share_with_team", fake_share_plan_with_team)
    monkeypatch.setattr(plans_module, "unshare_from_team", fake_unshare_plan_from_team)
    monkeypatch.setattr(plans_module, "list_shared_team_ids", fake_list_plan_shared_team_ids)
    monkeypatch.setattr(plans_module, "list_shared_team_ids_batch", fake_list_plan_shared_team_ids_batch)
    monkeypatch.setattr(plans_module, "list_shared_with_team", fake_list_plans_shared_with_team)

    trainings_store: dict = {}
    attendance_store: dict = {}  # (training_id, user_id) -> dict

    def _user_by_id(user_id):
        for u in users_store.values():
            if u["id"] == user_id:
                return u
        return None

    def _attendance_view(training_id, user_id, record):
        user = _user_by_id(user_id)
        return {
            "training_id": training_id,
            "user_id": user_id,
            "telegram_id": user["telegram_id"] if user else 0,
            "first_name": user["first_name"] if user else "",
            "last_name": user.get("last_name") if user else None,
            "photo_url": user.get("photo_url") if user else None,
            "status": record["status"],
            "marked_by": record["marked_by"],
            "marked_at": record["marked_at"],
        }

    async def fake_create_training(conn, created_by, **fields):
        training_id = uuid4()
        now = datetime.now(timezone.utc)
        record = {
            "id": training_id,
            "created_by": created_by,
            "status": "scheduled",
            "recurrence_group_id": None,
            "created_at": now,
            "updated_at": now,
            **fields,
        }
        trainings_store[training_id] = record
        return dict(record)

    async def fake_create_recurring_series(conn, created_by, dates, **fields):
        group_id = uuid4()
        created = []
        for training_date in dates:
            record = await fake_create_training(
                conn, created_by, training_date=training_date, recurrence_group_id=group_id, **fields
            )
            created.append(record)
        return created

    async def fake_get_training(conn, training_id):
        record = trainings_store.get(training_id)
        return dict(record) if record else None

    async def fake_update_training(conn, training_id, **fields):
        record = trainings_store.get(training_id)
        if record is None:
            return None
        record.update(fields)
        record["updated_at"] = datetime.now(timezone.utc)
        return dict(record)

    async def fake_soft_delete_training(conn, training_id):
        if training_id in trainings_store:
            del trainings_store[training_id]
            return True
        return False

    async def fake_cancel_series(conn, recurrence_group_id):
        count = 0
        for record in trainings_store.values():
            if record.get("recurrence_group_id") == recurrence_group_id and record["status"] != "cancelled":
                record["status"] = "cancelled"
                count += 1
        return count

    def _sort_upcoming_first(records):
        today = date.today()
        # Upcoming trainings ascending (soonest first), then past ones descending (most recent first).
        upcoming = sorted((r for r in records if r["training_date"] >= today), key=lambda r: (r["training_date"], r["start_time"]))
        past = sorted((r for r in records if r["training_date"] < today), key=lambda r: (r["training_date"], r["start_time"]), reverse=True)
        return upcoming + past

    async def fake_list_team_trainings(conn, team_id):
        records = [dict(r) for r in trainings_store.values() if r.get("team_id") == team_id]
        return _sort_upcoming_first(records)

    async def fake_list_personal_trainings(conn, owner_id):
        records = [
            dict(r) for r in trainings_store.values() if r.get("type") == "personal" and r["created_by"] == owner_id
        ]
        return _sort_upcoming_first(records)

    async def fake_ensure_attendance_initialized(conn, training_id, team_id):
        for team_key, user_key in list(members_store.keys()):
            if team_key != team_id:
                continue
            if (training_id, user_key) not in attendance_store:
                attendance_store[(training_id, user_key)] = {
                    "status": "present",
                    "marked_by": None,
                    "marked_at": datetime.now(timezone.utc),
                }

    async def fake_list_attendance(conn, training_id):
        return [
            _attendance_view(t_id, u_id, record)
            for (t_id, u_id), record in attendance_store.items()
            if t_id == training_id
        ]

    async def fake_get_attendance_for_user(conn, training_id, user_id):
        record = attendance_store.get((training_id, user_id))
        return _attendance_view(training_id, user_id, record) if record else None

    async def fake_set_attendance_status(conn, training_id, user_id, status, marked_by):
        record = attendance_store.get((training_id, user_id))
        if record is None:
            return None
        record["status"] = status
        record["marked_by"] = marked_by
        record["marked_at"] = datetime.now(timezone.utc)
        return _attendance_view(training_id, user_id, record)

    async def fake_list_recurrence_group(conn, recurrence_group_id):
        return [dict(r) for r in trainings_store.values() if r.get("recurrence_group_id") == recurrence_group_id]

    async def fake_list_calendar_trainings(conn, user_id, date_from, date_to):
        my_team_ids = {tid for (tid, uid) in members_store if uid == user_id}
        result = []
        for record in trainings_store.values():
            if not (date_from <= record["training_date"] <= date_to):
                continue
            if record["type"] == "personal":
                if record["created_by"] != user_id:
                    continue
            elif record.get("team_id") not in my_team_ids:
                continue
            team = teams_store.get(record.get("team_id"))
            result.append(
                {
                    "id": record["id"],
                    "type": record["type"],
                    "training_date": record["training_date"],
                    "start_time": record["start_time"],
                    "status": record["status"],
                    "team_id": record.get("team_id"),
                    "team_name": team["name"] if team else None,
                }
            )
        return sorted(result, key=lambda r: (r["training_date"], r["start_time"]))

    async def fake_count_team_trainings_summary(conn, team_id):
        today = date.today()
        completed = upcoming = independent = 0
        for r in trainings_store.values():
            if r.get("team_id") != team_id or r.get("type") not in ("team", "independent"):
                continue
            if r["training_date"] <= today:
                completed += 1
            else:
                upcoming += 1
            if r["type"] == "independent":
                independent += 1
        return {"completed": completed, "upcoming": upcoming, "independent": independent}

    async def fake_team_player_attendance(conn, team_id):
        today = date.today()
        result = []
        for (tid, uid) in members_store:
            if tid != team_id:
                continue
            user = _user_by_id(uid)
            present = absent = 0
            for (t_id, u_id), record in attendance_store.items():
                if u_id != uid:
                    continue
                training = trainings_store.get(t_id)
                if training is None or training.get("team_id") != team_id or training.get("type") not in ("team", "independent"):
                    continue
                if training["training_date"] > today:
                    continue
                if record["status"] == "present":
                    present += 1
                elif record["status"] == "absent":
                    absent += 1
            result.append(
                {
                    "user_id": uid,
                    "first_name": user["first_name"] if user else "",
                    "last_name": user.get("last_name") if user else None,
                    "present_count": present,
                    "absent_count": absent,
                }
            )
        return result

    async def fake_player_attendance_summary(conn, user_id):
        today = date.today()
        present = total = minutes = 0
        for (t_id, u_id), record in attendance_store.items():
            if u_id != user_id:
                continue
            training = trainings_store.get(t_id)
            if training is None or training.get("type") not in ("team", "independent"):
                continue
            if training["training_date"] > today:
                continue
            total += 1
            if record["status"] == "present":
                present += 1
                minutes += training.get("duration_minutes", 0)
        return {"present_count": present, "total_count": total, "minutes_present": minutes}

    async def fake_player_training_counts(conn, user_id):
        today = date.today()
        count = minutes = 0
        for r in trainings_store.values():
            if r.get("type") == "personal" and r["created_by"] == user_id and r["training_date"] <= today:
                count += 1
                minutes += r.get("duration_minutes", 0)
        return {"personal_count": count, "personal_minutes": minutes}

    async def fake_player_attendance_history(conn, user_id):
        today = date.today()
        rows = []
        for (t_id, u_id), record in attendance_store.items():
            if u_id != user_id:
                continue
            training = trainings_store.get(t_id)
            if training is None or training.get("type") not in ("team", "independent") or training["training_date"] > today:
                continue
            rows.append(
                {"status": record["status"], "training_date": training["training_date"], "start_time": training["start_time"]}
            )
        rows.sort(key=lambda r: (r["training_date"], r["start_time"]), reverse=True)
        return rows

    monkeypatch.setattr(trainings_module, "create_training", fake_create_training)
    monkeypatch.setattr(trainings_module, "create_recurring_series", fake_create_recurring_series)
    monkeypatch.setattr(trainings_module, "get_training", fake_get_training)
    monkeypatch.setattr(trainings_module, "update_training", fake_update_training)
    monkeypatch.setattr(trainings_module, "soft_delete", fake_soft_delete_training)
    monkeypatch.setattr(trainings_module, "cancel_series", fake_cancel_series)
    monkeypatch.setattr(trainings_module, "list_recurrence_group", fake_list_recurrence_group)
    monkeypatch.setattr(trainings_module, "list_team_trainings", fake_list_team_trainings)
    monkeypatch.setattr(trainings_module, "list_personal_trainings", fake_list_personal_trainings)
    monkeypatch.setattr(trainings_module, "list_calendar_trainings", fake_list_calendar_trainings)
    monkeypatch.setattr(trainings_module, "count_team_trainings_summary", fake_count_team_trainings_summary)
    monkeypatch.setattr(trainings_module, "team_player_attendance", fake_team_player_attendance)
    monkeypatch.setattr(trainings_module, "player_attendance_summary", fake_player_attendance_summary)
    monkeypatch.setattr(trainings_module, "player_training_counts", fake_player_training_counts)
    monkeypatch.setattr(trainings_module, "player_attendance_history", fake_player_attendance_history)
    monkeypatch.setattr(trainings_module, "ensure_attendance_initialized", fake_ensure_attendance_initialized)
    monkeypatch.setattr(trainings_module, "list_attendance", fake_list_attendance)
    monkeypatch.setattr(trainings_module, "get_attendance_for_user", fake_get_attendance_for_user)
    monkeypatch.setattr(trainings_module, "set_attendance_status", fake_set_attendance_status)

    training_feedback_store: dict = {}  # (training_id, user_id) -> dict

    async def fake_get_feedback(conn, training_id, user_id):
        record = training_feedback_store.get((training_id, user_id))
        return dict(record) if record else None

    async def fake_upsert_feedback(conn, training_id, user_id, *, wellbeing, difficulty, comment):
        now = datetime.now(timezone.utc)
        record = {
            "training_id": training_id, "user_id": user_id,
            "wellbeing": wellbeing, "difficulty": difficulty, "comment": comment,
            "skipped": False, "created_at": now,
        }
        training_feedback_store[(training_id, user_id)] = record
        return dict(record)

    async def fake_mark_skipped(conn, training_id, user_id):
        existing = training_feedback_store.get((training_id, user_id))
        record = dict(existing) if existing else {
            "training_id": training_id, "user_id": user_id,
            "wellbeing": None, "difficulty": None, "comment": None,
            "created_at": datetime.now(timezone.utc),
        }
        record["skipped"] = True
        training_feedback_store[(training_id, user_id)] = record
        return dict(record)

    monkeypatch.setattr(training_feedback_module, "get_feedback", fake_get_feedback)
    monkeypatch.setattr(training_feedback_module, "upsert_feedback", fake_upsert_feedback)
    monkeypatch.setattr(training_feedback_module, "mark_skipped", fake_mark_skipped)

    reports_store: dict = {}  # training_id -> dict

    async def fake_upsert_report(conn, training_id, submitted_by, text_report):
        now = datetime.now(timezone.utc)
        existing = reports_store.get(training_id)
        record = {
            "training_id": training_id,
            "submitted_by": submitted_by,
            "text_report": text_report,
            "photo_file_id": existing["photo_file_id"] if existing else None,
            "video_file_id": existing["video_file_id"] if existing else None,
            "status": "pending",
            "coach_comment": None,
            "reviewed_by": None,
            "reviewed_at": None,
            "created_at": existing["created_at"] if existing else now,
            "updated_at": now,
        }
        reports_store[training_id] = record
        return dict(record)

    async def fake_get_report(conn, training_id):
        record = reports_store.get(training_id)
        return dict(record) if record else None

    async def fake_set_report_photo(conn, training_id, file_id):
        record = reports_store.get(training_id)
        if record is None:
            return None
        record["photo_file_id"] = file_id
        record["updated_at"] = datetime.now(timezone.utc)
        return dict(record)

    async def fake_set_report_video(conn, training_id, file_id):
        record = reports_store.get(training_id)
        if record is None:
            return None
        record["video_file_id"] = file_id
        record["updated_at"] = datetime.now(timezone.utc)
        return dict(record)

    async def fake_review_report(conn, training_id, reviewed_by, status, coach_comment):
        record = reports_store.get(training_id)
        if record is None:
            return None
        record["status"] = status
        record["coach_comment"] = coach_comment
        record["reviewed_by"] = reviewed_by
        record["reviewed_at"] = datetime.now(timezone.utc)
        return dict(record)

    async def fake_report_coach_comments(conn, user_id, limit=20):
        result = []
        for record in reports_store.values():
            if record["submitted_by"] != user_id or not record.get("coach_comment"):
                continue
            result.append(
                {"context": "Отчёт о тренировке", "comment": record["coach_comment"], "commented_at": record.get("reviewed_at")}
            )
        result.sort(key=lambda c: c["commented_at"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return result[:limit]

    async def fake_list_recent_team_reports(conn, team_id, limit=10):
        result = []
        for record in reports_store.values():
            training = trainings_store.get(record["training_id"])
            if training is None or training.get("team_id") != team_id:
                continue
            result.append({"training_date": training["training_date"], "text_report": record["text_report"]})
        result.sort(key=lambda r: r["training_date"], reverse=True)
        return result[:limit]

    monkeypatch.setattr(reports_module, "upsert_report", fake_upsert_report)
    monkeypatch.setattr(reports_module, "get_report", fake_get_report)
    monkeypatch.setattr(reports_module, "set_photo", fake_set_report_photo)
    monkeypatch.setattr(reports_module, "set_video", fake_set_report_video)
    monkeypatch.setattr(reports_module, "review_report", fake_review_report)
    monkeypatch.setattr(reports_module, "list_recent_team_reports", fake_list_recent_team_reports)
    monkeypatch.setattr(reports_module, "player_coach_comments", fake_report_coach_comments)

    tasks_store: dict = {}
    task_exercises_store: dict = {}
    task_assignments_store: dict = {}  # (task_id, user_id) -> dict

    def _assignment_view(record):
        task = tasks_store.get(record["task_id"])
        team_id = task["team_id"] if task else None
        user = _user_by_id(record["user_id"])
        member = members_store.get((team_id, record["user_id"])) if team_id else None
        return {
            "id": record["id"],
            "task_id": record["task_id"],
            "user_id": record["user_id"],
            "telegram_id": user["telegram_id"] if user else 0,
            "first_name": user["first_name"] if user else "",
            "last_name": user.get("last_name") if user else None,
            "photo_url": user.get("photo_url") if user else None,
            "position": member["position"] if member else None,
            "status": record["status"],
            "comment": record.get("comment"),
            "photo_file_id": record.get("photo_file_id"),
            "video_file_id": record.get("video_file_id"),
            "sets": record.get("sets"),
            "reps": record.get("reps"),
            "duration_minutes": record.get("duration_minutes"),
            "metric_value": record.get("metric_value"),
            "difficulty": record.get("difficulty"),
            "wellbeing": record.get("wellbeing"),
            "coach_comment": record.get("coach_comment"),
            "reviewed_by": record.get("reviewed_by"),
            "reviewed_at": record.get("reviewed_at"),
            "viewed_at": record.get("viewed_at"),
            "submitted_at": record.get("submitted_at"),
            "created_at": record["created_at"],
            "updated_at": record["updated_at"],
        }

    _TASK_VIEW_FIELDS = (
        "team_id", "created_by", "title", "description", "plan_id", "deadline",
        "metric_name", "metric_unit", "metric_target",
        "require_comment", "require_photo", "require_video", "require_sets_reps",
        "require_duration", "require_metric_value", "require_difficulty", "require_wellbeing",
        "target_type", "target_position", "target_training_id",
    )

    def _task_view(task):
        view = {"id": task["id"]}
        for field in _TASK_VIEW_FIELDS:
            view[field] = task.get(field)
        view["created_at"] = task["created_at"]
        view["updated_at"] = task["updated_at"]
        return view

    async def fake_create_task(conn, team_id, created_by, **fields):
        task_id = uuid4()
        now = datetime.now(timezone.utc)
        record = {"id": task_id, "team_id": team_id, "created_by": created_by, "created_at": now, "updated_at": now, **fields}
        tasks_store[task_id] = record
        return dict(record)

    async def fake_get_task(conn, task_id):
        record = tasks_store.get(task_id)
        return dict(record) if record else None

    async def fake_update_task(conn, task_id, **fields):
        record = tasks_store.get(task_id)
        if record is None:
            return None
        record.update(fields)
        record["updated_at"] = datetime.now(timezone.utc)
        return dict(record)

    async def fake_soft_delete_task(conn, task_id):
        if task_id in tasks_store:
            del tasks_store[task_id]
            return True
        return False

    async def fake_list_team_tasks(conn, team_id):
        return [dict(r) for r in tasks_store.values() if r["team_id"] == team_id]

    async def fake_set_task_exercises(conn, task_id, exercise_ids):
        for te_id in [k for k, v in task_exercises_store.items() if v["task_id"] == task_id]:
            del task_exercises_store[te_id]
        for index, exercise_id in enumerate(exercise_ids):
            te_id = uuid4()
            task_exercises_store[te_id] = {
                "id": te_id, "task_id": task_id, "exercise_id": exercise_id, "order_index": index
            }

    async def fake_list_task_exercises(conn, task_id):
        items = sorted(
            (v for v in task_exercises_store.values() if v["task_id"] == task_id),
            key=lambda r: r["order_index"],
        )
        result = []
        for item in items:
            exercise = exercises_store.get(item["exercise_id"])
            result.append({**item, "exercise_name": exercise["name"] if exercise else None})
        return result

    async def fake_bulk_create_assignments(conn, task_id, user_ids):
        now = datetime.now(timezone.utc)
        for user_id in user_ids:
            key = (task_id, user_id)
            if key in task_assignments_store:
                continue
            task_assignments_store[key] = {
                "id": uuid4(), "task_id": task_id, "user_id": user_id, "status": "assigned",
                "comment": None, "photo_file_id": None, "video_file_id": None,
                "sets": None, "reps": None, "duration_minutes": None, "metric_value": None,
                "difficulty": None, "wellbeing": None, "coach_comment": None,
                "reviewed_by": None, "reviewed_at": None, "viewed_at": None, "submitted_at": None,
                "created_at": now, "updated_at": now,
            }

    async def fake_get_assignment(conn, task_id, user_id):
        record = task_assignments_store.get((task_id, user_id))
        return _assignment_view(record) if record else None

    async def fake_list_assignments(conn, task_id):
        return [
            _assignment_view(r) for (t_id, _uid), r in task_assignments_store.items() if t_id == task_id
        ]

    async def fake_list_assignments_for_tasks(conn, task_ids, user_id=None):
        result = {t_id: [] for t_id in task_ids}
        for (t_id, u_id), record in task_assignments_store.items():
            if t_id not in result:
                continue
            if user_id is not None and u_id != user_id:
                continue
            result[t_id].append(_assignment_view(record))
        return result

    async def fake_list_my_assignments(conn, user_id):
        result = []
        for (t_id, u_id), record in task_assignments_store.items():
            if u_id != user_id:
                continue
            task = tasks_store.get(t_id)
            if task is None:
                continue
            result.append({"assignment": _assignment_view(record), "task": _task_view(task)})
        return result

    async def fake_mark_viewed(conn, task_id, user_id):
        record = task_assignments_store.get((task_id, user_id))
        if record and record["status"] == "assigned":
            record["status"] = "viewed"
            record["viewed_at"] = datetime.now(timezone.utc)
            record["updated_at"] = datetime.now(timezone.utc)
        return _assignment_view(record) if record else None

    async def fake_start_assignment(conn, task_id, user_id):
        record = task_assignments_store.get((task_id, user_id))
        if record is None or record["status"] not in ("assigned", "viewed"):
            return None
        record["status"] = "in_progress"
        record["updated_at"] = datetime.now(timezone.utc)
        return _assignment_view(record)

    async def fake_submit_assignment(conn, task_id, user_id, **fields):
        record = task_assignments_store.get((task_id, user_id))
        if record is None or record["status"] == "cancelled":
            return None
        record.update(fields)
        record["status"] = "submitted"
        record["submitted_at"] = datetime.now(timezone.utc)
        record["coach_comment"] = None
        record["reviewed_by"] = None
        record["reviewed_at"] = None
        record["updated_at"] = datetime.now(timezone.utc)
        return _assignment_view(record)

    async def fake_set_assignment_photo(conn, task_id, user_id, file_id):
        record = task_assignments_store.get((task_id, user_id))
        if record is None:
            return None
        record["photo_file_id"] = file_id
        record["updated_at"] = datetime.now(timezone.utc)
        return _assignment_view(record)

    async def fake_set_assignment_video(conn, task_id, user_id, file_id):
        record = task_assignments_store.get((task_id, user_id))
        if record is None:
            return None
        record["video_file_id"] = file_id
        record["updated_at"] = datetime.now(timezone.utc)
        return _assignment_view(record)

    async def fake_review_assignment(conn, task_id, user_id, reviewed_by, status, coach_comment):
        record = task_assignments_store.get((task_id, user_id))
        if record is None:
            return None
        record["status"] = status
        record["coach_comment"] = coach_comment
        record["reviewed_by"] = reviewed_by
        record["reviewed_at"] = datetime.now(timezone.utc)
        record["updated_at"] = datetime.now(timezone.utc)
        return _assignment_view(record)

    async def fake_cancel_open_assignments(conn, task_id):
        now = datetime.now(timezone.utc)
        for (t_id, _uid), record in task_assignments_store.items():
            if t_id == task_id and record["status"] not in ("accepted", "cancelled"):
                record["status"] = "cancelled"
                record["updated_at"] = now

    monkeypatch.setattr(tasks_module, "create_task", fake_create_task)
    monkeypatch.setattr(tasks_module, "get_task", fake_get_task)
    monkeypatch.setattr(tasks_module, "update_task", fake_update_task)
    monkeypatch.setattr(tasks_module, "soft_delete", fake_soft_delete_task)
    monkeypatch.setattr(tasks_module, "list_team_tasks", fake_list_team_tasks)
    monkeypatch.setattr(tasks_module, "set_task_exercises", fake_set_task_exercises)
    monkeypatch.setattr(tasks_module, "list_task_exercises", fake_list_task_exercises)
    monkeypatch.setattr(tasks_module, "bulk_create_assignments", fake_bulk_create_assignments)
    monkeypatch.setattr(tasks_module, "get_assignment", fake_get_assignment)
    monkeypatch.setattr(tasks_module, "list_assignments", fake_list_assignments)
    monkeypatch.setattr(tasks_module, "list_assignments_for_tasks", fake_list_assignments_for_tasks)
    monkeypatch.setattr(tasks_module, "list_my_assignments", fake_list_my_assignments)
    monkeypatch.setattr(tasks_module, "mark_viewed", fake_mark_viewed)
    monkeypatch.setattr(tasks_module, "start_assignment", fake_start_assignment)
    monkeypatch.setattr(tasks_module, "submit_assignment", fake_submit_assignment)
    monkeypatch.setattr(tasks_module, "set_assignment_photo", fake_set_assignment_photo)
    monkeypatch.setattr(tasks_module, "set_assignment_video", fake_set_assignment_video)
    monkeypatch.setattr(tasks_module, "review_assignment", fake_review_assignment)
    monkeypatch.setattr(tasks_module, "cancel_open_assignments", fake_cancel_open_assignments)

    async def fake_sweep_overdue(conn):
        now = datetime.now(timezone.utc)
        count = 0
        for record in task_assignments_store.values():
            task = tasks_store.get(record["task_id"])
            if task is None or task.get("deadline") is None:
                continue
            if task["deadline"] < now and record["status"] in ("assigned", "viewed", "in_progress"):
                record["status"] = "overdue"
                count += 1
        return count

    async def fake_list_calendar_task_deadlines(conn, user_id, date_from, date_to):
        result = []
        for record in task_assignments_store.values():
            if record["user_id"] != user_id:
                continue
            task = tasks_store.get(record["task_id"])
            if task is None or task.get("deadline") is None:
                continue
            deadline_date = task["deadline"].date()
            if not (date_from <= deadline_date <= date_to):
                continue
            team = teams_store.get(task["team_id"])
            result.append(
                {
                    "id": task["id"],
                    "title": task["title"],
                    "deadline": task["deadline"],
                    "team_id": task["team_id"],
                    "team_name": team["name"] if team else None,
                    "status": record["status"],
                }
            )
        return sorted(result, key=lambda r: r["deadline"])

    async def fake_team_task_summary(conn, team_id):
        completed = overdue = total = 0
        difficulties: list = []
        wellbeings: list = []
        for record in task_assignments_store.values():
            task = tasks_store.get(record["task_id"])
            if task is None or task.get("team_id") != team_id:
                continue
            total += 1
            if record["status"] == "accepted":
                completed += 1
            if record["status"] == "overdue":
                overdue += 1
            if record.get("difficulty") is not None:
                difficulties.append(record["difficulty"])
            if record.get("wellbeing") is not None:
                wellbeings.append(record["wellbeing"])
        return {
            "completed": completed,
            "overdue": overdue,
            "total": total,
            "avg_difficulty": sum(difficulties) / len(difficulties) if difficulties else None,
            "avg_wellbeing": sum(wellbeings) / len(wellbeings) if wellbeings else None,
        }

    async def fake_player_task_summary(conn, user_id):
        completed = overdue = total = 0
        for record in task_assignments_store.values():
            if record["user_id"] != user_id:
                continue
            total += 1
            if record["status"] == "accepted":
                completed += 1
            if record["status"] == "overdue":
                overdue += 1
        return {"completed": completed, "overdue": overdue, "total": total}

    async def fake_player_task_comments(conn, user_id, limit=20):
        result = []
        for record in task_assignments_store.values():
            if record["user_id"] != user_id or not record.get("coach_comment"):
                continue
            task = tasks_store.get(record["task_id"])
            result.append(
                {
                    "context": task["title"] if task else "",
                    "comment": record["coach_comment"],
                    "commented_at": record.get("reviewed_at"),
                }
            )
        result.sort(key=lambda c: c["commented_at"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return result[:limit]

    monkeypatch.setattr(tasks_module, "sweep_overdue", fake_sweep_overdue)
    monkeypatch.setattr(tasks_module, "list_calendar_task_deadlines", fake_list_calendar_task_deadlines)
    monkeypatch.setattr(tasks_module, "team_task_summary", fake_team_task_summary)
    monkeypatch.setattr(tasks_module, "player_task_summary", fake_player_task_summary)
    monkeypatch.setattr(tasks_module, "player_coach_comments", fake_player_task_comments)

    templates_store: dict = {}
    template_exercises_store: dict = {}

    async def fake_create_template(conn, owner_id, **fields):
        template_id = uuid4()
        now = datetime.now(timezone.utc)
        record = {"id": template_id, "owner_id": owner_id, "created_at": now, "updated_at": now, **fields}
        templates_store[template_id] = record
        return dict(record)

    async def fake_get_template(conn, template_id):
        record = templates_store.get(template_id)
        return dict(record) if record else None

    async def fake_update_template(conn, template_id, owner_id, **fields):
        record = templates_store.get(template_id)
        if record is None or record["owner_id"] != owner_id:
            return None
        record.update(fields)
        record["updated_at"] = datetime.now(timezone.utc)
        return dict(record)

    async def fake_list_owned_templates(conn, owner_id):
        return [dict(r) for r in templates_store.values() if r["owner_id"] == owner_id]

    async def fake_soft_delete_template(conn, template_id, owner_id):
        record = templates_store.get(template_id)
        if record is None or record["owner_id"] != owner_id:
            return False
        del templates_store[template_id]
        return True

    async def fake_set_template_exercises(conn, template_id, exercise_ids):
        for te_id in [k for k, v in template_exercises_store.items() if v["template_id"] == template_id]:
            del template_exercises_store[te_id]
        for index, exercise_id in enumerate(exercise_ids):
            te_id = uuid4()
            template_exercises_store[te_id] = {
                "id": te_id, "template_id": template_id, "exercise_id": exercise_id, "order_index": index
            }

    async def fake_list_template_exercises(conn, template_id):
        items = sorted(
            (v for v in template_exercises_store.values() if v["template_id"] == template_id),
            key=lambda r: r["order_index"],
        )
        result = []
        for item in items:
            exercise = exercises_store.get(item["exercise_id"])
            result.append({**item, "exercise_name": exercise["name"] if exercise else None})
        return result

    monkeypatch.setattr(task_templates_module, "create_template", fake_create_template)
    monkeypatch.setattr(task_templates_module, "get_template", fake_get_template)
    monkeypatch.setattr(task_templates_module, "update_template", fake_update_template)
    monkeypatch.setattr(task_templates_module, "list_owned", fake_list_owned_templates)
    monkeypatch.setattr(task_templates_module, "soft_delete", fake_soft_delete_template)
    monkeypatch.setattr(task_templates_module, "set_template_exercises", fake_set_template_exercises)
    monkeypatch.setattr(task_templates_module, "list_template_exercises", fake_list_template_exercises)

    matches_store: dict = {}
    match_roster_store: dict = {}  # (match_id, user_id) -> True

    async def fake_create_match(conn, team_id, created_by, **fields):
        match_id = uuid4()
        now = datetime.now(timezone.utc)
        record = {
            "id": match_id, "team_id": team_id, "created_by": created_by,
            "status": "scheduled", "our_score": None, "opponent_score": None, "comment": None,
            "created_at": now, "updated_at": now, **fields,
        }
        matches_store[match_id] = record
        return dict(record)

    async def fake_get_match(conn, match_id):
        record = matches_store.get(match_id)
        return dict(record) if record else None

    async def fake_update_match(conn, match_id, **fields):
        record = matches_store.get(match_id)
        if record is None:
            return None
        record.update(fields)
        record["updated_at"] = datetime.now(timezone.utc)
        return dict(record)

    async def fake_set_match_result(conn, match_id, our_score, opponent_score, comment):
        record = matches_store.get(match_id)
        if record is None:
            return None
        record["our_score"] = our_score
        record["opponent_score"] = opponent_score
        record["comment"] = comment
        record["status"] = "completed"
        record["updated_at"] = datetime.now(timezone.utc)
        return dict(record)

    async def fake_soft_delete_match(conn, match_id):
        if match_id in matches_store:
            del matches_store[match_id]
            return True
        return False

    async def fake_list_team_matches(conn, team_id):
        records = [dict(r) for r in matches_store.values() if r["team_id"] == team_id]
        today = date.today()
        upcoming = sorted((r for r in records if r["match_date"] >= today), key=lambda r: (r["match_date"], r["start_time"]))
        past = sorted((r for r in records if r["match_date"] < today), key=lambda r: (r["match_date"], r["start_time"]), reverse=True)
        return upcoming + past

    async def fake_list_calendar_matches(conn, user_id, date_from, date_to):
        my_team_ids = {tid for (tid, uid) in members_store if uid == user_id}
        result = []
        for record in matches_store.values():
            if record["team_id"] not in my_team_ids:
                continue
            if not (date_from <= record["match_date"] <= date_to):
                continue
            team = teams_store.get(record["team_id"])
            result.append(
                {
                    "id": record["id"],
                    "opponent_name": record["opponent_name"],
                    "match_date": record["match_date"],
                    "start_time": record["start_time"],
                    "status": record["status"],
                    "team_id": record["team_id"],
                    "team_name": team["name"] if team else None,
                }
            )
        return sorted(result, key=lambda r: (r["match_date"], r["start_time"]))

    async def fake_team_match_summary(conn, team_id):
        played = wins = losses = draws = 0
        for r in matches_store.values():
            if r["team_id"] != team_id or r["status"] != "completed":
                continue
            played += 1
            if r["our_score"] > r["opponent_score"]:
                wins += 1
            elif r["our_score"] < r["opponent_score"]:
                losses += 1
            else:
                draws += 1
        return {"played": played, "wins": wins, "losses": losses, "draws": draws}

    async def fake_player_match_history(conn, user_id, limit=10):
        my_team_ids = {tid for (tid, uid) in members_store if uid == user_id}
        result = []
        for r in matches_store.values():
            if r["team_id"] not in my_team_ids or r["status"] != "completed":
                continue
            team = teams_store.get(r["team_id"])
            result.append(
                {
                    "id": r["id"],
                    "opponent_name": r["opponent_name"],
                    "match_date": r["match_date"],
                    "our_score": r["our_score"],
                    "opponent_score": r["opponent_score"],
                    "status": r["status"],
                    "team_name": team["name"] if team else None,
                }
            )
        result.sort(key=lambda r: r["match_date"], reverse=True)
        return result[:limit]

    async def fake_set_match_roster(conn, match_id, user_ids):
        for key in [k for k in match_roster_store if k[0] == match_id]:
            del match_roster_store[key]
        for user_id in user_ids:
            match_roster_store[(match_id, user_id)] = uuid4()

    async def fake_list_match_roster(conn, match_id):
        result = []
        for (m_id, u_id), roster_id in match_roster_store.items():
            if m_id != match_id:
                continue
            user = _user_by_id(u_id)
            result.append(
                {
                    "id": roster_id, "match_id": match_id, "user_id": u_id,
                    "telegram_id": user["telegram_id"] if user else 0,
                    "first_name": user["first_name"] if user else "",
                    "last_name": user.get("last_name") if user else None,
                    "photo_url": user.get("photo_url") if user else None,
                }
            )
        return sorted(result, key=lambda r: r["first_name"])

    monkeypatch.setattr(matches_module, "create_match", fake_create_match)
    monkeypatch.setattr(matches_module, "get_match", fake_get_match)
    monkeypatch.setattr(matches_module, "update_match", fake_update_match)
    monkeypatch.setattr(matches_module, "set_result", fake_set_match_result)
    monkeypatch.setattr(matches_module, "soft_delete", fake_soft_delete_match)
    monkeypatch.setattr(matches_module, "list_team_matches", fake_list_team_matches)
    monkeypatch.setattr(matches_module, "list_calendar_matches", fake_list_calendar_matches)
    monkeypatch.setattr(matches_module, "team_match_summary", fake_team_match_summary)
    monkeypatch.setattr(matches_module, "player_match_history", fake_player_match_history)
    monkeypatch.setattr(matches_module, "set_roster", fake_set_match_roster)
    monkeypatch.setattr(matches_module, "list_roster", fake_list_match_roster)

    notifications_store: dict = {}  # dedup_key -> dict
    notification_preferences_store: dict = {}  # (user_id, category) -> bool

    async def fake_create_or_reschedule(conn, *, user_id, category, title, body, entity_type, entity_id, send_at, dedup_key):
        existing = notifications_store.get(dedup_key)
        if existing is not None and existing["status"] == "sent":
            return
        now = datetime.now(timezone.utc)
        notifications_store[dedup_key] = {
            "id": existing["id"] if existing else uuid4(),
            "user_id": user_id,
            "category": category,
            "title": title,
            "body": body,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "send_at": send_at,
            "status": "pending",
            "attempts": 0,
            "last_error": None,
            "dedup_key": dedup_key,
            "created_at": existing["created_at"] if existing else now,
            "sent_at": None,
        }

    async def fake_cancel_pending_for_entity(conn, entity_type, entity_id):
        for record in notifications_store.values():
            if record["entity_type"] == entity_type and record["entity_id"] == entity_id and record["status"] == "pending":
                record["status"] = "cancelled"

    async def fake_list_due(conn, limit=100):
        now = datetime.now(timezone.utc)
        due = [r for r in notifications_store.values() if r["status"] == "pending" and r["send_at"] <= now]
        return sorted(due, key=lambda r: r["send_at"])[:limit]

    async def fake_mark_sent(conn, notification_id):
        for record in notifications_store.values():
            if record["id"] == notification_id:
                record["status"] = "sent"
                record["sent_at"] = datetime.now(timezone.utc)

    async def fake_mark_retry(conn, notification_id, next_send_at, error):
        for record in notifications_store.values():
            if record["id"] == notification_id:
                record["send_at"] = next_send_at
                record["attempts"] += 1
                record["last_error"] = error

    async def fake_mark_failed(conn, notification_id, error):
        for record in notifications_store.values():
            if record["id"] == notification_id:
                record["status"] = "failed"
                record["attempts"] += 1
                record["last_error"] = error

    async def fake_mark_cancelled(conn, notification_id):
        for record in notifications_store.values():
            if record["id"] == notification_id:
                record["status"] = "cancelled"

    async def fake_is_enabled(conn, user_id, category):
        return notification_preferences_store.get((user_id, category), True)

    async def fake_list_preferences(conn, user_id):
        return [
            {"category": category, "enabled": enabled}
            for (uid, category), enabled in notification_preferences_store.items()
            if uid == user_id
        ]

    async def fake_set_preference(conn, user_id, category, enabled):
        notification_preferences_store[(user_id, category)] = enabled

    monkeypatch.setattr(notifications_module, "create_or_reschedule", fake_create_or_reschedule)
    monkeypatch.setattr(notifications_module, "cancel_pending_for_entity", fake_cancel_pending_for_entity)
    monkeypatch.setattr(notifications_module, "list_due", fake_list_due)
    monkeypatch.setattr(notifications_module, "mark_sent", fake_mark_sent)
    monkeypatch.setattr(notifications_module, "mark_retry", fake_mark_retry)
    monkeypatch.setattr(notifications_module, "mark_failed", fake_mark_failed)
    monkeypatch.setattr(notifications_module, "mark_cancelled", fake_mark_cancelled)
    monkeypatch.setattr(notifications_module, "is_enabled", fake_is_enabled)
    monkeypatch.setattr(notifications_module, "list_preferences", fake_list_preferences)
    monkeypatch.setattr(notifications_module, "set_preference", fake_set_preference)

    metrics_store: dict = {}

    async def fake_create_metric(conn, user_id, recorded_by, **fields):
        metric_id = uuid4()
        now = datetime.now(timezone.utc)
        record = {"id": metric_id, "user_id": user_id, "recorded_by": recorded_by, "created_at": now, "updated_at": now, **fields}
        metrics_store[metric_id] = record
        return dict(record)

    async def fake_get_metric(conn, metric_id):
        record = metrics_store.get(metric_id)
        return dict(record) if record else None

    async def fake_update_metric(conn, metric_id, **fields):
        record = metrics_store.get(metric_id)
        if record is None:
            return None
        record.update(fields)
        record["updated_at"] = datetime.now(timezone.utc)
        return dict(record)

    async def fake_soft_delete_metric(conn, metric_id):
        if metric_id in metrics_store:
            del metrics_store[metric_id]
            return True
        return False

    async def fake_list_metrics_for_user(conn, user_id):
        items = [dict(r) for r in metrics_store.values() if r["user_id"] == user_id]
        return sorted(items, key=lambda r: (r["recorded_date"], r["created_at"]), reverse=True)

    monkeypatch.setattr(metrics_module, "create_metric", fake_create_metric)
    monkeypatch.setattr(metrics_module, "get_metric", fake_get_metric)
    monkeypatch.setattr(metrics_module, "update_metric", fake_update_metric)
    monkeypatch.setattr(metrics_module, "soft_delete", fake_soft_delete_metric)
    monkeypatch.setattr(metrics_module, "list_for_user", fake_list_metrics_for_user)

    app = main_module.create_app()

    async def override_get_db():
        yield None

    app.dependency_overrides[deps.get_db] = override_get_db

    with TestClient(app) as test_client:
        yield test_client

    get_settings.cache_clear()


@pytest.fixture
def logged_in_client(client: TestClient):
    """A `client` plus a ready-made (token, telegram_id) for an already
    logged-in user, for tests that only care about post-login endpoints."""
    telegram_id = 900001
    init_data = build_init_data(BOT_TOKEN, user_id=telegram_id, first_name="Test", username="test_user")
    response = client.post("/api/auth/telegram", json={"init_data": init_data})
    assert response.status_code == 200
    token = response.json()["access_token"]
    return client, token


@pytest.fixture
def login_as(client: TestClient):
    """Log in an additional distinct user against the same `client` (and its
    shared in-memory stores). Returns a callable: (telegram_id, first_name,
    username, last_name) -> access_token."""

    def _login(telegram_id: int, first_name: str = "User", username: str | None = None, last_name: str | None = None) -> str:
        init_data = build_init_data(
            BOT_TOKEN,
            user_id=telegram_id,
            first_name=first_name,
            last_name=last_name,
            username=username or f"user{telegram_id}",
        )
        response = client.post("/api/auth/telegram", json={"init_data": init_data})
        assert response.status_code == 200
        return response.json()["access_token"]

    return _login
