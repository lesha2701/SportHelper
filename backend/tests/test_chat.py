"""Chats of a personal training and of a team, on a real PostgreSQL: who gets in, what stops them, what is sent and who hears about it."""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from app.config import get_settings
from tests.admin_world import ADMIN_EMAIL, live_client, pg, upload, world  # noqa: F401  (fixtures)
from tests.finance_helpers import FakeProvider, confirmed_booking, enable_payments, webhook
from tests.image_helpers import jpeg_bytes
from tests.live_helpers import Browser, sql, sql_value


@pytest.fixture
def fin(world, monkeypatch):  # noqa: F811
    provider = FakeProvider()
    enable_payments(monkeypatch, provider)
    return SimpleNamespace(world=world, provider=provider, dsn=world.dsn)


def paid(fin, n: int = 0):
    coach, player, booking = confirmed_booking(fin.world, coach_email=f"coach{n}@example.com", player_email=f"player{n}@example.com", title=f"Спорт {n}", confirm=True)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    pid = next(p for p in fin.provider.payments if fin.provider.payments[p]["metadata"]["booking_id"] == booking["id"])
    fin.provider.finish(pid, "succeeded")
    assert webhook(fin.world, pid).status_code == 200
    return coach, player, booking


def say(who: Browser, chat_id: str, text: str, key: str | None = None):
    return who.call("POST", f"/api/chats/{chat_id}/messages", json={"body": text, "client_key": key or str(uuid.uuid4())})


def team_of(coach: Browser, *members: Browser) -> str:
    coach.ok("PUT", "/api/profile/coach", json={"full_name": "Тренер Команды", "sport": "Футбол", "experience_years": 5, "specialization": None, "description": None})
    team = coach.ok("POST", "/api/teams", json={"name": "Ястребы", "description": None, "sport": "Футбол", "age_category": None, "level": None})
    for person in members:
        sql(person_dsn(coach), "INSERT INTO team_members (team_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'player')", team["id"], person.user_id)
    return team["id"]


_DSN: dict[int, str] = {}


def person_dsn(browser: Browser) -> str:
    return _DSN[id(browser.client)]


@pytest.fixture(autouse=True)
def _remember_dsn(world):  # noqa: F811
    _DSN[id(world.client)] = world.dsn


# --- a personal training --------------------------------------------------------------------------------------------------------


def test_the_chat_opens_after_the_lesson_is_paid_and_both_people_can_talk(fin) -> None:
    coach, player, booking = paid(fin)

    opened = player.ok("GET", f"/api/chats/for-booking/{booking['id']}")
    assert opened["kind"] == "booking" and opened["can_send"] is True and opened["title"] == "Тренер Спорт 0"  # the coach's profile name, as the player sees it everywhere
    assert coach.ok("GET", f"/api/chats/for-booking/{booking['id']}")["id"] == opened["id"]  # one chat for both
    assert say(player, opened["id"], "Здравствуйте! Что взять с собой?").status_code == 201
    assert say(coach, opened["id"], "Ракетку и воду.").status_code == 201

    seen = coach.ok("GET", f"/api/chats/{opened['id']}/messages")
    assert [m["body"] for m in seen["items"]] == ["Здравствуйте! Что взять с собой?", "Ракетку и воду."]
    assert seen["items"][0]["sender_name"] == "Игрок" and seen["has_more_before"] is False


def test_there_is_no_chat_before_the_lesson_is_confirmed_and_paid(fin) -> None:
    coach, player, booking = confirmed_booking(fin.world, confirm=False)
    assert player.call("GET", f"/api/chats/for-booking/{booking['id']}").status_code == 409  # not confirmed yet
    coach.ok("POST", f"/api/bookings/{booking['id']}/confirm")

    unpaid = player.call("GET", f"/api/chats/for-booking/{booking['id']}")
    assert unpaid.status_code == 409 and unpaid.json()["error"]["code"] == "chat_not_available"
    assert sql_value(fin.dsn, "SELECT count(*) FROM chat_conversations") == 0  # nothing is created by looking


def test_a_free_lesson_gets_a_chat_once_confirmed(fin) -> None:
    coach, player, booking = confirmed_booking(fin.world, confirm=True)
    sql(fin.dsn, "UPDATE bookings SET price_per_session = NULL WHERE id = $1::uuid", booking["id"])
    assert player.ok("GET", f"/api/chats/for-booking/{booking['id']}")["can_send"] is True


def test_strangers_cannot_even_tell_a_booking_chat_exists(fin) -> None:
    coach, player, booking = paid(fin)
    chat = player.ok("GET", f"/api/chats/for-booking/{booking['id']}")
    stranger = Browser(fin.world.client, "stranger@example.com", "Чужой", "player")

    assert stranger.call("GET", f"/api/chats/for-booking/{booking['id']}").status_code == 404
    assert stranger.call("GET", f"/api/chats/{chat['id']}").status_code == 404
    assert stranger.call("GET", f"/api/chats/{chat['id']}/messages").status_code == 404
    assert say(stranger, chat["id"], "я тоже здесь").status_code == 404
    assert stranger.call("POST", f"/api/chats/{chat['id']}/read", json={"up_to_id": 5}).status_code == 404
    other_coach = Browser(fin.world.client, "othercoach@example.com", "Другой", "coach")
    assert other_coach.call("GET", f"/api/chats/for-booking/{booking['id']}").status_code == 404
    assert sql_value(fin.dsn, "SELECT count(*) FROM chat_messages") == 0


def test_signing_in_and_the_csrf_token_are_required(fin) -> None:
    coach, player, booking = paid(fin)
    chat = player.ok("GET", f"/api/chats/for-booking/{booking['id']}")
    fin.world.client.cookies.clear()
    assert fin.world.client.get(f"/api/chats/{chat['id']}/messages").status_code == 401
    player.call("GET", "/api/chats/unread")  # puts the player's cookies back
    forged = fin.world.client.post(f"/api/chats/{chat['id']}/messages", json={"body": "hi", "client_key": str(uuid.uuid4())}, headers={"X-CSRF-Token": "forged"})
    assert forged.status_code == 403 and sql_value(fin.dsn, "SELECT count(*) FROM chat_messages") == 0


def test_a_refund_closes_sending_but_the_history_stays_readable(fin) -> None:
    coach, player, booking = paid(fin)
    chat = player.ok("GET", f"/api/chats/for-booking/{booking['id']}")
    assert say(player, chat["id"], "до возврата").status_code == 201
    sql(fin.dsn, "UPDATE payments SET status = 'refunded', refund_reserved_kopecks = gross_kopecks, refunded_kopecks = gross_kopecks")

    reopened = player.ok("GET", f"/api/chats/for-booking/{booking['id']}")
    assert reopened["can_send"] is False and "оплат" in reopened["send_blocked_reason"].lower()
    closed = say(player, chat["id"], "после возврата")
    assert closed.status_code == 409 and closed.json()["error"]["code"] == "chat_closed"
    assert [m["body"] for m in coach.ok("GET", f"/api/chats/{chat['id']}/messages")["items"]] == ["до возврата"]


# --- sending ----------------------------------------------------------------------------------------------------------------------


def test_sending_twice_with_the_same_key_creates_one_message(fin) -> None:
    coach, player, booking = paid(fin)
    chat = player.ok("GET", f"/api/chats/for-booking/{booking['id']}")
    key = str(uuid.uuid4())

    first, again = say(player, chat["id"], "один раз", key), say(player, chat["id"], "один раз", key)

    assert (first.status_code, again.status_code) == (201, 200) and first.json()["id"] == again.json()["id"]
    assert sql_value(fin.dsn, "SELECT count(*) FROM chat_messages") == 1


def test_empty_and_oversized_messages_are_refused_and_text_is_cleaned(fin) -> None:
    coach, player, booking = paid(fin)
    chat = player.ok("GET", f"/api/chats/for-booking/{booking['id']}")

    assert say(player, chat["id"], "   \n  ").status_code == 422
    assert say(player, chat["id"], "я" * 2001).status_code == 422
    assert say(player, chat["id"], "<b>жирный</b>\x00\x07 текст").json()["body"] == "<b>жирный</b> текст"  # stored as text; the page never renders HTML


def test_new_messages_are_fetched_after_a_cursor_and_old_ones_page_backwards(fin) -> None:
    coach, player, booking = paid(fin)
    chat = player.ok("GET", f"/api/chats/for-booking/{booking['id']}")
    ids = [say(player, chat["id"], f"сообщение {i}").json()["id"] for i in range(5)]

    news = coach.ok("GET", f"/api/chats/{chat['id']}/messages", params={"after_id": ids[2]})
    assert [m["id"] for m in news["items"]] == ids[3:]
    latest = coach.ok("GET", f"/api/chats/{chat['id']}/messages", params={"limit": 2})
    assert [m["id"] for m in latest["items"]] == ids[3:] and latest["has_more_before"] is True
    older = coach.ok("GET", f"/api/chats/{chat['id']}/messages", params={"limit": 2, "before_id": ids[3]})
    assert [m["id"] for m in older["items"]] == ids[1:3] and older["has_more_before"] is True


def test_people_can_delete_only_their_own_messages(fin) -> None:
    coach, player, booking = paid(fin)
    chat = player.ok("GET", f"/api/chats/for-booking/{booking['id']}")
    mine = say(player, chat["id"], "моё").json()["id"]

    assert coach.call("DELETE", f"/api/chats/{chat['id']}/messages/{mine}").status_code == 403  # not even the coach
    assert player.call("DELETE", f"/api/chats/{chat['id']}/messages/{mine}").status_code == 204
    listed = coach.ok("GET", f"/api/chats/{chat['id']}/messages")["items"]
    assert listed[0]["deleted"] is True and listed[0]["body"] is None  # the text is gone for everyone


# --- photos and videos ------------------------------------------------------------------------------------------------------------


def test_a_photo_is_optimised_stored_and_shown_to_both_people_only(fin) -> None:
    coach, player, booking = paid(fin)
    chat = player.ok("GET", f"/api/chats/for-booking/{booking['id']}")

    sent = player.call("POST", f"/api/chats/{chat['id']}/messages/media", data={"client_key": str(uuid.uuid4()), "body": "Вот моя форма"},
                       files={"file": ("форма.jpg", jpeg_bytes((2400, 1800)), "image/jpeg")})

    assert sent.status_code == 201, sent.text
    message = sent.json()
    assert message["body"] == "Вот моя форма" and message["attachment"]["kind"] == "photo" and message["attachment"]["filename"].endswith(".webp")
    file_id = message["attachment"]["file_id"]
    assert sql_value(fin.dsn, "SELECT access_level FROM files WHERE id = $1::uuid", file_id) == "CHAT"
    assert sql_value(fin.dsn, "SELECT size_bytes FROM files WHERE id = $1::uuid", file_id) < len(jpeg_bytes((2400, 1800)))  # optimised, like every photo
    assert coach.call("GET", f"/api/files/{file_id}").status_code == 200
    assert player.call("GET", f"/api/files/{file_id}?size=thumb").status_code == 200
    stranger = Browser(fin.world.client, "stranger@example.com", "Чужой", "player")
    assert stranger.call("GET", f"/api/files/{file_id}").status_code == 403
    fin.world.client.cookies.clear()
    assert fin.world.client.get(f"/api/files/{file_id}").status_code == 401  # never public


def test_a_video_follows_the_site_wide_limits(fin, queue_video_duration) -> None:
    coach, player, booking = paid(fin)
    chat = player.ok("GET", f"/api/chats/for-booking/{booking['id']}")
    clip = {"file": ("упражнение.mp4", b"\x00\x00\x00\x18ftypmp42" + b"0" * 2000, "video/mp4")}

    ok = player.call("POST", f"/api/chats/{chat['id']}/messages/media", data={"client_key": str(uuid.uuid4())}, files=clip)
    assert ok.status_code == 201 and ok.json()["attachment"]["kind"] == "video"
    assert coach.call("GET", f"/api/files/{ok.json()['attachment']['file_id']}").status_code == 200

    queue_video_duration(get_settings().max_video_duration_seconds + 30)
    long = player.call("POST", f"/api/chats/{chat['id']}/messages/media", data={"client_key": str(uuid.uuid4())}, files=clip)
    assert long.status_code == 413 and long.json()["error"]["code"] == "video_too_long"
    assert sql_value(fin.dsn, "SELECT count(*) FROM chat_messages") == 1  # the refused video created nothing


def test_other_file_types_are_refused(fin) -> None:
    coach, player, booking = paid(fin)
    chat = player.ok("GET", f"/api/chats/for-booking/{booking['id']}")
    for name, data, content_type in [("a.pdf", b"%PDF-1.4", "application/pdf"), ("a.exe", b"MZ", "application/octet-stream"), ("a.svg", b"<svg/>", "image/svg+xml")]:
        refused = player.call("POST", f"/api/chats/{chat['id']}/messages/media", data={"client_key": str(uuid.uuid4())}, files={"file": (name, data, content_type)})
        assert refused.status_code == 415
    broken = player.call("POST", f"/api/chats/{chat['id']}/messages/media", data={"client_key": str(uuid.uuid4())}, files={"file": ("x.jpg", b"not an image", "image/jpeg")})
    assert broken.status_code in (400, 415, 422)
    assert sql_value(fin.dsn, "SELECT count(*) FROM chat_messages") == 0 and sql_value(fin.dsn, "SELECT count(*) FROM files WHERE access_level = 'CHAT'") == 0


def test_a_retried_upload_stores_the_file_once_and_a_deleted_message_hides_its_file(fin) -> None:
    coach, player, booking = paid(fin)
    chat = player.ok("GET", f"/api/chats/for-booking/{booking['id']}")
    key = str(uuid.uuid4())
    send = lambda: player.call("POST", f"/api/chats/{chat['id']}/messages/media", data={"client_key": key}, files={"file": ("f.jpg", jpeg_bytes((900, 700)), "image/jpeg")})

    first, again = send(), send()

    assert (first.status_code, again.status_code) == (201, 200) and sql_value(fin.dsn, "SELECT count(*) FROM files WHERE access_level = 'CHAT'") == 1
    file_id = first.json()["attachment"]["file_id"]
    assert player.call("DELETE", f"/api/chats/{chat['id']}/messages/{first.json()['id']}").status_code == 204
    assert coach.call("GET", f"/api/files/{file_id}").status_code in (403, 404)  # the picture goes with the message
    assert sql_value(fin.dsn, "SELECT deleted_at IS NOT NULL FROM files WHERE id = $1::uuid", file_id) is True


# --- notifications and unread --------------------------------------------------------------------------------------------------------


def test_the_other_person_is_told_once_per_unread_streak_and_the_counters_follow(fin) -> None:
    coach, player, booking = paid(fin)
    chat = player.ok("GET", f"/api/chats/for-booking/{booking['id']}")
    for text in ("раз", "два", "три"):
        say(player, chat["id"], text)

    bells = [n for n in coach.ok("GET", "/api/notifications") if n["category"] == "chat_booking"]
    assert len(bells) == 1 and bells[0]["entity_id"] == booking["id"] and bells[0]["title"] == "Сообщение от Игрок"  # not three
    assert not [n for n in player.ok("GET", "/api/notifications") if n["category"] == "chat_booking"]  # nor the sender
    assert coach.ok("GET", "/api/chats/unread") == {"booking": {booking["id"]: 3}, "team": {}, "total": 3}

    last = coach.ok("GET", f"/api/chats/{chat['id']}/messages")["items"][-1]["id"]
    assert coach.call("POST", f"/api/chats/{chat['id']}/read", json={"up_to_id": last}).status_code == 204
    assert coach.ok("GET", "/api/chats/unread")["total"] == 0
    assert coach.call("POST", f"/api/chats/{chat['id']}/read", json={"up_to_id": 1}).status_code == 204  # never moves backwards
    assert coach.ok("GET", "/api/chats/unread")["total"] == 0
    say(player, chat["id"], "четыре")  # after reading: a new streak, a new notification
    assert len([n for n in coach.ok("GET", "/api/notifications") if n["category"] == "chat_booking"]) == 2
    assert player.ok("GET", "/api/chats/unread")["total"] == 0  # one's own messages are never unread


def test_chat_notifications_can_be_switched_off(fin) -> None:
    coach, player, booking = paid(fin)
    chat = player.ok("GET", f"/api/chats/for-booking/{booking['id']}")
    names = [p["category"] for p in coach.ok("GET", "/api/notifications/preferences")]
    assert "chat_booking" in names and "chat_team" in names
    coach.ok("PUT", "/api/notifications/preferences", json={"preferences": [{"category": "chat_booking", "enabled": False}]})
    say(player, chat["id"], "тихо")
    from app.services import background
    from tests.finance_helpers import run, with_conn

    run(with_conn(fin.dsn, lambda c: background.send_due_notifications(c, None, get_settings())))
    assert not [n for n in coach.ok("GET", "/api/notifications") if n["category"] == "chat_booking"]


# --- a team ------------------------------------------------------------------------------------------------------------------------


def test_every_member_can_talk_in_the_team_chat_and_outsiders_cannot(world) -> None:  # noqa: F811
    coach = Browser(world.client, "teamcoach@example.com", "Тренер", "coach")
    anna = Browser(world.client, "anna@example.com", "Анна", "player")
    boris = Browser(world.client, "boris@example.com", "Борис", "player")
    outsider = Browser(world.client, "outsider@example.com", "Чужой", "player")
    team_id = team_of(coach, anna, boris)

    chat = anna.ok("GET", f"/api/chats/for-team/{team_id}")
    assert chat["kind"] == "team" and chat["title"] == "Ястребы" and chat["can_send"] is True and chat["can_moderate"] is False
    assert coach.ok("GET", f"/api/chats/for-team/{team_id}")["can_moderate"] is True
    assert say(anna, chat["id"], "Привет, команда!").status_code == 201
    assert say(boris, chat["id"], "Привет!").status_code == 201
    assert [m["body"] for m in coach.ok("GET", f"/api/chats/{chat['id']}/messages")["items"]] == ["Привет, команда!", "Привет!"]

    assert outsider.call("GET", f"/api/chats/for-team/{team_id}").status_code == 404
    assert say(outsider, chat["id"], "можно к вам?").status_code == 404
    notified = {p.email: [n for n in p.ok("GET", "/api/notifications") if n["category"] == "chat_team"] for p in (coach, anna, boris)}
    assert len(notified["anna@example.com"]) == 1 and len(notified["boris@example.com"]) == 1 and len(notified["teamcoach@example.com"]) == 1
    assert notified["boris@example.com"][0]["entity_id"] == team_id and "Анна" in notified["boris@example.com"][0]["body"]


def test_leaving_the_team_ends_access_to_its_chat_and_its_files(world) -> None:  # noqa: F811
    coach = Browser(world.client, "teamcoach@example.com", "Тренер", "coach")
    anna = Browser(world.client, "anna@example.com", "Анна", "player")
    team_id = team_of(coach, anna)
    chat = coach.ok("GET", f"/api/chats/for-team/{team_id}")
    sent = coach.call("POST", f"/api/chats/{chat['id']}/messages/media", data={"client_key": str(uuid.uuid4())}, files={"file": ("p.jpg", jpeg_bytes((800, 600)), "image/jpeg")})
    file_id = sent.json()["attachment"]["file_id"]
    assert anna.call("GET", f"/api/files/{file_id}").status_code == 200

    sql(world.dsn, "DELETE FROM team_members WHERE team_id = $1::uuid AND user_id = $2::uuid", team_id, anna.user_id)

    assert anna.call("GET", f"/api/chats/{chat['id']}/messages").status_code == 404
    assert anna.call("GET", f"/api/files/{file_id}").status_code == 403
    assert say(anna, chat["id"], "я ещё здесь?").status_code == 404
    assert anna.ok("GET", "/api/chats/unread")["total"] == 0


def test_team_coaches_can_delete_any_message_but_players_only_their_own(world) -> None:  # noqa: F811
    coach = Browser(world.client, "teamcoach@example.com", "Тренер", "coach")
    anna = Browser(world.client, "anna@example.com", "Анна", "player")
    boris = Browser(world.client, "boris@example.com", "Борис", "player")
    team_id = team_of(coach, anna, boris)
    chat = anna.ok("GET", f"/api/chats/for-team/{team_id}")
    annas = say(anna, chat["id"], "плохое слово").json()["id"]

    assert boris.call("DELETE", f"/api/chats/{chat['id']}/messages/{annas}").status_code == 403
    assert coach.call("DELETE", f"/api/chats/{chat['id']}/messages/{annas}").status_code == 204
    assert coach.call("DELETE", f"/api/chats/{chat['id']}/messages/{annas}").status_code in (204, 404)  # repeating is harmless
    assert sql_value(world.dsn, "SELECT deleted_by IS NOT NULL FROM chat_messages WHERE id = $1", annas) is True


def test_one_chat_per_team_and_per_booking(world) -> None:  # noqa: F811
    coach = Browser(world.client, "teamcoach@example.com", "Тренер", "coach")
    team_id = team_of(coach)
    ids = {coach.ok("GET", f"/api/chats/for-team/{team_id}")["id"] for _ in range(3)}
    assert len(ids) == 1 and sql_value(world.dsn, "SELECT count(*) FROM chat_conversations") == 1


# --- moderation and clean-up of chat files ----------------------------------------------------------------------------------------


def test_a_moderator_can_find_hide_and_delete_a_chat_photo_and_the_message_becomes_a_tombstone(fin) -> None:
    coach, player, booking = paid(fin)
    chat = player.ok("GET", f"/api/chats/for-booking/{booking['id']}")
    sent = player.call("POST", f"/api/chats/{chat['id']}/messages/media", data={"client_key": str(uuid.uuid4()), "body": "смотрите"},
                       files={"file": ("p.jpg", jpeg_bytes((900, 700)), "image/jpeg")}).json()
    file_id = sent["attachment"]["file_id"]
    admin = fin.world.admin

    found = admin.ok("GET", "/api/admin/media", params={"kind": "chat"})
    assert [m["id"] for m in found["items"]] == [file_id]
    assert admin.call("POST", f"/api/admin/media/{file_id}/hide", json={"reason": "Неприемлемое изображение"}).status_code == 200
    assert coach.call("GET", f"/api/files/{file_id}").status_code == 404  # hidden for everyone

    deleted = admin.call("POST", f"/api/admin/media/{file_id}/delete", json={"reason": "Нарушение правил", "confirm": True})
    assert deleted.status_code == 200, deleted.text
    message = next(m for m in coach.ok("GET", f"/api/chats/{chat['id']}/messages")["items"] if m["id"] == sent["id"])
    assert message["deleted"] is True and message["attachment"] is None and message["body"] is None
    assert sql_value(fin.dsn, "SELECT file_id IS NULL FROM chat_messages WHERE id = $1", sent["id"]) is True


def test_purging_a_deleted_chat_file_for_good_keeps_the_message_as_a_tombstone(fin) -> None:
    from app.repositories import files as files_repo
    from tests.finance_helpers import run, with_conn

    coach, player, booking = paid(fin)
    chat = player.ok("GET", f"/api/chats/for-booking/{booking['id']}")
    sent = player.call("POST", f"/api/chats/{chat['id']}/messages/media", data={"client_key": str(uuid.uuid4())},
                       files={"file": ("p.jpg", jpeg_bytes((900, 700)), "image/jpeg")}).json()
    file_id = sent["attachment"]["file_id"]
    assert player.call("DELETE", f"/api/chats/{chat['id']}/messages/{sent['id']}").status_code == 204

    run(with_conn(fin.dsn, lambda c: files_repo.hard_delete(c, uuid.UUID(file_id))))  # what the background purge does after the retention period

    assert sql_value(fin.dsn, "SELECT count(*) FROM files WHERE id = $1::uuid", file_id) == 0
    tomb = coach.ok("GET", f"/api/chats/{chat['id']}/messages")["items"][0]
    assert tomb["deleted"] is True and tomb["attachment"] is None
