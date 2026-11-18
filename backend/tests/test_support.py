"""Support: a person writes to the administrators, the administrators answer - real PostgreSQL, real sessions."""
from __future__ import annotations

import pytest

from app.config import get_settings
from app.repositories import support as support_repo
from tests.admin_world import ADMIN_EMAIL, Browser, live_client, pg, sql, sql_value, world  # noqa: F401


@pytest.fixture
def author(world) -> Browser:
    return Browser(world.client, "author@example.com", "Автор")


def _write(who: Browser, kind: str = "question", subject: str = "Как сменить вид спорта?", body: str = "Не могу найти, где менять вид спорта в профиле.", **extra):
    return who.call("POST", "/api/support", json={"kind": kind, "subject": subject, "body": body, **extra})


def _guest(client, method: str, path: str, **kwargs):
    client.cookies.clear()
    return client.request(method, path, **kwargs)


def _queue(world, **params) -> dict:
    return world.admin.ok("GET", "/api/admin/support", params=params)


def _audit(world) -> list[dict]:
    return world.admin.ok("GET", "/api/admin/audit", params={"limit": 200})["items"]


# --- writing ---------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("kind", ["question", "suggestion", "conflict", "bug", "payment", "other"])
def test_a_signed_in_person_can_write_with_any_kind_of_request(author, kind) -> None:
    response = _write(author, kind)

    assert response.status_code == 201, response.text
    assert set(response.json()) == {"id", "status"} and response.json()["status"] == "new"


def test_the_text_is_stored_tidy_with_line_breaks_kept(world, author) -> None:
    _write(author, "suggestion", subject="   Тёмная   тема  ", body="  Первая строка   с пробелами\n\n\n\nВторая строка  ")

    row = sql(world.dsn, "SELECT subject, body, status, user_id::text AS user_id FROM support_requests")[0]

    assert row["subject"] == "Тёмная тема"
    assert row["body"] == "Первая строка с пробелами\n\nВторая строка"
    assert row["status"] == "new" and row["user_id"] == author.user_id


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "complaint", "subject": "Заголовок", "body": "Достаточно длинный текст"},
        {"kind": "question", "subject": "ab", "body": "Достаточно длинный текст"},
        {"kind": "question", "subject": "   ", "body": "Достаточно длинный текст"},
        {"kind": "question", "subject": "x" * 121, "body": "Достаточно длинный текст"},
        {"kind": "question", "subject": "Заголовок", "body": "коротко"},
        {"kind": "question", "subject": "Заголовок", "body": "я" * 3001},
        {"kind": "question", "subject": "Заголовок"},
        {"subject": "Заголовок", "body": "Достаточно длинный текст"},
        {"kind": "question", "subject": "Заголовок", "body": "Достаточно длинный текст", "status": "answered"},
        {"kind": "question", "subject": "Заголовок", "body": "Достаточно длинный текст", "user_id": "00000000-0000-0000-0000-000000000000"},
    ],
)
def test_an_incomplete_or_forged_request_is_refused(world, author, body) -> None:
    assert author.call("POST", "/api/support", json=body).status_code == 422
    assert sql_value(world.dsn, "SELECT count(*) FROM support_requests") == 0


def test_a_visitor_cannot_write(world) -> None:
    body = {"kind": "question", "subject": "Заголовок", "body": "Достаточно длинный текст"}
    assert _guest(world.client, "POST", "/api/support", json=body).status_code == 401
    assert _guest(world.client, "GET", "/api/support/mine").status_code == 401


def test_a_flood_of_requests_is_stopped(world, author, monkeypatch) -> None:
    monkeypatch.setenv("AUTH_RATE_LIMIT_ENABLED", "true")
    get_settings.cache_clear()

    statuses = [_write(author, subject=f"Обращение {i}").status_code for i in range(7)]

    assert statuses[:5] == [201] * 5 and statuses[5:] == [429, 429]
    assert sql_value(world.dsn, "SELECT count(*) FROM support_requests") == 5


def test_a_person_cannot_keep_unlimited_requests_waiting(author, monkeypatch) -> None:
    monkeypatch.setattr(support_repo, "MAX_OPEN_PER_USER", 2)

    responses = [_write(author, subject=f"Обращение {i}") for i in range(3)]

    assert [r.status_code for r in responses] == [201, 201, 409] and responses[2].json()["error"]["code"] == "too_many_open"


# --- reading your own -------------------------------------------------------------------------------------------------


def test_a_person_sees_only_their_own_requests(world, author) -> None:
    other = Browser(world.client, "other@example.com", "Другой")
    _write(author, subject="Мой вопрос")
    _write(other, subject="Чужой вопрос")

    mine = author.ok("GET", "/api/support/mine")

    assert [r["subject"] for r in mine] == ["Мой вопрос"]
    assert set(mine[0]) == {"id", "kind", "subject", "body", "status", "created_at", "answer", "answered_at"}
    assert mine[0]["answer"] is None and mine[0]["answered_at"] is None


# --- the administrators' queue ---------------------------------------------------------------------------------------


def test_only_administrators_can_open_the_queue(world, author) -> None:
    _write(author)

    rid = _queue(world)["items"][0]["id"]

    assert author.call("GET", "/api/admin/support").status_code in (401, 403)
    assert _guest(world.client, "GET", "/api/admin/support").status_code in (401, 403)
    for path in ("take", "answer", "close"):
        assert author.call("POST", f"/api/admin/support/{rid}/{path}", json={"answer": "сам себе ответил"}).status_code in (401, 403)
    assert _queue(world)["items"][0]["status"] == "new"


def test_the_queue_shows_the_author_and_waits_oldest_first(world, author) -> None:
    other = Browser(world.client, "other@example.com", "Другой")
    first = _write(author, subject="Первое обращение").json()["id"]
    _write(other, "bug", subject="Второе обращение")
    sql(world.dsn, "UPDATE support_requests SET created_at = now() - interval '2 days' WHERE id = $1::uuid", first)

    page = _queue(world)

    assert page["total"] == 2 and [r["subject"] for r in page["items"]] == ["Первое обращение", "Второе обращение"]
    assert page["items"][0]["author"] == {"id": author.user_id, "name": "Автор", "email": "author@example.com"}
    assert page["items"][0]["status"] == "new" and page["items"][0]["answer"] is None and page["items"][0]["handled_by"] is None


def test_the_queue_can_be_filtered_and_searched(world, author) -> None:
    _write(author, "conflict", subject="Конфликт с тренером", body="Тренер не пришёл на занятие вовремя.")
    _write(author, "suggestion", subject="Хочу уведомления", body="Пусть приходят напоминания в Telegram.")

    assert [r["kind"] for r in _queue(world, kind="conflict")["items"]] == ["conflict"]
    assert _queue(world, status="answered")["total"] == 0
    assert [r["subject"] for r in _queue(world, q="Telegram")["items"]] == ["Хочу уведомления"]
    assert _queue(world, q="author@example.com")["total"] == 2
    assert _queue(world, q=author.user_id)["total"] == 2
    assert world.admin.call("GET", "/api/admin/support", params={"kind": "nonsense"}).status_code == 422


def test_taking_a_request_is_recorded_and_cannot_be_repeated(world, author) -> None:
    rid = _write(author).json()["id"]

    taken = world.admin.call("POST", f"/api/admin/support/{rid}/take")

    assert taken.status_code == 200 and taken.json()["status"] == "in_progress"
    again = world.admin.call("POST", f"/api/admin/support/{rid}/take")
    assert again.status_code == 409 and again.json()["error"]["code"] == "bad_transition"
    assert [e["action"] for e in _audit(world) if e["target_id"] == rid] == ["support_take"]
    assert author.ok("GET", "/api/support/mine")[0]["status"] == "in_progress"


# --- answering ---------------------------------------------------------------------------------------------------------


def test_an_answer_reaches_the_author_on_the_site_and_by_mail(world, author) -> None:
    rid = _write(author, subject="Не приходит письмо").json()["id"]
    world.admin.call("POST", f"/api/admin/support/{rid}/take")
    before = len(world.client.outbox)

    done = world.admin.call("POST", f"/api/admin/support/{rid}/answer", json={"answer": "  Проверьте папку «Спам».  Мы отправили письмо повторно. "})

    assert done.status_code == 200
    body = done.json()
    assert body["status"] == "answered" and body["answer"] == "Проверьте папку «Спам». Мы отправили письмо повторно." and body["handled_by"] == ADMIN_EMAIL
    mine = author.ok("GET", "/api/support/mine")[0]
    assert mine["status"] == "answered" and mine["answer"] == body["answer"] and mine["answered_at"]
    mails = world.client.outbox[before:]
    assert [m.to for m in mails] == ["author@example.com"]
    assert "Не приходит письмо" in mails[0].text and "Проверьте папку" in mails[0].text
    entry = next(e for e in _audit(world) if e["action"] == "support_answer")
    assert entry["target_id"] == rid and entry["details"]["before"]["status"] == "in_progress" and entry["details"]["after"]["status"] == "answered"


def test_a_request_can_be_answered_without_taking_it_first(world, author) -> None:
    rid = _write(author).json()["id"]

    assert world.admin.call("POST", f"/api/admin/support/{rid}/answer", json={"answer": "Это в разделе «Профиль»."}).status_code == 200


def test_an_answer_is_final(world, author) -> None:
    rid = _write(author).json()["id"]
    world.admin.call("POST", f"/api/admin/support/{rid}/answer", json={"answer": "Это в разделе «Профиль»."})

    for path, payload in [("answer", {"answer": "ещё раз"}), ("take", None), ("close", {})]:
        again = world.admin.call("POST", f"/api/admin/support/{rid}/{path}", json=payload)
        assert again.status_code == 409, path
    assert author.ok("GET", "/api/support/mine")[0]["answer"] == "Это в разделе «Профиль»."


@pytest.mark.parametrize("body", [{}, {"answer": ""}, {"answer": "ab"}, {"answer": "я" * 3001}, {"answer": "Хороший ответ", "status": "new"}])
def test_an_answer_needs_real_words(world, author, body) -> None:
    rid = _write(author).json()["id"]

    assert world.admin.call("POST", f"/api/admin/support/{rid}/answer", json=body).status_code == 422
    assert _queue(world)["items"][0]["status"] == "new"


def test_a_request_can_be_closed_without_an_answer(world, author) -> None:
    rid = _write(author, "other", subject="Тест", body="Просто проверяю, как это работает.").json()["id"]
    before = len(world.client.outbox)

    done = world.admin.call("POST", f"/api/admin/support/{rid}/close", json={"note": "Тест, ответа не требуется"})

    assert done.status_code == 200 and done.json()["status"] == "closed" and done.json()["answer"] is None
    assert len(world.client.outbox) == before  # nothing is mailed when nothing is said
    assert author.ok("GET", "/api/support/mine")[0]["status"] == "closed"
    entry = next(e for e in _audit(world) if e["action"] == "support_close")
    assert entry["reason"] == "Тест, ответа не требуется"
    assert world.admin.call("POST", f"/api/admin/support/{rid}/answer", json={"answer": "Поздно отвечать"}).status_code == 409


def test_an_unknown_request_is_not_found(world) -> None:
    ghost = "00000000-0000-0000-0000-000000000000"

    assert world.admin.call("GET", f"/api/admin/support/{ghost}").status_code == 404
    assert world.admin.call("POST", f"/api/admin/support/{ghost}/take").status_code == 404
    assert world.admin.call("POST", f"/api/admin/support/{ghost}/answer", json={"answer": "Какой-то ответ"}).status_code == 404


def test_a_closed_request_stops_counting_as_waiting(author, monkeypatch, world) -> None:
    monkeypatch.setattr(support_repo, "MAX_OPEN_PER_USER", 1)
    first = _write(author, subject="Первое").json()["id"]
    assert _write(author, subject="Второе").status_code == 409

    world.admin.call("POST", f"/api/admin/support/{first}/answer", json={"answer": "Ответили на первое"})

    assert _write(author, subject="Второе").status_code == 201
