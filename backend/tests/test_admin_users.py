"""User administration: search, the account card, blocking and unblocking - real PostgreSQL, real sessions."""
from __future__ import annotations

import pytest

from app.repositories import admin_users as admin_users_repo
from tests.admin_world import ADMIN_EMAIL, AdminBrowser, Browser, add_user, live_client, pg, set_admins, sql, sql_value, world  # noqa: F401


def _users(world, **params) -> dict:
    return world.admin.ok("GET", "/api/admin/users", params=params)


def _emails(world, **params) -> list[str]:
    return [u["email"] for u in _users(world, **params)["items"]]


def _ban(world, user_id: str, reason: str = "Спам в профиле", **extra):
    return world.admin.call("POST", f"/api/admin/users/{user_id}/ban", json={"reason": reason, **extra})


def _audit(world) -> list[dict]:
    return world.admin.ok("GET", "/api/admin/audit", params={"limit": 200})["items"]


# --- search, filters, paging -------------------------------------------------------------------------------


def test_the_list_is_paged_on_the_server_and_reports_the_total(world) -> None:
    for i in range(7):
        add_user(world.dsn, f"user{i}@example.com", days_ago=i + 1)

    first = _users(world, limit=3, offset=0)
    second = _users(world, limit=3, offset=3)

    assert first["total"] == second["total"] == 8
    assert len(first["items"]) == len(second["items"]) == 3
    assert not {u["id"] for u in first["items"]} & {u["id"] for u in second["items"]}
    assert _users(world, limit=100, offset=500)["items"] == []


@pytest.mark.parametrize("params", [{"limit": 101}, {"limit": 0}, {"offset": -1}, {"sort": "password"}, {"role": "root"}, {"status": "anything"}])
def test_list_parameters_are_validated(world, params) -> None:
    assert world.admin.call("GET", "/api/admin/users", params=params).status_code == 422


def test_search_finds_by_email_name_full_name_and_id(world) -> None:
    ivan = add_user(world.dsn, "ivan.petrov@example.com")
    sql(world.dsn, "UPDATE users SET first_name = 'Иван', last_name = 'Петров' WHERE id = $1::uuid", ivan)
    add_user(world.dsn, "other@example.com")

    assert _emails(world, q="ivan.petrov") == ["ivan.petrov@example.com"]
    assert _emails(world, q="ПЕТРОВ") == ["ivan.petrov@example.com"]
    assert _emails(world, q="Иван Петров") == ["ivan.petrov@example.com"]
    assert _emails(world, q=ivan) == ["ivan.petrov@example.com"]
    assert _emails(world, q="nobody-like-this") == []


def test_search_text_is_not_a_pattern(world) -> None:
    add_user(world.dsn, "plain@example.com")
    add_user(world.dsn, "a_b@example.com")

    assert _emails(world, q="%") == []  # a literal percent sign, not "everything"
    assert _emails(world, q="a_b") == ["a_b@example.com"]
    assert _emails(world, q="a_") == ["a_b@example.com"]
    assert _emails(world, q="'; DROP TABLE users; --") == []
    assert sql_value(world.dsn, "SELECT count(*) FROM users") == 3  # still there


def test_filters_by_role_status_and_the_admin_flag(world) -> None:
    player = add_user(world.dsn, "player@example.com")
    coach = add_user(world.dsn, "coach@example.com")
    banned = add_user(world.dsn, "banned@example.com", banned=True)
    add_user(world.dsn, "unverified@example.com", verified=False)
    add_user(world.dsn, "gone@example.com", deleted=True)
    sql(world.dsn, "INSERT INTO player_profiles (user_id, full_name, sport) VALUES ($1::uuid, 'P', 'Теннис')", player)
    sql(world.dsn, "INSERT INTO coach_profiles (user_id, full_name, sport) VALUES ($1::uuid, 'C', 'Теннис')", coach)

    assert _emails(world, role="player") == ["player@example.com"]
    assert _emails(world, role="coach") == ["coach@example.com"]
    assert _emails(world, role="admin") == [ADMIN_EMAIL]
    assert set(_emails(world, role="none")) == {ADMIN_EMAIL, "banned@example.com", "unverified@example.com", "gone@example.com"}
    assert _emails(world, status="banned") == ["banned@example.com"]
    assert _emails(world, status="unverified") == ["unverified@example.com"]
    assert _emails(world, status="deleted") == ["gone@example.com"]
    assert set(_emails(world, status="active")) == {ADMIN_EMAIL, "player@example.com", "coach@example.com"}
    assert banned


def test_sorting_by_registration_and_by_last_activity(world) -> None:
    old = add_user(world.dsn, "old@example.com", days_ago=30)
    new = add_user(world.dsn, "new@example.com", days_ago=1)
    sql(world.dsn, "UPDATE users SET last_active_at = now() - interval '5 days' WHERE id = $1::uuid", new)
    sql(world.dsn, "UPDATE users SET last_active_at = now() - interval '1 hour' WHERE id = $1::uuid", old)

    assert _emails(world, sort="created_asc")[0] == "old@example.com"
    assert _emails(world, sort="created_desc")[0] == ADMIN_EMAIL
    by_activity = _emails(world, sort="active_desc")
    assert by_activity.index("old@example.com") < by_activity.index("new@example.com")
    assert _emails(world, sort="active_asc").index("new@example.com") < _emails(world, sort="active_asc").index("old@example.com")


def test_a_row_says_which_accounts_are_administrators(world) -> None:
    other = add_user(world.dsn, "second@example.com")
    set_admins(world, ADMIN_EMAIL, "second@example.com")

    rows = {u["email"]: u for u in _users(world)["items"]}

    assert rows[ADMIN_EMAIL]["is_admin"] and rows["second@example.com"]["is_admin"] and other


# --- the card ----------------------------------------------------------------------------------------------------


def test_the_card_shows_what_an_administrator_needs_and_nothing_secret(world) -> None:
    user = Browser(world.client, "alice@example.com", "Алиса")
    sql(world.dsn, "INSERT INTO trainings (created_by, type, training_date, start_time, duration_minutes) VALUES ($1::uuid, 'personal', CURRENT_DATE, '10:00', 60)", user.user_id)

    card = world.admin.ok("GET", f"/api/admin/users/{user.user_id}")

    assert card["email"] == "alice@example.com" and card["email_verified"] is True and card["status"] == "active"
    assert card["trainings_created"] == 1 and card["bans"] == [] and card["history"] == []
    text = str(card).lower()
    for secret in ("password", "hash", "token", "secret", "cookie", "session", "mfa"):
        assert secret not in text, secret


def test_a_missing_or_malformed_id_is_a_clean_error(world) -> None:
    assert world.admin.call("GET", "/api/admin/users/00000000-0000-0000-0000-000000000000").status_code == 404
    assert world.admin.call("GET", "/api/admin/users/not-a-uuid").status_code == 422


# --- blocking -------------------------------------------------------------------------------------------------------


def test_a_block_ends_the_sessions_at_once_and_closes_the_front_door(world) -> None:
    victim = Browser(world.client, "victim@example.com", "Жертва")
    assert victim.call("GET", "/api/profile/me").status_code == 200

    response = _ban(world, victim.user_id, "Мошенничество в объявлениях")

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "banned" and response.json()["ban_reason"] == "Мошенничество в объявлениях"
    assert victim.call("GET", "/api/profile/me").status_code in (401, 403)  # the old session is dead
    assert victim.call("POST", "/api/activity").status_code in (401, 403)
    relogin = world.client.post("/api/auth/login", json={"email": "victim@example.com", "password": victim.password})
    assert relogin.status_code == 403
    assert sql_value(world.dsn, "SELECT count(*) FROM user_sessions WHERE user_id = $1::uuid AND revoked_at IS NULL", victim.user_id) == 0


def test_a_temporary_block_lifts_itself_without_anyone_doing_anything(world) -> None:
    victim = Browser(world.client, "victim@example.com", "Жертва")
    assert _ban(world, victim.user_id, "Неделя на раздумье", days=7).status_code == 200
    assert world.client.post("/api/auth/login", json={"email": "victim@example.com", "password": victim.password}).status_code == 403

    sql(world.dsn, "UPDATE users SET banned_until = now() - interval '1 minute' WHERE id = $1::uuid", victim.user_id)  # time passes
    sql(world.dsn, "UPDATE user_bans SET expires_at = now() - interval '1 minute', banned_at = now() - interval '7 days' WHERE user_id = $1::uuid", victim.user_id)

    login = world.client.post("/api/auth/login", json={"email": "victim@example.com", "password": victim.password})
    assert login.status_code == 200  # no background job needed for access to come back
    card = world.admin.ok("GET", f"/api/admin/users/{victim.user_id}")
    assert card["status"] == "active"


def test_the_background_loop_closes_the_record_of_an_expired_block(world) -> None:
    import asyncio

    import asyncpg

    victim = add_user(world.dsn, "victim@example.com")
    assert _ban(world, victim, "Короткая блокировка", days=1).status_code == 200
    sql(world.dsn, "UPDATE users SET banned_until = now() - interval '1 minute' WHERE id = $1::uuid", victim)
    sql(world.dsn, "UPDATE user_bans SET banned_at = now() - interval '2 days', expires_at = now() - interval '1 minute' WHERE user_id = $1::uuid", victim)

    async def tick():
        conn = await asyncpg.connect(world.dsn)
        try:
            return await admin_users_repo.lift_expired(conn)
        finally:
            await conn.close()

    assert asyncio.run(tick()) == 1
    assert asyncio.run(tick()) == 0  # nothing left to do the second time
    row = sql(world.dsn, "SELECT lift_kind, lifted_at IS NOT NULL AS lifted FROM user_bans WHERE user_id = $1::uuid", victim)[0]
    assert row["lift_kind"] == "expired" and row["lifted"] is True
    assert sql_value(world.dsn, "SELECT is_banned FROM users WHERE id = $1::uuid", victim) is False


def test_unblocking_restores_access_and_keeps_the_history(world) -> None:
    victim = Browser(world.client, "victim@example.com", "Жертва")
    _ban(world, victim.user_id, "Спам")

    unbanned = world.admin.call("POST", f"/api/admin/users/{victim.user_id}/unban", json={"reason": "Разобрались, это была ошибка"})

    assert unbanned.status_code == 200, unbanned.text
    card = unbanned.json()
    assert card["status"] == "active" and card["ban_reason"] is None
    assert len(card["bans"]) == 1
    ban = card["bans"][0]
    assert ban["reason"] == "Спам" and ban["lift_kind"] == "manual" and ban["lift_reason"] == "Разобрались, это была ошибка"
    assert ban["admin"] == ADMIN_EMAIL and ban["lifted_by"] == ADMIN_EMAIL
    assert [h["action"] for h in card["history"]] == ["unban", "ban"]
    assert world.client.post("/api/auth/login", json={"email": "victim@example.com", "password": victim.password}).status_code == 200


def test_blocking_twice_or_unblocking_a_free_account_is_refused_without_extra_records(world) -> None:
    victim = add_user(world.dsn, "victim@example.com")
    assert world.admin.call("POST", f"/api/admin/users/{victim}/unban", json={"reason": "просто так"}).status_code == 409
    assert _ban(world, victim).status_code == 200

    again = _ban(world, victim, "Ещё раз")

    assert again.status_code == 409 and again.json()["error"]["code"] == "already_banned"
    assert sql_value(world.dsn, "SELECT count(*) FROM user_bans WHERE user_id = $1::uuid", victim) == 1
    assert [e["action"] for e in _audit(world) if e["target_id"] == victim] == ["ban"]  # the two refusals left no trace


def test_a_second_block_after_the_first_ended_is_a_new_history_entry(world) -> None:
    victim = add_user(world.dsn, "victim@example.com")
    _ban(world, victim, "Первый раз")
    world.admin.call("POST", f"/api/admin/users/{victim}/unban", json={"reason": "Прощён"})

    assert _ban(world, victim, "Второй раз").status_code == 200

    bans = world.admin.ok("GET", f"/api/admin/users/{victim}")["bans"]
    assert [b["reason"] for b in bans] == ["Второй раз", "Первый раз"]


def test_a_reason_is_required_and_the_payload_accepts_nothing_extra(world) -> None:
    victim = add_user(world.dsn, "victim@example.com")

    for payload in ({}, {"reason": ""}, {"reason": "  "}, {"reason": "ab"}, {"reason": "x" * 1001}, {"reason": "нормально", "days": 0}, {"reason": "нормально", "days": 4000},
                    {"reason": "нормально", "is_admin": True}, {"reason": "нормально", "days": "soon"}):
        resp = world.admin.call("POST", f"/api/admin/users/{victim}/ban", json=payload)
        assert resp.status_code == 422, payload
    assert sql_value(world.dsn, "SELECT is_banned FROM users WHERE id = $1::uuid", victim) is False


def test_an_administrator_cannot_block_themselves_and_the_attempt_is_recorded(world) -> None:
    me = world.admin.user_id

    response = _ban(world, me)

    assert response.status_code == 409 and response.json()["error"]["code"] == "cannot_ban_self"
    assert sql_value(world.dsn, "SELECT is_banned FROM users WHERE id = $1::uuid", me) is False
    denied = [e for e in _audit(world) if e["action"] == "ban" and e["target_id"] == me]
    assert denied and denied[0]["result"] == "denied"


def test_another_administrator_cannot_be_blocked_so_nobody_can_lock_everyone_out(world) -> None:
    second = AdminBrowser(world.client, "second@example.com", "Второй", role=None)
    set_admins(world, ADMIN_EMAIL, "SECOND@example.com")  # case does not matter
    world.admin.fresh_unlocked_session()

    response = _ban(world, second.user_id)

    assert response.status_code == 403 and response.json()["error"]["code"] == "cannot_ban_admin"
    assert "ADMIN_EMAILS" in response.json()["error"]["message"]
    assert sql_value(world.dsn, "SELECT is_banned FROM users WHERE id = $1::uuid", second.user_id) is False
    assert any(e["result"] == "denied" for e in _audit(world))


def test_once_removed_from_the_allowlist_a_former_administrator_can_be_blocked(world) -> None:
    second = Browser(world.client, "second@example.com", "Второй", role=None)

    assert _ban(world, second.user_id, "Бывший админ, нарушил правила").status_code == 200


def test_blocking_a_deleted_or_unknown_account_is_a_404(world) -> None:
    gone = add_user(world.dsn, "gone@example.com", deleted=True)

    assert _ban(world, gone).status_code == 404
    assert _ban(world, "00000000-0000-0000-0000-000000000000").status_code == 404


def test_the_block_and_its_audit_entry_succeed_or_fail_together(world, monkeypatch) -> None:
    from app.services import admin_audit

    victim = add_user(world.dsn, "victim@example.com")

    async def broken(*args, **kwargs):
        raise RuntimeError("audit storage is down")

    monkeypatch.setattr(admin_audit, "record", broken)

    with pytest.raises(RuntimeError):
        _ban(world, victim)

    assert sql_value(world.dsn, "SELECT is_banned FROM users WHERE id = $1::uuid", victim) is False
    assert sql_value(world.dsn, "SELECT count(*) FROM user_bans WHERE user_id = $1::uuid", victim) == 0


def test_the_audit_entry_has_who_what_why_and_before_and_after(world) -> None:
    victim = add_user(world.dsn, "victim@example.com")
    _ban(world, victim, "Фейковые отзывы", days=30)

    entry = next(e for e in _audit(world) if e["target_id"] == victim)

    assert entry["action"] == "ban" and entry["admin"] == ADMIN_EMAIL and entry["reason"] == "Фейковые отзывы" and entry["result"] == "success"
    assert entry["details"]["before"]["blocked"] is False
    assert entry["details"]["after"]["blocked"] is True and entry["details"]["after"]["reason"] == "Фейковые отзывы"
    assert entry["details"]["days"] == 30


# --- who may call these routes at all -----------------------------------------------------------------------------------


def test_nobody_but_an_unlocked_administrator_can_use_the_user_endpoints(world) -> None:
    victim = add_user(world.dsn, "victim@example.com")
    stranger = Browser(world.client, "stranger@example.com", "Чужой")
    calls = [
        ("GET", "/api/admin/users", None),
        ("GET", f"/api/admin/users/{victim}", None),
        ("POST", f"/api/admin/users/{victim}/ban", {"reason": "нарушение правил"}),
        ("POST", f"/api/admin/users/{victim}/unban", {"reason": "ошибка модератора"}),
    ]

    for method, path, body in calls:
        world.client.cookies.clear()
        assert world.client.request(method, path, json=body).status_code == 401, ("guest", path)
        assert stranger.call(method, path, json=body).status_code == 403, ("ordinary user", path)
        locked = world.admin.fresh_session().call(method, path, json=body)
        assert locked.status_code == 403 and locked.json()["error"]["code"] == "mfa_required", ("no second factor", path)
    assert sql_value(world.dsn, "SELECT is_banned FROM users WHERE id = $1::uuid", victim) is False


def test_a_block_request_without_the_csrf_token_is_refused(world) -> None:
    victim = add_user(world.dsn, "victim@example.com")

    world.client.cookies.clear()
    for name, value in world.admin.cookies.items():
        world.client.cookies.set(name, value)
    forged = world.client.post(f"/api/admin/users/{victim}/ban", json={"reason": "подделка запроса"})  # a page on another site

    assert forged.status_code == 403 and forged.json()["error"]["code"] == "csrf_failed"
    assert sql_value(world.dsn, "SELECT is_banned FROM users WHERE id = $1::uuid", victim) is False


def test_a_blocked_administrator_loses_the_panel_at_once(world) -> None:
    sql(world.dsn, "UPDATE users SET is_banned = TRUE WHERE id = $1::uuid", world.admin.user_id)

    assert world.admin.call("GET", "/api/admin/users").status_code == 403
    assert world.admin.call("GET", "/api/admin/session").status_code == 403
