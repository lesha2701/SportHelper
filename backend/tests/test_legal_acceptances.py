"""What a person ticks at sign-up: the boxes each role must tick, the record kept of them, and the guarantee that the
texts the site shows are the editions the server records."""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from app.services import legal
from tests.auth_helpers import consents_for, register, register_payload
from tests.live_helpers import Browser, sql, sql_value
from tests.test_auth_postgres import live_client, pg  # noqa: F401  (fixtures)

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src" / "legal"


def _keys(consents) -> list[str]:
    return [c["key"] for c in consents]


# --- which boxes -------------------------------------------------------------------------------------------------------


def test_each_role_gets_exactly_the_boxes_of_the_scheme() -> None:
    assert [c.key for c in legal.CONSENTS_BY_ROLE["player"]] == ["terms", "personal_data"]
    assert [c.key for c in legal.CONSENTS_BY_ROLE["coach"]] == ["coach_offer", "personal_data", "data_dissemination"]
    assert [c.documents for c in legal.CONSENTS_BY_ROLE["player"]] == [("terms",), ("consent-player", "privacy")]
    assert [c.documents for c in legal.CONSENTS_BY_ROLE["coach"]] == [
        ("coach-offer", "service-terms"), ("consent-coach", "privacy"), ("consent-coach-dissemination",),
    ]


@pytest.mark.parametrize("role", ["player", "coach"])
def test_registering_records_one_row_per_box_with_the_documents_and_editions(client, role) -> None:
    response = register(client, role=role, first_name="Алиса", last_name="Иванова")

    assert response.status_code == 201
    user = client.auth_store.find_by_email("alice@example.com")
    rows = client.auth_store.acceptances
    assert [r["consent_key"] for r in rows] == [c.key for c in legal.CONSENTS_BY_ROLE[role]]
    for row in rows:
        assert row["user_id"] == user["id"] and row["role"] == role
        assert row["full_name"] == "Алиса Иванова" and row["email"] == "alice@example.com" and row["phone"] is None
        assert row["ip_address"] and row["accepted_at"]
        assert all(d["version"] == "2026-10-20" and d["title"] for d in row["documents"])
    privacy_rows = [r for r in rows if any(d["key"] == "privacy" for d in r["documents"])]
    assert len(privacy_rows) == 1  # the policy is recorded as read alongside the consent, not as a box of its own


def test_a_missing_box_stops_the_registration(client) -> None:
    consents = consents_for("coach")[:-1]  # the dissemination consent is not ticked

    response = register(client, role="coach", consents=consents)

    assert response.status_code == 422 and response.json()["error"]["field"] == "consents"
    assert client.auth_store.find_by_email("alice@example.com") is None and client.auth_store.acceptances == []


def test_boxes_of_the_other_role_do_not_count(client) -> None:
    assert register(client, role="player", consents=consents_for("coach")).status_code == 422
    assert register(client, role="coach", consents=consents_for("player")).status_code == 422
    assert client.auth_store.acceptances == []


def test_a_box_cannot_be_repeated_or_invented(client) -> None:
    twice = consents_for("player") + consents_for("player")[:1]
    invented = consents_for("player") + [{"key": "marketing", "documents": []}]

    assert register(client, consents=twice).status_code == 422
    assert register(client, consents=invented).status_code == 422
    assert register(client, consents=[]).status_code == 422


def test_the_role_is_required(client) -> None:
    payload = register_payload()
    del payload["role"]

    assert client.post("/api/auth/register", json=payload).status_code == 422


def test_old_clients_that_send_only_a_flag_are_refused(client) -> None:
    payload = register_payload()
    del payload["consents"]
    payload["accept_terms"] = True

    assert client.post("/api/auth/register", json=payload).status_code == 422


# --- the edition that was shown ----------------------------------------------------------------------------------------


def test_consent_to_an_outdated_edition_is_refused_and_nothing_is_created(client) -> None:
    consents = consents_for("player")
    consents[0]["documents"][0]["version"] = "2026-09-01"

    response = register(client, consents=consents)

    assert response.status_code == 409 and response.json()["error"]["code"] == "documents_outdated"
    assert client.auth_store.find_by_email("alice@example.com") is None and client.auth_store.acceptances == []


def test_a_box_that_covered_other_documents_than_the_server_expects_is_refused(client) -> None:
    consents = consents_for("player")
    consents[1]["documents"] = consents[1]["documents"][:1]  # the policy link was not on the form

    assert register(client, consents=consents).status_code == 409


def test_a_taken_address_records_nothing(client) -> None:
    from tests.auth_helpers import sign_up

    sign_up(client, email="taken@example.com")
    before = len(client.auth_store.acceptances)

    response = register(client, email="taken@example.com", first_name="Другой")

    assert response.status_code == 409 and len(client.auth_store.acceptances) == before


# --- the site's texts and the server's list agree ----------------------------------------------------------------------


def test_the_servers_documents_are_the_ones_the_site_publishes() -> None:
    if not FRONTEND.exists():
        pytest.skip("the frontend sources are not next to the backend")
    meta = (FRONTEND / "documents.ts").read_text(encoding="utf8")
    for key, doc in legal.DOCUMENTS.items():
        data = json.loads((FRONTEND / "data" / f"{key}.json").read_text(encoding="utf8"))
        assert data["key"] == key and data["title"] == doc.title and data["version"] == doc.version, key
        block = re.search(r'"?%s"?: \{(.*?)\n  \}' % re.escape(key), meta, re.S)
        assert block, f"{key} is missing from frontend/src/legal/documents.ts"
        assert re.search(r'version: "%s"' % re.escape(doc.version), block.group(1)), f"{key}: edition differs from documents.ts"
        assert re.search(r'title: "%s"' % re.escape(doc.title), block.group(1)), f"{key}: title differs from documents.ts"


def test_the_site_offers_the_same_boxes_as_the_server() -> None:
    if not FRONTEND.exists():
        pytest.skip("the frontend sources are not next to the backend")
    meta = (FRONTEND / "documents.ts").read_text(encoding="utf8")
    for role, consents in legal.CONSENTS_BY_ROLE.items():
        section = re.search(r"\b%s: \[(.*?)\n  \]" % role, meta, re.S).group(1)
        found = re.findall(r'key: "(\w+)", documents: \[([^\]]*)\]', section)
        assert [(k, tuple(re.findall(r'"([\w-]+)"', docs))) for k, docs in found] == [(c.key, c.documents) for c in consents]


# --- real database -----------------------------------------------------------------------------------------------------


def test_the_record_is_stored_and_cannot_be_altered(live_client, pg) -> None:  # noqa: F811
    person = Browser(live_client, "coach@example.com", "Тренер", "coach")

    rows = sql(pg, "SELECT consent_key, role, email, full_name, documents, ip_address FROM legal_acceptances WHERE user_id = $1::uuid ORDER BY consent_key", person.user_id)
    assert [r["consent_key"] for r in rows] == ["coach_offer", "data_dissemination", "personal_data"]
    assert all(r["role"] == "coach" and r["email"] == "coach@example.com" and r["ip_address"] for r in rows)
    offer = next(r for r in rows if r["consent_key"] == "coach_offer")
    assert [d["key"] for d in json.loads(offer["documents"])] == ["coach-offer", "service-terms"]
    assert sql_value(pg, "SELECT preferred_role FROM users WHERE id = $1::uuid", person.user_id) == "coach"

    for statement in ("UPDATE legal_acceptances SET ip_address = '0.0.0.0'", "DELETE FROM legal_acceptances", "TRUNCATE legal_acceptances"):
        with pytest.raises(Exception, match="append-only"):
            sql(pg, statement)
    assert sql_value(pg, "SELECT count(*) FROM legal_acceptances") == 3


def test_an_ordinary_player_cannot_become_a_coach_and_the_lock_is_in_the_database_flow(live_client, pg) -> None:  # noqa: F811
    player = Browser(live_client, "p@example.com", "Игрок", "player")

    assert player.call("PUT", "/api/profile/coach", json={"full_name": "Т", "sport": "Бег", "experience_years": 1, "specialization": None, "description": None}).status_code == 403
    assert player.call("POST", "/api/profile/active-mode", json={"mode": "coach"}).status_code == 403
    assert sql_value(pg, "SELECT count(*) FROM coach_profiles") == 0
    assert sql_value(pg, "SELECT preferred_role FROM users WHERE id = $1::uuid", player.user_id) == "player"


def test_the_migration_fixes_the_role_of_existing_accounts_from_what_they_already_are(pg) -> None:
    import asyncio

    import asyncpg

    from tests.test_auth_postgres import _apply

    patch = (Path(__file__).resolve().parents[2] / "database" / "patches" / "0038_legal_acceptances_and_role_lock.sql").read_text(encoding="utf8")
    backfill = patch[patch.index("UPDATE users u"):]

    async def scenario():
        conn = await asyncpg.connect(pg)
        try:
            await _apply(conn)
            ids = {}
            for name, preferred, active in (("active", "player", "coach"), ("picked", "coach", None), ("coach_only", None, None),
                                            ("player_only", None, None), ("both", None, None), ("nothing", None, None)):
                ids[name] = await conn.fetchval(
                    "INSERT INTO users (email, email_verified_at, first_name, preferred_role, active_mode) VALUES ($1, now(), $2, $3, $4) RETURNING id",
                    f"{name}@example.com", name, preferred, active)
            await conn.execute("INSERT INTO coach_profiles (user_id, full_name, sport) VALUES ($1, 'C', 'x'), ($2, 'C', 'x'), ($3, 'C', 'x')",
                               ids["coach_only"], ids["both"], ids["active"])
            await conn.execute("INSERT INTO player_profiles (user_id, full_name, sport) VALUES ($1, 'P', 'x'), ($2, 'P', 'x')", ids["player_only"], ids["both"])
            await conn.execute(backfill)
            return {name: await conn.fetchval("SELECT preferred_role FROM users WHERE id = $1", uid) for name, uid in ids.items()}
        finally:
            await conn.close()

    # an account that works in coach mode is a coach even if it once said "player"; one with two profiles and no signal stays open
    assert asyncio.run(scenario()) == {"active": "coach", "picked": "coach", "coach_only": "coach", "player_only": "player", "both": None, "nothing": None}
