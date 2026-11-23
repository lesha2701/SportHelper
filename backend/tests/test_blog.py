"""The blog: articles with a check and an administrator's approval, likes, comments, photos, the home-page pick, complaints.
Real PostgreSQL, real sessions."""
from __future__ import annotations

import asyncio
from uuid import UUID

import asyncpg
import pytest

from app.repositories import users as users_repo
from app.services import blog as blog_svc
from tests.admin_world import _LISTING, Browser, live_client, pg, publish_listing, sql, sql_value, upload, world  # noqa: F401
from tests.image_helpers import jpeg_bytes

POSTS = "/api/blog/posts"
ADMIN = "/api/admin/blog"
TEXT = "Хорошая разминка начинается с суставов: плечи, локти, запястья. Не торопитесь и дышите ровно."


@pytest.fixture(autouse=True)
def fresh_pick():
    blog_svc.forget_picks()
    yield
    blog_svc.forget_picks()


def article(**extra) -> dict:
    return {"title": "Как разминаться перед игрой", "sport": "Футбол", "blocks": [{"type": "paragraph", "text": TEXT}], "image_ids": [], "submit": True, **extra}


def code(response) -> str:
    return response.json()["error"]["code"]


def guest(world, method: str, path: str, **kwargs):
    world.client.cookies.clear()
    return world.client.request(method, path, **kwargs)


def player(world, email: str = "reader@example.com", name: str = "Анна") -> Browser:
    return Browser(world.client, email, name, "player")


def coach(world, email: str = "coach@example.com", *, listing: bool = True) -> Browser:
    person = Browser(world.client, email, "Тренер", "coach")
    if listing:
        publish_listing(person, "Футбол для взрослых")
    else:
        person.ok("PUT", "/api/profile/coach", json={"full_name": "Тренер Иван", "sport": "Футбол", "experience_years": 5, "specialization": None, "description": None})
    return person


def publish(world, author: Browser, **extra) -> dict:
    """An article through the whole road: sent, approved by an administrator."""
    post = author.ok("POST", POSTS, json=article(**extra))
    if post["status"] == "pending":
        world.admin.ok("POST", f"{ADMIN}/posts/{post['id']}/approve")
    return author.ok("GET", f"{POSTS}/{post['id']}")


# --- sending an article ---------------------------------------------------------------------------------------------------


def test_an_article_waits_for_the_administrator_and_then_everyone_reads_it(world) -> None:
    author = coach(world)
    post = author.ok("POST", POSTS, json=article())
    assert post["status"] == "pending" and post["is_mine"] and post["published_at"] is None

    # not in the feed, not readable by others or by guests, but the author sees it among theirs
    assert guest(world, "GET", POSTS).json()["total"] == 0
    assert guest(world, "GET", f"{POSTS}/{post['id']}").status_code == 404
    assert player(world).call("GET", f"{POSTS}/{post['id']}").status_code == 404
    assert [p["status"] for p in author.ok("GET", "/api/blog/mine")] == ["pending"]
    assert world.admin.ok("GET", f"{ADMIN}/pending-count") == {"pending": 1}

    done = world.admin.ok("POST", f"{ADMIN}/posts/{post['id']}/approve")
    assert done["status"] == "published"
    feed = guest(world, "GET", POSTS).json()
    assert feed["total"] == 1 and feed["items"][0]["author"]["name"] == "Тренер Футбол для взрослых"
    assert guest(world, "GET", f"{POSTS}/{post['id']}").status_code == 200
    note = sql(world.dsn, "SELECT category, title FROM notifications WHERE user_id = $1::uuid", author.user_id)[0]
    assert note["category"] == "post_review"
    assert world.admin.ok("GET", f"{ADMIN}/pending-count") == {"pending": 0}


def test_the_automatic_check_refuses_contacts_and_bad_articles(world) -> None:
    author = player(world)
    for bad in (
        article(blocks=[{"type": "paragraph", "text": TEXT + " Звоните +7 999 123-45-67"}]),
        article(blocks=[{"type": "paragraph", "text": TEXT + " Моя почта ivan@mail.ru"}]),
        article(blocks=[{"type": "quote", "text": TEXT + " t.me/ivan"}]),
        article(title="Пишите @ivan_tennis"),
        article(blocks=[{"type": "paragraph", "text": "Коротко"}]),
        article(blocks=[{"type": "paragraph", "text": "а" * 3_500}] * 3),
        article(sport="Подводное плетение"),
        article(title="Да"),
    ):
        response = author.call("POST", POSTS, json=bad)
        assert response.status_code == 422 and code(response) == "article_rejected", bad
    assert sql_value(world.dsn, "SELECT count(*) FROM posts") == 0


def test_promo_words_do_not_refuse_the_article_but_flag_it_for_the_administrator(world) -> None:
    author = player(world)
    post = author.ok("POST", POSTS, json=article(blocks=[{"type": "paragraph", "text": TEXT + " Только сегодня скидка на абонемент."}]))
    assert post["status"] == "pending" and post["flags"] == ["promo_words"]
    assert world.admin.ok("GET", f"{ADMIN}/posts/{post['id']}")["flags"] == ["promo_words"]
    assert player(world, "other@example.com").call("GET", f"{POSTS}/{post['id']}").status_code == 404


def test_a_draft_is_not_sent_and_flags_are_only_for_the_author(world) -> None:
    author = player(world)
    draft = author.ok("POST", POSTS, json=article(submit=False, blocks=[{"type": "paragraph", "text": "черновик"}]))
    assert draft["status"] == "draft"
    assert world.admin.ok("GET", f"{ADMIN}/pending-count") == {"pending": 0}
    sent = author.ok("PUT", f"{POSTS}/{draft['id']}", json=article())
    assert sent["status"] == "pending"
    assert world.admin.ok("GET", f"{ADMIN}/posts", params={"status": "draft"})["total"] == 0  # drafts are not the administrators' business


def test_the_markup_is_kept_as_text_and_unknown_blocks_are_dropped(world) -> None:
    author = player(world)
    body = [
        {"type": "heading", "text": "Про **главное**"}, {"type": "paragraph", "text": TEXT + " Это *важно*."},
        {"type": "list", "items": ["раз", "", "два"]}, {"type": "quote", "text": "   "},
    ]
    post = author.ok("POST", POSTS, json=article(blocks=body))
    assert post["blocks"] == [
        {"type": "heading", "text": "Про **главное**", "items": None}, {"type": "paragraph", "text": TEXT + " Это *важно*.", "items": None},
        {"type": "list", "text": None, "items": ["раз", "два"]},
    ]
    response = author.call("POST", POSTS, json=article(blocks=[{"type": "html", "text": "<b>x</b>"}]))
    assert response.status_code == 422  # not a known block type


# --- the author's rights and trusted authors -------------------------------------------------------------------------------


def test_editing_a_published_article_sends_it_back_unless_the_author_is_trusted(world) -> None:
    author = player(world)
    post = publish(world, author)
    edited = author.ok("PUT", f"{POSTS}/{post['id']}", json=article(title="Новый заголовок"))
    assert edited["status"] == "pending" and edited["sent_for_review"] is True
    assert guest(world, "GET", POSTS).json()["total"] == 0
    world.admin.ok("POST", f"{ADMIN}/posts/{post['id']}/approve")

    world.admin.ok("PUT", f"{ADMIN}/authors/{author.user_id}/trusted", json={"trusted": True})
    again = author.ok("PUT", f"{POSTS}/{post['id']}", json=article(title="И ещё один"))
    assert again["status"] == "published" and again["sent_for_review"] is False
    assert guest(world, "GET", POSTS).json()["items"][0]["title"] == "И ещё один"
    # trusted is not exempt from the automatic check
    assert author.call("PUT", f"{POSTS}/{post['id']}", json=article(title="Звоните 89991234567 сейчас")).status_code == 422


def test_a_trusted_author_publishes_at_once_and_it_can_be_withdrawn(world) -> None:
    author = player(world)
    world.admin.ok("PUT", f"{ADMIN}/authors/{author.user_id}/trusted", json={"trusted": True})
    assert world.admin.ok("GET", f"{ADMIN}/authors/{author.user_id}")["trusted"] is True
    assert author.ok("POST", POSTS, json=article())["status"] == "published"
    world.admin.ok("PUT", f"{ADMIN}/authors/{author.user_id}/trusted", json={"trusted": False})
    assert author.ok("POST", POSTS, json=article(title="Следующая статья"))["status"] == "pending"
    actions = {r["action"] for r in sql(world.dsn, "SELECT action FROM admin_audit_log")}
    assert {"post_author_trusted", "post_author_untrusted"} <= actions


def test_only_the_author_changes_or_deletes_an_article(world) -> None:
    author, other = player(world), player(world, "other@example.com", "Борис")
    post = publish(world, author)
    assert other.call("PUT", f"{POSTS}/{post['id']}", json=article()).status_code == 404
    assert other.call("DELETE", f"{POSTS}/{post['id']}").status_code == 404
    author.ok("DELETE", f"{POSTS}/{post['id']}")
    assert guest(world, "GET", f"{POSTS}/{post['id']}").status_code == 404
    assert guest(world, "GET", POSTS).json()["total"] == 0


# --- the administrators ------------------------------------------------------------------------------------------------------


def test_the_administrator_rejects_removes_and_restores_with_reasons_and_an_audit_trail(world) -> None:
    author = player(world)
    post = author.ok("POST", POSTS, json=article())
    pid = post["id"]
    assert world.admin.call("POST", f"{ADMIN}/posts/{pid}/reject", json={}).status_code == 422  # a reason is required
    rejected = world.admin.ok("POST", f"{ADMIN}/posts/{pid}/reject", json={"reason": "Похоже на рекламу"})
    assert rejected["status"] == "rejected"
    mine = author.ok("GET", f"{POSTS}/{pid}")
    assert mine["status"] == "rejected" and mine["reject_reason"] == "Похоже на рекламу"
    body = sql(world.dsn, "SELECT body FROM notifications WHERE user_id = $1::uuid AND category = 'post_review'", author.user_id)[0]["body"]
    assert "Похоже на рекламу" in body

    # fixed and sent again: back in the queue with the reason cleared
    resent = author.ok("PUT", f"{POSTS}/{pid}", json=article())
    assert resent["status"] == "pending" and resent["reject_reason"] is None
    world.admin.ok("POST", f"{ADMIN}/posts/{pid}/approve")
    assert code(world.admin.call("POST", f"{ADMIN}/posts/{pid}/approve")) == "bad_transition"
    removed = world.admin.ok("POST", f"{ADMIN}/posts/{pid}/remove", json={"reason": "Жалобы читателей"})
    assert removed["status"] == "removed"
    assert guest(world, "GET", f"{POSTS}/{pid}").status_code == 404
    assert author.call("PUT", f"{POSTS}/{pid}", json=article()).status_code == 409  # the author cannot revive a removed article
    assert world.admin.ok("POST", f"{ADMIN}/posts/{pid}/restore")["status"] == "published"
    assert guest(world, "GET", f"{POSTS}/{pid}").status_code == 200
    actions = [r["action"] for r in sql(world.dsn, "SELECT action FROM admin_audit_log WHERE action LIKE 'post_%' ORDER BY created_at")]
    assert actions == ["post_reject", "post_approve", "post_remove", "post_restore"]


def test_the_queue_filters_and_orders(world) -> None:
    a, b = player(world), player(world, "b@example.com", "Борис")
    first = a.ok("POST", POSTS, json=article(title="Первая статья"))
    second = b.ok("POST", POSTS, json=article(title="Вторая статья"))
    world.admin.ok("POST", f"{ADMIN}/posts/{second['id']}/approve")
    pending = world.admin.ok("GET", f"{ADMIN}/posts", params={"status": "pending"})
    assert [p["id"] for p in pending["items"]] == [first["id"]]
    assert world.admin.ok("GET", f"{ADMIN}/posts", params={"q": "Вторая"})["items"][0]["id"] == second["id"]
    assert world.admin.ok("GET", f"{ADMIN}/posts")["total"] == 2


def test_the_administration_is_closed_to_everyone_else(world) -> None:
    person = player(world)
    assert person.call("GET", f"{ADMIN}/posts").status_code == 403
    assert guest(world, "GET", f"{ADMIN}/posts").status_code == 401
    assert person.call("PUT", f"{ADMIN}/authors/{person.user_id}/trusted", json={"trusted": True}).status_code == 403


# --- photos --------------------------------------------------------------------------------------------------------------------


def _photo(author: Browser, seed: int = 1) -> str:
    response = upload(author, "/api/blog/images", jpeg_bytes((1200, 900), seed=seed))
    assert response.status_code == 201, response.text
    return response.json()["file_id"]


def test_an_article_carries_up_to_three_photos_in_order_and_guests_can_see_them(world) -> None:
    author = player(world)
    ids = [_photo(author, n) for n in (1, 2, 3)]
    post = publish(world, author, image_ids=ids[::-1])
    assert post["image_ids"] == ids[::-1]
    card = guest(world, "GET", POSTS).json()["items"][0]
    assert card["cover_file_id"] == ids[2] and card["images_count"] == 3
    assert guest(world, "GET", f"/api/files/{ids[0]}", params={"size": "thumb"}).status_code == 200
    # one photo cannot serve two articles, and a fourth is not allowed
    assert author.call("POST", POSTS, json=article(image_ids=[ids[0]])).status_code == 422
    assert author.call("POST", POSTS, json=article(image_ids=[_photo(author, n) for n in (4, 5, 6, 7)])).status_code == 422


def test_somebody_elses_photo_cannot_be_attached(world) -> None:
    author, other = player(world), player(world, "other@example.com", "Борис")
    foreign = _photo(other)
    response = author.call("POST", POSTS, json=article(image_ids=[foreign]))
    assert response.status_code == 422 and code(response) == "image_not_usable"
    assert author.call("POST", POSTS, json=article(image_ids=["00000000-0000-0000-0000-000000000000"])).status_code == 422
    # the avatar or a listing photo is not an article photo either
    upload(author, "/api/users/me/avatar", jpeg_bytes((600, 600)), "me.jpg")
    avatar = sql_value(world.dsn, "SELECT avatar_file_id::text FROM users WHERE id = $1::uuid", author.user_id)
    assert author.call("POST", POSTS, json=article(image_ids=[avatar])).status_code == 422


def test_only_images_are_uploaded(world) -> None:
    author = player(world)
    assert upload(author, "/api/blog/images", b"%PDF-1.4", "a.pdf", "application/pdf").status_code == 415
    world.client.cookies.clear()
    assert world.client.post("/api/blog/images", files={"file": ("a.jpg", jpeg_bytes(), "image/jpeg")}).status_code in (401, 403)


def test_a_removed_articles_photos_are_hidden_by_moderation_not_by_this_feature(world) -> None:
    author = player(world)
    photo = _photo(author)
    post = publish(world, author, image_ids=[photo])
    world.admin.ok("POST", f"{ADMIN}/posts/{post['id']}/remove", json={"reason": "Нарушение"})
    # the article is gone for readers; its cover is no longer offered anywhere
    assert guest(world, "GET", POSTS).json()["total"] == 0


# --- the listing card ----------------------------------------------------------------------------------------------------------


def test_a_trainer_attaches_one_of_their_own_listings(world) -> None:
    trainer = coach(world)
    listing = trainer.ok("GET", "/api/coach-listings")[0]
    post = publish(world, trainer, listing_id=listing["id"])
    assert post["listing"]["id"] == listing["id"] and post["listing"]["coach_user_id"] == trainer.user_id
    assert guest(world, "GET", f"{POSTS}/{post['id']}").json()["listing"]["title"] == listing["title"]
    # a listing that is switched off disappears from the article by itself
    trainer.ok("PUT", f"/api/coach-listings/{listing['id']}", json={**_LISTING, "title": listing["title"], "is_listed": False})
    assert guest(world, "GET", f"{POSTS}/{post['id']}").json()["listing"] is None


def test_a_listing_can_only_be_attached_by_its_trainer(world) -> None:
    trainer, rival = coach(world), coach(world, "rival@example.com")
    athlete = player(world)
    mine = trainer.ok("GET", "/api/coach-listings")[0]["id"]
    response = rival.call("POST", POSTS, json=article(listing_id=mine))
    assert response.status_code == 422 and code(response) == "listing_not_allowed"
    assert athlete.call("POST", POSTS, json=article(listing_id=mine)).status_code == 422


# --- likes, saved, hidden --------------------------------------------------------------------------------------------------------


def test_likes_count_once_per_person_and_guests_cannot_like(world) -> None:
    author, reader, other = player(world), player(world, "r@example.com", "Борис"), player(world, "o@example.com", "Вера")
    post = publish(world, author)
    url = f"{POSTS}/{post['id']}/like"
    assert reader.ok("PUT", url) == {"liked": True, "likes_count": 1}
    assert reader.ok("PUT", url) == {"liked": True, "likes_count": 1}
    assert other.ok("PUT", url)["likes_count"] == 2
    assert reader.ok("GET", f"{POSTS}/{post['id']}")["liked_by_me"] is True
    assert guest(world, "GET", f"{POSTS}/{post['id']}").json()["liked_by_me"] is False
    assert reader.ok("DELETE", url) == {"liked": False, "likes_count": 1}
    assert guest(world, "PUT", url).status_code in (401, 403)


def test_saved_articles_form_a_list(world) -> None:
    author, reader = player(world), player(world, "r@example.com", "Борис")
    one, two = publish(world, author, title="Первая статья"), publish(world, author, title="Вторая статья")
    reader.ok("PUT", f"{POSTS}/{one['id']}/bookmark")
    reader.ok("PUT", f"{POSTS}/{two['id']}/bookmark")
    reader.ok("PUT", f"{POSTS}/{one['id']}/bookmark")
    assert [p["title"] for p in reader.ok("GET", "/api/blog/bookmarks")["items"]] == ["Вторая статья", "Первая статья"]
    assert reader.ok("GET", f"{POSTS}/{one['id']}")["bookmarked_by_me"] is True
    reader.ok("DELETE", f"{POSTS}/{one['id']}/bookmark")
    assert [p["title"] for p in reader.ok("GET", "/api/blog/bookmarks")["items"]] == ["Вторая статья"]


def test_a_reader_hides_an_article_or_an_author_for_themselves_only(world) -> None:
    author, other = player(world), player(world, "o@example.com", "Борис")
    reader = player(world, "r@example.com", "Вера")
    one, two = publish(world, author, title="Первая статья"), publish(world, other, title="Вторая статья")
    reader.ok("PUT", f"{POSTS}/{one['id']}/hide")
    assert [p["title"] for p in reader.ok("GET", POSTS)["items"]] == ["Вторая статья"]
    assert guest(world, "GET", POSTS).json()["total"] == 2  # others still see both
    reader.ok("PUT", f"/api/blog/authors/{other.user_id}/mute")
    assert reader.ok("GET", POSTS)["total"] == 0
    reader.ok("DELETE", f"{POSTS}/{one['id']}/hide")
    reader.ok("DELETE", f"/api/blog/authors/{other.user_id}/mute")
    assert reader.ok("GET", POSTS)["total"] == 2
    assert reader.call("PUT", f"/api/blog/authors/{reader.user_id}/mute").status_code == 400
    assert two["id"]


def test_a_blocked_person_disappears_from_the_blog_both_ways(world) -> None:
    author, reader = player(world), player(world, "r@example.com", "Вера")
    post = publish(world, author)
    reader.ok("PUT", f"/api/blocks/{author.user_id}")
    assert reader.ok("GET", POSTS)["total"] == 0
    reader.ok("DELETE", f"/api/blocks/{author.user_id}")
    author.ok("PUT", f"/api/blocks/{reader.user_id}")
    assert reader.ok("GET", POSTS)["total"] == 0 and post["id"]


# --- views --------------------------------------------------------------------------------------------------------------------


def test_views_count_signed_in_readers_once_a_day_and_not_the_author(world) -> None:
    author, reader = player(world), player(world, "r@example.com", "Вера")
    post = publish(world, author)
    url = f"{POSTS}/{post['id']}/view"
    assert guest(world, "POST", url).status_code in (401, 403)
    author.ok("POST", url)
    reader.ok("POST", url)
    reader.ok("POST", url)
    player(world, "x@example.com", "Борис").ok("POST", url)
    assert guest(world, "GET", f"{POSTS}/{post['id']}").json()["views_count"] == 2
    sql(world.dsn, "UPDATE post_views SET day = day - 1 WHERE user_id = $1::uuid", reader.user_id)
    reader.ok("POST", url)  # a new day: counted again
    assert guest(world, "GET", f"{POSTS}/{post['id']}").json()["views_count"] == 3


# --- comments ------------------------------------------------------------------------------------------------------------------


def test_comments_hide_contacts_notify_the_author_and_keep_the_counter(world) -> None:
    author, reader = player(world), player(world, "r@example.com", "Борис")
    post = publish(world, author)
    url = f"{POSTS}/{post['id']}/comments"
    plain = reader.ok("POST", url, json={"body": "Спасибо, очень полезно!"})
    assert plain["contact_hidden"] is False and plain["author"]["name"] == "Борис" and plain["is_mine"]
    masked = reader.ok("POST", url, json={"body": "Пишите мне @boris_coach или +7 999 123-45-67"})
    assert masked["contact_hidden"] is True and "@boris_coach" not in masked["body"] and "[контакт скрыт]" in masked["body"]

    listed = guest(world, "GET", url).json()
    assert [c["body"] for c in listed][0] == "Спасибо, очень полезно!" and listed[0]["is_mine"] is False
    assert guest(world, "GET", f"{POSTS}/{post['id']}").json()["comments_count"] == 2
    note = sql(world.dsn, "SELECT category, body FROM notifications WHERE user_id = $1::uuid AND category = 'post_comment'", author.user_id)
    assert len(note) == 1 and "Борис" in note[0]["body"]  # two comments, one ping
    assert guest(world, "POST", url, json={"body": "аноним"}).status_code in (401, 403)
    assert reader.call("POST", url, json={"body": "   "}).status_code == 422
    assert reader.call("POST", url, json={"body": "я" * 1001}).status_code == 422


def test_a_comment_is_deleted_by_its_writer_or_the_articles_author_and_nobody_else(world) -> None:
    author, reader, other = player(world), player(world, "r@example.com", "Борис"), player(world, "o@example.com", "Вера")
    post = publish(world, author)
    url = f"{POSTS}/{post['id']}/comments"
    first = reader.ok("POST", url, json={"body": "Первый"})
    second = reader.ok("POST", url, json={"body": "Второй"})
    assert other.call("DELETE", f"/api/blog/comments/{first['id']}").status_code == 403
    reader.ok("DELETE", f"/api/blog/comments/{first['id']}")
    author.ok("DELETE", f"/api/blog/comments/{second['id']}")
    assert guest(world, "GET", url).json() == []
    assert guest(world, "GET", f"{POSTS}/{post['id']}").json()["comments_count"] == 0
    assert reader.call("DELETE", f"/api/blog/comments/{first['id']}").status_code == 404


def test_the_administrator_hides_a_comment(world) -> None:
    author, reader = player(world), player(world, "r@example.com", "Борис")
    post = publish(world, author)
    comment = reader.ok("POST", f"{POSTS}/{post['id']}/comments", json={"body": "Купите мой курс"})
    assert world.admin.call("POST", f"{ADMIN}/comments/{comment['id']}/hide", json={}).status_code == 422
    world.admin.ok("POST", f"{ADMIN}/comments/{comment['id']}/hide", json={"reason": "Реклама"})
    assert guest(world, "GET", f"{POSTS}/{post['id']}/comments").json() == []
    assert guest(world, "GET", f"{POSTS}/{post['id']}").json()["comments_count"] == 0
    assert sql_value(world.dsn, "SELECT count(*) FROM admin_audit_log WHERE action = 'post_comment_hide'") == 1


# --- complaints ---------------------------------------------------------------------------------------------------------------


def test_complaints_on_an_article_and_a_comment_including_advertising(world) -> None:
    author, reader = player(world), player(world, "r@example.com", "Борис")
    post = publish(world, author)
    comment = reader.ok("POST", f"{POSTS}/{post['id']}/comments", json={"body": "Комментарий"})
    complaint = reader.ok("POST", "/api/complaints", json={"target_type": "post", "target_id": post["id"], "reason": "advertising"})
    assert complaint["status"] == "new"
    other = player(world, "o@example.com", "Вера")
    other.ok("POST", "/api/complaints", json={"target_type": "post_comment", "target_id": comment["id"], "reason": "spam"})

    queue = world.admin.ok("GET", "/api/admin/complaints")["items"]
    by_type = {c["target"]["type"]: c for c in queue}
    assert by_type["post"]["reason"] == "advertising" and by_type["post"]["target"]["label"] == post["title"]
    assert by_type["post"]["target"]["state"] == "visible" and by_type["post"]["target"]["owner"]["id"] == author.user_id
    assert by_type["post_comment"]["target"]["label"] == "Комментарий"
    assert world.admin.ok("GET", f"{ADMIN}/posts", params={"with_complaints": "true"})["items"][0]["open_complaints"] == 1

    # one cannot report one's own article or comment, or something that is not published
    assert author.call("POST", "/api/complaints", json={"target_type": "post", "target_id": post["id"], "reason": "spam"}).status_code == 400
    draft = author.ok("POST", POSTS, json=article(submit=False))
    assert reader.call("POST", "/api/complaints", json={"target_type": "post", "target_id": draft["id"], "reason": "spam"}).status_code == 404

    world.admin.ok("POST", f"{ADMIN}/posts/{post['id']}/remove", json={"reason": "По жалобе"})
    state = world.admin.ok("GET", "/api/admin/complaints", params={"target_type": "post"})["items"][0]["target"]["state"]
    assert state == "hidden"


# --- the author's card -----------------------------------------------------------------------------------------------------------


def test_a_trainers_card_is_open_and_a_players_only_if_they_allow_it(world) -> None:
    trainer, athlete = coach(world), player(world, "a@example.com", "Анна")
    athlete.ok("PUT", "/api/profile/player", json={"full_name": "Анна Иванова", "sport": "Футбол", "age": 20, "height_cm": None, "weight_kg": None,
                                                   "position": None, "level": "amateur", "goals": None, "load_restrictions": None})
    publish(world, trainer, title="Статья тренера")
    post = publish(world, athlete, title="Статья игрока")

    card = guest(world, "GET", f"/api/blog/authors/{trainer.user_id}").json()
    assert card["is_coach"] and card["profile_open"] and card["sport"] == "Теннис" and card["posts_count"] == 1

    closed = guest(world, "GET", f"/api/blog/authors/{athlete.user_id}").json()
    assert closed["name"] == "Анна" and closed["profile_open"] is False and closed["sport"] is None and closed["avatar_file_id"] is None
    assert guest(world, "GET", f"{POSTS}/{post['id']}").json()["author"]["name"] == "Анна"

    assert athlete.ok("GET", "/api/blog/settings") == {"show_profile_in_posts": False, "is_coach": False}
    athlete.ok("PUT", "/api/blog/settings", json={"show_profile_in_posts": True})
    opened = guest(world, "GET", f"/api/blog/authors/{athlete.user_id}").json()
    assert opened["profile_open"] is True and opened["name"] == "Анна Иванова" and opened["sport"] == "Футбол"
    assert [p["title"] for p in guest(world, "GET", POSTS, params={"author_id": athlete.user_id}).json()["items"]] == ["Статья игрока"]
    assert guest(world, "GET", f"/api/blog/authors/{player(world, 'n@example.com', 'Новый').user_id}").status_code == 404  # no articles, no card


# --- the home-page pick and the feed -----------------------------------------------------------------------------------------------


def test_the_home_block_shows_the_best_article_of_the_readers_sport(world) -> None:
    author, reader = player(world), player(world, "r@example.com", "Вера")
    reader.ok("PUT", "/api/profile/player", json={"full_name": "Вера", "sport": "Хоккей", "age": 20, "height_cm": None, "weight_kg": None,
                                                  "position": None, "level": "amateur", "goals": None, "load_restrictions": None})
    football = publish(world, author, title="Про футбол", sport="Футбол")
    publish(world, author, title="Про хоккей, тихая", sport="Хоккей")
    loud = publish(world, author, title="Про хоккей, громкая", sport="Хоккей")
    author_fan = player(world, "fan@example.com", "Борис")
    author_fan.ok("PUT", f"{POSTS}/{loud['id']}/like")
    author_fan.ok("POST", f"{POSTS}/{loud['id']}/comments", json={"body": "Отлично"})
    blog_svc.forget_picks()

    assert reader.ok("GET", "/api/blog/featured")["title"] == "Про хоккей, громкая"
    # no sport in the profile (or a guest): the best of everything
    assert guest(world, "GET", "/api/blog/featured").json()["title"] == "Про хоккей, громкая"
    # a sport with no articles falls back to the best overall
    other = player(world, "s@example.com", "Глеб")
    other.ok("PUT", "/api/profile/player", json={"full_name": "Глеб", "sport": "Бокс", "age": 20, "height_cm": None, "weight_kg": None,
                                                 "position": None, "level": "amateur", "goals": None, "load_restrictions": None})
    assert other.ok("GET", "/api/blog/featured")["title"] == "Про хоккей, громкая" and football["id"]
    # the reader who hid it gets another one
    reader.ok("PUT", f"{POSTS}/{loud['id']}/hide")
    assert reader.ok("GET", "/api/blog/featured")["title"] == "Про хоккей, тихая"


def test_the_home_block_is_empty_without_articles_and_falls_back_to_old_ones(world) -> None:
    assert guest(world, "GET", "/api/blog/featured").json() is None
    author = player(world)
    post = publish(world, author)
    sql(world.dsn, "UPDATE posts SET published_at = now() - interval '60 days' WHERE id = $1::uuid", post["id"])
    blog_svc.forget_picks()
    assert guest(world, "GET", "/api/blog/featured").json()["id"] == post["id"]  # older than the window, but better than nothing


def test_the_feed_filters_by_sport_and_sorts_new_or_popular(world) -> None:
    author, fan = player(world), player(world, "f@example.com", "Борис")
    old = publish(world, author, title="Старая", sport="Футбол")
    new = publish(world, author, title="Новая", sport="Футбол")
    publish(world, author, title="Хоккейная", sport="Хоккей")
    sql(world.dsn, "UPDATE posts SET published_at = now() - interval '2 days' WHERE id = $1::uuid", old["id"])
    fan.ok("PUT", f"{POSTS}/{old['id']}/like")
    fan.ok("POST", f"{POSTS}/{old['id']}/comments", json={"body": "Класс"})
    football = guest(world, "GET", POSTS, params={"sport": "Футбол"}).json()
    assert [p["title"] for p in football["items"]] == ["Новая", "Старая"] and football["total"] == 2
    assert guest(world, "GET", POSTS, params={"sport": "Футбол", "sort": "new"}).json()["items"][0]["id"] == new["id"]
    assert [p["title"] for p in guest(world, "GET", POSTS, params={"sport": "Футбол", "sort": "popular"}).json()["items"]] == ["Старая", "Новая"]
    paged = guest(world, "GET", POSTS, params={"limit": 1, "offset": 1}).json()
    assert paged["total"] == 3 and len(paged["items"]) == 1
    assert guest(world, "GET", POSTS, params={"sport": "Подводное плетение"}).status_code == 422
    assert guest(world, "GET", "/api/blog/sports").json() == list(blog_svc.SPORTS)


# --- removing a person's data --------------------------------------------------------------------------------------------------------


def test_deleting_an_account_removes_the_persons_articles_comments_and_marks(world) -> None:
    author, reader = player(world), player(world, "r@example.com", "Вера")
    photo = _photo(author)
    post = publish(world, author, image_ids=[photo])
    reader.ok("PUT", f"{POSTS}/{post['id']}/like")
    keep = publish(world, reader, title="Статья читателя")
    author.ok("POST", f"{POSTS}/{keep['id']}/comments", json={"body": "От автора"})

    async def erase() -> None:
        conn = await asyncpg.connect(world.dsn)
        try:
            await users_repo.anonymize(conn, UUID(author.user_id))
        finally:
            await conn.close()

    asyncio.run(erase())
    assert sql_value(world.dsn, "SELECT count(*) FROM posts WHERE author_id = $1::uuid", author.user_id) == 0
    assert sql_value(world.dsn, "SELECT count(*) FROM post_comments WHERE author_id = $1::uuid", author.user_id) == 0
    assert sql_value(world.dsn, "SELECT deleted_at IS NOT NULL FROM files WHERE id = $1::uuid", photo) is True
    assert guest(world, "GET", f"{POSTS}/{keep['id']}/comments").json() == []
    assert guest(world, "GET", f"{POSTS}/{keep['id']}").json()["comments_count"] == 0
