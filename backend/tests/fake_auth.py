"""In-memory stand-ins for the account repositories (users, sessions,
auth_tokens, mfa, accounts), in the same spirit as the rest of conftest: the
API tests run without a database. The real SQL is exercised separately by
tests/test_auth_postgres.py against a live PostgreSQL (see that file).

The semantics mirror the SQL one to one - uniqueness of lower(email), tokens
spent exactly once, sessions revoked rather than deleted - because these fakes
are what every API test authenticates through.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

import asyncpg
import pytest


def _now() -> datetime:
    return datetime.now(timezone.utc)


class FakeAuthStore:
    def __init__(self) -> None:
        self.users: dict[UUID, dict[str, Any]] = {}
        self.sessions: dict[UUID, dict[str, Any]] = {}
        self.tokens: list[dict[str, Any]] = []
        self.mfa: dict[UUID, dict[str, Any]] = {}
        self.consents: dict[UUID, bool] = {}
        self.identities: list[dict[str, Any]] = []
        self.rate_hits: dict[str, list[float]] = {}
        self.audit: list[dict[str, Any]] = []

    # --- helpers ---------------------------------------------------------
    def user_view(self, record: dict[str, Any]) -> dict[str, Any]:
        view = {k: v for k, v in record.items() if k not in ("password_hash", "failed_login_count", "locked_until")}
        view["has_password"] = record.get("password_hash") is not None
        return view

    def find_by_email(self, email: str) -> dict[str, Any] | None:
        for record in self.users.values():
            if record.get("email") and record["email"].lower() == email.lower():
                return record
        return None

    def new_user(self, **fields: Any) -> dict[str, Any]:
        record: dict[str, Any] = {
            "id": uuid4(),
            "telegram_id": None,
            "username": None,
            "first_name": "User",
            "last_name": None,
            "photo_url": None,
            "avatar_file_id": None,
            "language_code": None,
            "is_banned": False,
            "banned_at": None,
            "active_mode": None,
            "last_login_at": None,
            "created_at": _now(),
            "updated_at": _now(),
            "completed_onboarding_version": 0,
            "email": None,
            "email_verified_at": None,
            "preferred_role": None,
            "terms_accepted_at": None,
            "terms_version": None,
            "password_changed_at": None,
            "deletion_requested_at": None,
            "deleted_at": None,
            "password_hash": None,
            "failed_login_count": 0,
            "locked_until": None,
        }
        record.update(fields)
        self.users[record["id"]] = record
        return record


def install(monkeypatch: pytest.MonkeyPatch, store: FakeAuthStore) -> None:
    import app.repositories.accounts as accounts
    import app.repositories.auth_tokens as tokens
    import app.repositories.mfa as mfa
    import app.repositories.sessions as sessions
    import app.repositories.users as users

    # ---- users ----------------------------------------------------------
    async def get_by_id(conn, user_id):
        record = store.users.get(user_id)
        return store.user_view(record) if record else None

    async def get_by_telegram_id(conn, telegram_id):
        for record in store.users.values():
            if record["telegram_id"] == telegram_id:
                return store.user_view(record)
        return None

    async def get_by_email(conn, email):
        record = store.find_by_email(email)
        return store.user_view(record) if record else None

    async def get_credentials_by_email(conn, email):
        record = store.find_by_email(email)
        if record is None:
            return None
        return {**store.user_view(record), "password_hash": record["password_hash"],
                "failed_login_count": record["failed_login_count"], "locked_until": record["locked_until"]}

    async def get_password_hash(conn, user_id):
        record = store.users.get(user_id)
        return record["password_hash"] if record else None

    async def create_with_password(conn, *, email, password_hash, first_name, last_name, preferred_role, terms_version):
        if store.find_by_email(email) is not None:
            raise asyncpg.UniqueViolationError("duplicate email")
        record = store.new_user(
            email=email.lower(), password_hash=password_hash, first_name=first_name, last_name=last_name,
            preferred_role=preferred_role, terms_accepted_at=_now(), terms_version=terms_version,
            password_changed_at=_now(),
        )
        return store.user_view(record)

    async def restart_unverified_registration(conn, user_id, *, password_hash, first_name, last_name, preferred_role, terms_version):
        record = store.users.get(user_id)
        if record is None or record["email_verified_at"] is not None or record["telegram_id"] is not None:
            return None
        record.update(password_hash=password_hash, first_name=first_name, last_name=last_name,
                      preferred_role=preferred_role, terms_accepted_at=_now(), terms_version=terms_version,
                      password_changed_at=_now(), failed_login_count=0, locked_until=None)
        return store.user_view(record)

    async def set_password(conn, user_id, password_hash):
        record = store.users[user_id]
        record.update(password_hash=password_hash, password_changed_at=_now(), failed_login_count=0, locked_until=None)

    async def register_login_failure(conn, user_id, *, max_failures, lockout_minutes):
        record = store.users[user_id]
        record["failed_login_count"] += 1
        if record["failed_login_count"] >= max_failures:
            record["failed_login_count"] = 0
            record["locked_until"] = _now() + timedelta(minutes=lockout_minutes)
            return record["locked_until"]
        return None

    async def clear_login_failures(conn, user_id):
        record = store.users[user_id]
        record.update(failed_login_count=0, locked_until=None, last_login_at=_now())

    async def set_active_mode(conn, user_id, mode):
        record = store.users.get(user_id)
        if record is None:
            return None
        record["active_mode"] = mode
        return store.user_view(record)

    async def link_telegram(conn, user_id, telegram_id, username):
        for other in store.users.values():
            if other["telegram_id"] == telegram_id and other["id"] != user_id:
                raise asyncpg.UniqueViolationError("duplicate telegram_id")
        record = store.users[user_id]
        record["telegram_id"] = telegram_id
        record["username"] = username or record["username"]

    async def unlink_telegram(conn, user_id):
        store.users[user_id]["telegram_id"] = None

    async def request_deletion(conn, user_id):
        record = store.users.get(user_id)
        if record is None or record["deleted_at"] is not None:
            return None
        record["deletion_requested_at"] = record["deletion_requested_at"] or _now()
        return record["deletion_requested_at"]

    async def cancel_deletion(conn, user_id):
        record = store.users.get(user_id)
        if record is not None and record["deleted_at"] is None:
            record["deletion_requested_at"] = None

    async def list_due_for_deletion(conn, *, older_than, limit=50):
        return [r["id"] for r in store.users.values()
                if r["deletion_requested_at"] and r["deleted_at"] is None and r["deletion_requested_at"] < older_than][:limit]

    async def anonymize(conn, user_id):
        record = store.users[user_id]
        record.update(email=None, email_verified_at=None, password_hash=None, telegram_id=None, username=None,
                      photo_url=None, avatar_file_id=None, first_name="Удалённый пользователь", last_name=None,
                      language_code=None, active_mode=None, deleted_at=_now())
        for sid in [s for s, row in store.sessions.items() if row["user_id"] == user_id]:
            del store.sessions[sid]
        store.tokens[:] = [t for t in store.tokens if t["user_id"] != user_id]
        store.mfa.pop(user_id, None)
        store.identities[:] = [i for i in store.identities if i["user_id"] != user_id]

    async def get_consent(conn, user_id):
        return store.consents.get(user_id, False)

    async def set_consent(conn, user_id, allowed):
        store.consents[user_id] = allowed
        return allowed

    async def complete_onboarding(conn, user_id, version):
        record = store.users.get(user_id)
        if record is None:
            return None
        record["completed_onboarding_version"] = max(record["completed_onboarding_version"], version)
        return store.user_view(record)

    for name, fn in {
        "get_by_id": get_by_id, "get_by_telegram_id": get_by_telegram_id, "get_by_email": get_by_email,
        "get_credentials_by_email": get_credentials_by_email, "get_password_hash": get_password_hash,
        "create_with_password": create_with_password,
        "restart_unverified_registration": restart_unverified_registration, "set_password": set_password,
        "register_login_failure": register_login_failure, "clear_login_failures": clear_login_failures,
        "set_active_mode": set_active_mode, "link_telegram": link_telegram, "unlink_telegram": unlink_telegram,
        "request_deletion": request_deletion, "cancel_deletion": cancel_deletion,
        "list_due_for_deletion": list_due_for_deletion, "anonymize": anonymize,
        "get_ai_analysis_consent": get_consent, "set_ai_analysis_consent": set_consent,
        "complete_onboarding": complete_onboarding,
    }.items():
        monkeypatch.setattr(users, name, fn)

    # ---- sessions ---------------------------------------------------------
    async def s_create(conn, *, user_id, token_hash, expires_at, user_agent, ip_address):
        row = {"id": uuid4(), "user_id": user_id, "token_hash": token_hash, "created_at": _now(),
               "last_seen_at": _now(), "expires_at": expires_at, "revoked_at": None, "mfa_verified_at": None,
               "user_agent": user_agent, "ip_address": ip_address}
        store.sessions[row["id"]] = row
        return {k: v for k, v in row.items() if k not in ("token_hash", "revoked_at")}

    def _public(row):
        return {k: v for k, v in row.items() if k not in ("token_hash", "revoked_at")}

    async def s_get_active(conn, token_hash):
        for row in store.sessions.values():
            if row["token_hash"] == token_hash and row["revoked_at"] is None and row["expires_at"] > _now():
                return _public(row)
        return None

    async def s_touch(conn, session_id, user_id, new_expires_at):
        store.sessions[session_id].update(last_seen_at=_now(), expires_at=new_expires_at)
        store.users[user_id]["last_login_at"] = _now()

    async def s_list(conn, user_id):
        rows = [r for r in store.sessions.values()
                if r["user_id"] == user_id and r["revoked_at"] is None and r["expires_at"] > _now()]
        return [_public(r) for r in sorted(rows, key=lambda r: r["last_seen_at"], reverse=True)]

    async def s_revoke(conn, user_id, session_id):
        row = store.sessions.get(session_id)
        if row is None or row["user_id"] != user_id or row["revoked_at"] is not None:
            return False
        row["revoked_at"] = _now()
        return True

    async def s_revoke_all(conn, user_id, *, except_session_id=None):
        count = 0
        for row in store.sessions.values():
            if row["user_id"] == user_id and row["revoked_at"] is None and row["id"] != except_session_id:
                row["revoked_at"] = _now()
                count += 1
        return count

    async def s_mark_mfa(conn, session_id):
        store.sessions[session_id]["mfa_verified_at"] = _now()

    async def s_purge(conn, *, keep_revoked_days=7):
        return 0

    for name, fn in {"create": s_create, "get_active": s_get_active, "touch": s_touch, "list_for_user": s_list,
                     "revoke": s_revoke, "revoke_all": s_revoke_all, "mark_mfa_verified": s_mark_mfa,
                     "purge_expired": s_purge}.items():
        monkeypatch.setattr(sessions, name, fn)

    # ---- one-time tokens -----------------------------------------------------
    async def t_create(conn, *, user_id, purpose, token_hash, expires_at, new_email=None, supersede=True):
        if supersede:
            for t in store.tokens:
                if t["user_id"] == user_id and t["purpose"] == purpose and t["used_at"] is None:
                    t["used_at"] = _now()
        store.tokens.append({"id": uuid4(), "user_id": user_id, "purpose": purpose, "token_hash": token_hash,
                             "new_email": new_email, "expires_at": expires_at, "used_at": None, "created_at": _now()})

    def _valid(token_hash, purpose):
        for t in store.tokens:
            if t["token_hash"] == token_hash and t["purpose"] == purpose and t["used_at"] is None and t["expires_at"] > _now():
                return t
        return None

    async def t_peek(conn, token_hash, purpose):
        t = _valid(token_hash, purpose)
        return {"id": t["id"], "user_id": t["user_id"], "new_email": t["new_email"], "expires_at": t["expires_at"]} if t else None

    async def t_consume(conn, token_hash, purpose):
        t = _valid(token_hash, purpose)
        if t is None:
            return None
        t["used_at"] = _now()
        return {"id": t["id"], "user_id": t["user_id"], "new_email": t["new_email"]}

    async def t_purge(conn):
        return 0

    for name, fn in {"create": t_create, "peek": t_peek, "consume": t_consume, "purge_expired": t_purge}.items():
        monkeypatch.setattr(tokens, name, fn)

    # ---- mfa -------------------------------------------------------------------
    async def m_get(conn, user_id):
        row = store.mfa.get(user_id)
        return dict(row) if row else None

    async def m_begin(conn, user_id, secret_encrypted):
        row = store.mfa.get(user_id)
        if row is not None and row["enabled_at"] is not None:
            return
        store.mfa[user_id] = {"user_id": user_id, "secret_encrypted": secret_encrypted, "enabled_at": None,
                              "recovery_hashes": [], "last_used_step": None}

    async def m_enable(conn, user_id, recovery_hashes, step):
        store.mfa[user_id].update(enabled_at=_now(), recovery_hashes=list(recovery_hashes), last_used_step=step)

    async def m_record(conn, user_id, step):
        store.mfa[user_id]["last_used_step"] = step

    async def m_use_recovery(conn, user_id, code_hash):
        row = store.mfa.get(user_id)
        if row is None or code_hash not in row["recovery_hashes"]:
            return False
        row["recovery_hashes"].remove(code_hash)
        return True

    async def m_disable(conn, user_id):
        store.mfa.pop(user_id, None)

    for name, fn in {"get": m_get, "begin_setup": m_begin, "enable": m_enable, "record_step": m_record,
                     "use_recovery_code": m_use_recovery, "disable": m_disable}.items():
        monkeypatch.setattr(mfa, name, fn)

    # ---- composite account operations --------------------------------------------
    async def a_verify_email(conn, token_hash, new_password_hash=None):
        t = _valid(token_hash, "email_verify")
        if t is None:
            return "invalid", None
        other = store.find_by_email(t["new_email"])
        if other is not None and other["id"] != t["user_id"]:
            return "email_taken", None
        t["used_at"] = _now()
        record = store.users[t["user_id"]]
        record.update(email=t["new_email"], email_verified_at=_now(), failed_login_count=0, locked_until=None)
        if new_password_hash is not None:
            record.update(password_hash=new_password_hash, password_changed_at=_now())
        return "ok", store.user_view(record)

    async def a_reset_password(conn, token_hash, password_hash):
        t = _valid(token_hash, "password_reset")
        if t is None:
            return None
        t["used_at"] = _now()
        record = store.users[t["user_id"]]
        record.update(password_hash=password_hash, password_changed_at=_now(), failed_login_count=0, locked_until=None)
        for s in store.sessions.values():
            if s["user_id"] == record["id"] and s["revoked_at"] is None:
                s["revoked_at"] = _now()
        for other in store.tokens:
            if other["user_id"] == record["id"] and other["purpose"] == "password_reset" and other["used_at"] is None:
                other["used_at"] = _now()
        return store.user_view(record)

    async def a_confirm_email_change(conn, token_hash):
        t = _valid(token_hash, "email_change")
        if t is None:
            return "invalid", None, None
        other = store.find_by_email(t["new_email"])
        if other is not None and other["id"] != t["user_id"]:
            return "email_taken", None, None
        t["used_at"] = _now()
        record = store.users[t["user_id"]]
        old_email = record["email"]
        record.update(email=t["new_email"], email_verified_at=_now())
        return "ok", store.user_view(record), old_email

    async def a_claim_account(conn, *, claim_token_hash, email, password_hash, terms_version, verify_token_hash, verify_expires_at):
        if store.find_by_email(email) is not None:
            return "email_taken", None
        t = _valid(claim_token_hash, "telegram_claim")
        if t is None:
            return "invalid", None
        record = store.users.get(t["user_id"])
        if record is None or record["email_verified_at"] is not None or record["deleted_at"] is not None:
            return "invalid", None
        t["used_at"] = _now()
        record.update(password_hash=password_hash, password_changed_at=_now(), terms_accepted_at=_now(),
                      terms_version=terms_version)
        await t_create(conn, user_id=record["id"], purpose="email_verify", token_hash=verify_token_hash,
                       expires_at=verify_expires_at, new_email=email.lower())
        return "ok", store.user_view(record)

    async def a_link_telegram(conn, token_hash, telegram_id, username):
        t = _valid(token_hash, "telegram_link")
        if t is None:
            return "invalid", None
        for other in store.users.values():
            if other["telegram_id"] == telegram_id and other["id"] != t["user_id"]:
                return "telegram_taken", None
        t["used_at"] = _now()
        record = store.users[t["user_id"]]
        record["telegram_id"] = telegram_id
        record["username"] = username or record["username"]
        return "ok", store.user_view(record)

    for name, fn in {"verify_email": a_verify_email, "reset_password": a_reset_password,
                     "confirm_email_change": a_confirm_email_change, "claim_account": a_claim_account,
                     "link_telegram": a_link_telegram}.items():
        monkeypatch.setattr(accounts, name, fn)


    # ---- shared rate limiter (PostgreSQL in production) ---------------------------------
    import time

    import app.repositories.rate_limits as rate_limits

    async def rl_hit(conn, key, limit, window_seconds):
        now = time.monotonic()
        hits = [t for t in store.rate_hits.get(key, []) if t > now - window_seconds]
        if len(hits) >= limit:
            store.rate_hits[key] = hits
            return False, max(1, int(hits[0] + window_seconds - now) + 1)
        hits.append(now)
        store.rate_hits[key] = hits
        return True, 0

    async def rl_purge(conn, *, older_than_seconds=86400):
        return 0

    monkeypatch.setattr(rate_limits, "hit", rl_hit)
    monkeypatch.setattr(rate_limits, "purge_old", rl_purge)

    # ---- external identities -----------------------------------------------------------------
    import app.repositories.identities as identities

    async def i_get_by_external(conn, provider, provider_user_id):
        for row in store.identities:
            if row["provider"] == provider and row["provider_user_id"] == provider_user_id:
                return dict(row)
        return None

    async def i_list(conn, user_id):
        return [dict(r) for r in store.identities if r["user_id"] == user_id]

    async def i_link(conn, *, user_id, provider, provider_user_id, provider_email, provider_email_verified, display_name):
        if any(r["provider"] == provider and r["provider_user_id"] == provider_user_id for r in store.identities):
            return "external_taken", None
        if any(r["provider"] == provider and r["user_id"] == user_id for r in store.identities):
            return "provider_taken", None
        row = {"id": uuid4(), "user_id": user_id, "provider": provider, "provider_user_id": provider_user_id,
               "provider_email": provider_email, "provider_email_verified": provider_email_verified,
               "display_name": display_name, "created_at": _now(), "last_login_at": None}
        store.identities.append(row)
        return "ok", dict(row)

    async def i_unlink(conn, user_id, provider):
        before = len(store.identities)
        store.identities[:] = [r for r in store.identities if not (r["user_id"] == user_id and r["provider"] == provider)]
        return len(store.identities) < before

    async def i_touch(conn, identity_id):
        return None

    for name, fn in {"get_by_external": i_get_by_external, "list_for_user": i_list, "link": i_link,
                     "unlink": i_unlink, "touch_login": i_touch}.items():
        monkeypatch.setattr(identities, name, fn)

    # ---- website administration -----------------------------------------------------------------
    import app.repositories.admin as admin_repo

    def _web_row(record):
        return {k: record[k] for k in ("id", "email", "email_verified_at", "first_name", "last_name", "is_banned",
                                       "banned_at", "last_login_at", "created_at", "deleted_at")} | {
            "telegram_linked": record["telegram_id"] is not None}

    async def a_list_web_users(conn, *, limit, offset, query=None):
        rows = [r for r in store.users.values()
                if not query or query.lower() in (r["email"] or "").lower() or query.lower() in r["first_name"].lower()]
        rows.sort(key=lambda r: r["created_at"], reverse=True)
        return [_web_row(r) for r in rows[offset: offset + limit]]

    async def a_count_web_users(conn, query=None):
        return len(await a_list_web_users(conn, limit=10**6, offset=0, query=query))

    async def a_get_web_user(conn, user_id):
        record = store.users.get(user_id)
        return _web_row(record) if record else None

    async def a_set_banned(conn, user_id, banned):
        record = store.users.get(user_id)
        if record is None or record["deleted_at"] is not None:
            return None
        record["is_banned"] = banned
        record["banned_at"] = _now() if banned else None
        if banned:
            for row in store.sessions.values():
                if row["user_id"] == user_id and row["revoked_at"] is None:
                    row["revoked_at"] = _now()
        return _web_row(record)

    async def a_record_audit(conn, *, admin_telegram_id=None, admin_user_id=None, action, target_type=None,
                             target_id=None, details=None):
        store.audit.append({"id": uuid4(), "action": action, "target_type": target_type, "target_id": target_id,
                            "details": details, "created_at": _now(), "admin_telegram_id": admin_telegram_id,
                            "admin_user_id": admin_user_id,
                            "admin_email": store.users[admin_user_id]["email"] if admin_user_id in store.users else None})

    async def a_list_audit(conn, *, limit, offset):
        return list(reversed(store.audit))[offset: offset + limit]

    async def a_stats(conn):
        return {"total_users": len(store.users), "banned_users": sum(u["is_banned"] for u in store.users.values()),
                "total_teams": 0, "total_trainings": 0, "total_matches": 0, "total_tasks": 0, "pending_notifications": 0}

    for name, fn in {"list_web_users": a_list_web_users, "count_web_users": a_count_web_users,
                     "get_web_user": a_get_web_user, "set_banned_by_id": a_set_banned, "record_audit": a_record_audit,
                     "list_audit": a_list_audit, "get_project_stats": a_stats}.items():
        monkeypatch.setattr(admin_repo, name, fn)
