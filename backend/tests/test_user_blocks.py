"""Blocking a person (App Store guideline 1.2), on a real PostgreSQL: the blocker stops seeing his chat messages, they are not unread and
send no notification, a personal-training chat between the two is closed for sending (worded the same for both), and unblocking
brings everything back."""
from __future__ import annotations

from tests.admin_world import live_client, pg, world  # noqa: F401  (fixtures)
from tests.live_helpers import Browser, sql_value
from tests.test_chat import _remember_dsn, fin, paid, say, team_of  # noqa: F401  (fixtures and helpers)

BLOCKS = "/api/blocks"


def bodies(who: Browser, chat_id: str) -> list[str]:
    return [m["body"] for m in who.ok("GET", f"/api/chats/{chat_id}/messages")["items"]]


def team_chat(fin):
    """A team chat with three people: (head coach, player a, player b, chat id)."""
    coach = Browser(fin.world.client, "head@example.com", "Тренер", "coach")
    a = Browser(fin.world.client, "a@example.com", "Анна", "player")
    b = Browser(fin.world.client, "b@example.com", "Борис", "player")
    team_of(coach, a, b)
    return coach, a, b, coach.ok("GET", f"/api/chats/for-team/{_team_id(fin, coach)}")["id"]


def _team_id(fin, coach: Browser) -> str:
    return sql_value(fin.dsn, "SELECT id::text FROM teams WHERE name = 'Ястребы'")


def test_a_blocked_persons_team_messages_disappear_for_the_blocker_only(fin) -> None:
    coach, a, b, chat = team_chat(fin)
    say(a, chat, "Привет всем")
    say(b, chat, "Ты ничего не понимаешь")
    assert a.call("PUT", f"{BLOCKS}/{b.user_id}").status_code == 204

    assert bodies(a, chat) == ["Привет всем"]                  # Anna no longer sees Boris
    assert bodies(coach, chat) == ["Привет всем", "Ты ничего не понимаешь"]   # everybody else still does
    assert bodies(b, chat) == ["Привет всем", "Ты ничего не понимаешь"]
    seen = a.ok("GET", f"/api/chats/{chat}/messages", params={"after_id": 0})   # the page polls for new messages: same filter
    assert [m["body"] for m in seen["items"]] == ["Привет всем"]


def test_a_blocked_persons_messages_are_not_unread_and_send_no_notification(fin) -> None:
    coach, a, b, chat = team_chat(fin)
    a.ok("PUT", f"{BLOCKS}/{b.user_id}")
    say(b, chat, "Привет, Анна")

    assert a.ok("GET", "/api/chats/unread")["total"] == 0
    assert not [n for n in a.ok("GET", "/api/notifications") if n["category"] == "chat_team"]
    assert coach.ok("GET", "/api/chats/unread")["total"] == 1                   # the coach was not blocking anybody
    assert [n for n in coach.ok("GET", "/api/notifications") if n["category"] == "chat_team"]


def test_unblocking_brings_the_messages_back(fin) -> None:
    coach, a, b, chat = team_chat(fin)
    say(b, chat, "Вернусь")
    a.ok("PUT", f"{BLOCKS}/{b.user_id}")
    assert bodies(a, chat) == []
    assert a.call("DELETE", f"{BLOCKS}/{b.user_id}").status_code == 204
    assert bodies(a, chat) == ["Вернусь"]
    assert a.call("DELETE", f"{BLOCKS}/{b.user_id}").status_code == 204        # nothing to remove: still fine


def test_a_personal_chat_is_closed_for_sending_from_both_sides_with_the_same_words(fin) -> None:
    coach, player, booking = paid(fin)
    chat = player.ok("GET", f"/api/chats/for-booking/{booking['id']}")
    say(coach, chat["id"], "До встречи")
    player.ok("PUT", f"{BLOCKS}/{coach.user_id}")

    mine = player.ok("GET", f"/api/chats/{chat['id']}")
    theirs = coach.ok("GET", f"/api/chats/{chat['id']}")
    assert mine["can_send"] is False and theirs["can_send"] is False
    assert mine["send_blocked_reason"] == theirs["send_blocked_reason"] == "Переписка в этом чате ограничена."   # nobody is told who blocked whom
    assert say(coach, chat["id"], "Алло?").json()["error"]["code"] == "chat_closed"
    assert say(player, chat["id"], "Не пишите").json()["error"]["code"] == "chat_closed"
    assert bodies(player, chat["id"]) == []                                     # the blocker does not see the coach's earlier message either

    player.ok("DELETE", f"{BLOCKS}/{coach.user_id}")
    assert say(coach, chat["id"], "Алло?").status_code == 201


def test_the_list_of_blocked_people_and_its_rules(fin) -> None:
    coach, a, b, _ = team_chat(fin)
    assert a.ok("GET", BLOCKS) == []
    a.ok("PUT", f"{BLOCKS}/{b.user_id}")
    a.ok("PUT", f"{BLOCKS}/{b.user_id}")                                        # again: nothing changes
    assert [(x["user_id"], x["full_name"]) for x in a.ok("GET", BLOCKS)] == [(b.user_id, "Борис")]
    assert b.ok("GET", BLOCKS) == []                                            # the other side sees nothing of it
    assert a.call("PUT", f"{BLOCKS}/{a.user_id}").json()["error"]["code"] == "cannot_block_self"
    assert a.call("PUT", f"{BLOCKS}/00000000-0000-4000-8000-000000000000").status_code == 404
    assert sql_value(fin.dsn, "SELECT count(*) FROM user_blocks") == 1


def test_blocking_needs_a_signed_in_person(fin) -> None:
    coach, a, b, _ = team_chat(fin)
    fin.world.client.cookies.clear()
    assert fin.world.client.put(f"{BLOCKS}/{b.user_id}").status_code in (401, 403)
    assert fin.world.client.get(BLOCKS).status_code == 401
