"""Moderation of photos and videos: finding them, hiding and restoring them, deleting them safely."""
from __future__ import annotations

import asyncio

import asyncpg
import pytest

from app.integrations.yandex_disk import YandexDiskError
from app.repositories import admin_media as media_repo
from tests.admin_world import ADMIN_EMAIL, Browser, add_user, live_client, pg, publish_listing, sql, sql_value, upload, world  # noqa: F401
from tests.conftest import _FakeYandexDiskClient, _shared_disk_storage
from tests.image_helpers import jpeg_bytes


def _media(world, **params) -> dict:
    return world.admin.ok("GET", "/api/admin/media", params=params)


def _hide(world, file_id: str, reason: str = "Неприемлемое изображение"):
    return world.admin.call("POST", f"/api/admin/media/{file_id}/hide", json={"reason": reason})


def _restore(world, file_id: str, reason: str = "Проверили — всё в порядке"):
    return world.admin.call("POST", f"/api/admin/media/{file_id}/restore", json={"reason": reason})


def _delete(world, file_id: str, reason: str = "Нарушение правил", confirm: bool = True):
    return world.admin.call("POST", f"/api/admin/media/{file_id}/delete", json={"reason": reason, "confirm": confirm})


def _audit(world) -> list[dict]:
    return world.admin.ok("GET", "/api/admin/audit", params={"limit": 200})["items"]


class Scene:
    """A coach with a published listing and a photo on it, a player with an avatar and a gallery photo."""

    def __init__(self, world):
        self.world = world
        self.coach = Browser(world.client, "coach@example.com", "Тренер", "coach")
        self.player = Browser(world.client, "player@example.com", "Игрок", "player")
        self.listing = publish_listing(self.coach, "Теннис для взрослых")
        self.listing_photo = self._file(upload(self.coach, f"/api/coach-listings/{self.listing['id']}/photo", jpeg_bytes((1600, 1200))), "photo_file_id")
        self.avatar = self._file(upload(self.player, "/api/users/me/avatar", jpeg_bytes((900, 900)), "me.jpg"), "avatar_file_id")
        self.gallery = self._file(upload(self.player, "/api/profile/media/photo", jpeg_bytes((1800, 1200)), "g.jpg"), "file_id")

    @staticmethod
    def _file(response, key: str) -> str:
        assert response.status_code == 200, response.text
        return response.json()[key]


@pytest.fixture
def scene(world) -> Scene:
    return Scene(world)


# --- finding media ------------------------------------------------------------------------------------------------


def test_media_is_listed_with_owner_kind_and_paging(world, scene) -> None:
    page = _media(world)

    assert page["total"] == 3
    by_id = {m["id"]: m for m in page["items"]}
    assert by_id[scene.avatar]["kind"] == "avatar" and by_id[scene.avatar]["owner"]["email"] == "player@example.com"
    assert by_id[scene.listing_photo]["kind"] == "listing" and by_id[scene.listing_photo]["media_type"] == "image"
    assert by_id[scene.gallery]["kind"] == "gallery" and by_id[scene.gallery]["has_thumb"] is True
    assert _media(world, limit=2)["total"] == 3 and len(_media(world, limit=2)["items"]) == 2
    assert _media(world, limit=2, offset=2)["items"][0]["id"] in by_id


def test_filters_and_author_search(world, scene) -> None:
    assert [m["id"] for m in _media(world, kind="avatar")["items"]] == [scene.avatar]
    assert [m["id"] for m in _media(world, kind="listing")["items"]] == [scene.listing_photo]
    assert {m["id"] for m in _media(world, q="player@example.com")["items"]} == {scene.avatar, scene.gallery}
    assert {m["id"] for m in _media(world, q=scene.coach.user_id)["items"]} == {scene.listing_photo}
    assert [m["id"] for m in _media(world, q=scene.gallery)["items"]] == [scene.gallery]
    assert _media(world, media_type="video")["items"] == []
    assert _media(world, q="nobody")["items"] == []
    _hide(world, scene.avatar)
    assert [m["id"] for m in _media(world, state="hidden")["items"]] == [scene.avatar]
    assert scene.avatar not in {m["id"] for m in _media(world, state="visible")["items"]}


@pytest.mark.parametrize("params", [{"kind": "bogus"}, {"media_type": "audio"}, {"state": "x"}, {"limit": 500}, {"offset": -1}])
def test_media_list_parameters_are_validated(world, params) -> None:
    assert world.admin.call("GET", "/api/admin/media", params=params).status_code == 422


def test_the_detail_links_the_file_to_its_listing_or_profile(world, scene) -> None:
    listing_photo = world.admin.ok("GET", f"/api/admin/media/{scene.listing_photo}")
    avatar = world.admin.ok("GET", f"/api/admin/media/{scene.avatar}")

    assert listing_photo["related"] == {"type": "listing", "id": scene.listing["id"], "label": "Объявление «Теннис для взрослых»"}
    assert avatar["related"]["type"] == "user" and avatar["related"]["id"] == scene.player.user_id
    assert "disk_path" not in str(listing_photo) and "/TeamFlow" not in str(listing_photo)  # storage paths never leave the server


def test_moderators_can_view_the_bytes_even_of_a_hidden_file(world, scene) -> None:
    _hide(world, scene.gallery)

    full = world.admin.call("GET", f"/api/admin/media/{scene.gallery}/content")
    thumb = world.admin.call("GET", f"/api/admin/media/{scene.gallery}/content", params={"size": "thumb"})

    assert full.status_code == thumb.status_code == 200
    assert full.headers["content-type"] == "image/webp" and "no-store" in full.headers["cache-control"]
    assert 0 < len(thumb.content) < len(full.content)


# --- hiding ----------------------------------------------------------------------------------------------------------


def test_a_hidden_file_vanishes_from_the_whole_platform_and_comes_back_on_restore(world, scene) -> None:
    anyone = Browser(world.client, "visitor@example.com", "Гость")
    assert anyone.call("GET", f"/api/files/{scene.avatar}").status_code == 200
    assert scene.player.ok("GET", "/api/auth/me")["avatar_file_id"] == scene.avatar

    hidden = _hide(world, scene.avatar)

    assert hidden.status_code == 200 and hidden.json()["hidden"] is True and hidden.json()["moderation_reason"] == "Неприемлемое изображение"
    assert anyone.call("GET", f"/api/files/{scene.avatar}").status_code == 404
    assert scene.player.call("GET", f"/api/files/{scene.avatar}").status_code == 404  # not even for its owner
    world.client.cookies.clear()
    assert world.client.get(f"/api/files/{scene.avatar}").status_code == 404
    assert scene.player.ok("GET", "/api/auth/me")["avatar_file_id"] is None  # the profile stops offering it
    assert world.admin.call("GET", f"/api/admin/media/{scene.avatar}/content").status_code == 200  # the moderator still sees it

    restored = _restore(world, scene.avatar)

    assert restored.status_code == 200 and restored.json()["hidden"] is False and restored.json()["moderation_reason"] is None
    assert anyone.call("GET", f"/api/files/{scene.avatar}").status_code == 200
    assert scene.player.ok("GET", "/api/auth/me")["avatar_file_id"] == scene.avatar


def test_a_hidden_gallery_photo_is_not_listed_and_a_hidden_listing_photo_is_not_offered(world, scene) -> None:
    _hide(world, scene.gallery)
    _hide(world, scene.listing_photo)

    gallery = scene.player.ok("GET", f"/api/profile/media/{scene.player.user_id}")
    card = Browser(world.client, "visitor@example.com", "Гость").ok("GET", f"/api/coach-listings/{scene.listing['id']}")
    catalogue = Browser(world.client, "visitor2@example.com", "Гость2").ok("GET", "/api/coach-listings")

    assert gallery == []
    assert card["photo_file_id"] is None
    assert [c["photo_file_id"] for c in catalogue] == [None]


def test_hiding_twice_or_restoring_a_visible_file_is_refused_and_leaves_no_trace(world, scene) -> None:
    assert _restore(world, scene.avatar).status_code == 409
    assert _hide(world, scene.avatar).status_code == 200

    again = _hide(world, scene.avatar, "ещё раз")

    assert again.status_code == 409 and again.json()["error"]["code"] == "already_hidden"
    assert [e["action"] for e in _audit(world) if e["target_id"] == scene.avatar] == ["media_hide"]


def test_moderation_needs_a_reason_and_accepts_nothing_extra(world, scene) -> None:
    for body in ({}, {"reason": ""}, {"reason": "ab"}, {"reason": "хорошая причина", "hidden": False}):
        assert world.admin.call("POST", f"/api/admin/media/{scene.avatar}/hide", json=body).status_code == 422
    assert world.admin.ok("GET", f"/api/admin/media/{scene.avatar}")["hidden"] is False


def test_hiding_is_audited_with_who_why_and_before_and_after(world, scene) -> None:
    _hide(world, scene.gallery, "Реклама казино")
    _restore(world, scene.gallery, "Это не реклама")

    entries = [e for e in _audit(world) if e["target_id"] == scene.gallery]

    assert [e["action"] for e in entries] == ["media_restore", "media_hide"]
    hide = entries[1]
    assert hide["admin"] == ADMIN_EMAIL and hide["reason"] == "Реклама казино" and hide["result"] == "success"
    assert hide["details"]["before"]["hidden"] is False and hide["details"]["after"]["hidden"] is True
    assert "disk" not in str(entries) and "path" not in str(entries).replace("target", "")


def test_a_hide_and_its_audit_entry_succeed_or_fail_together(world, scene, monkeypatch) -> None:
    from app.services import admin_audit

    async def broken(*args, **kwargs):
        raise RuntimeError("audit storage is down")

    monkeypatch.setattr(admin_audit, "record", broken)

    with pytest.raises(RuntimeError):
        _hide(world, scene.avatar)

    assert sql_value(world.dsn, "SELECT hidden_at IS NULL FROM files WHERE id = $1::uuid", scene.avatar) is True


# --- deleting ---------------------------------------------------------------------------------------------------------


def _expire_recent_code(world, minutes: int = 30) -> None:
    sql(world.dsn, "UPDATE user_sessions SET mfa_verified_at = now() - make_interval(mins => $2) WHERE user_id = $1::uuid", world.admin.user_id, minutes)


def _paths(world, file_id: str) -> list[str]:
    row = sql(world.dsn, "SELECT disk_path, thumb_disk_path FROM files WHERE id = $1::uuid", file_id)[0]
    return [p for p in (row["disk_path"], row["thumb_disk_path"]) if p]


def test_deleting_removes_the_file_everywhere_and_cleans_the_storage(world, scene) -> None:
    paths = _paths(world, scene.gallery)
    assert len(paths) == 2 and all(p in _shared_disk_storage for p in paths)

    response = _delete(world, scene.gallery)

    assert response.status_code == 200 and response.json() == {"deleted": True, "storage_deleted": True}
    assert all(p not in _shared_disk_storage for p in paths)  # main file and thumbnail are gone from the disk
    assert sql_value(world.dsn, "SELECT count(*) FROM files WHERE id = $1::uuid", scene.gallery) == 0
    assert scene.player.ok("GET", f"/api/profile/media/{scene.player.user_id}") == []
    assert scene.player.call("GET", f"/api/files/{scene.gallery}").status_code == 404
    assert world.admin.call("GET", f"/api/admin/media/{scene.gallery}").status_code == 404
    other = _paths(world, scene.avatar)  # an unrelated file is untouched
    assert all(p in _shared_disk_storage for p in other)


def test_deleting_an_avatar_detaches_it_from_the_profile(world, scene) -> None:
    assert _delete(world, scene.avatar).status_code == 200

    assert scene.player.ok("GET", "/api/auth/me")["avatar_file_id"] is None
    assert sql_value(world.dsn, "SELECT avatar_file_id FROM users WHERE id = $1::uuid", scene.player.user_id) is None


def test_deleting_needs_a_confirmation_a_reason_and_a_code_from_the_last_minutes(world, scene) -> None:
    assert world.admin.call("POST", f"/api/admin/media/{scene.avatar}/delete", json={"reason": "Нарушение правил"}).status_code == 422
    assert _delete(world, scene.avatar, confirm=False).status_code == 422
    assert _delete(world, scene.avatar, reason="x").status_code == 422
    _expire_recent_code(world)

    stale = _delete(world, scene.avatar)

    assert stale.status_code == 403 and stale.json()["error"]["code"] == "mfa_recent_required"
    assert world.admin.call("GET", "/api/admin/media").status_code == 200  # ordinary admin work still allowed
    assert sql_value(world.dsn, "SELECT count(*) FROM files WHERE id = $1::uuid", scene.avatar) == 1
    world.admin.unlock()  # the code is entered again...
    assert _delete(world, scene.avatar).status_code == 200  # ...and now it works


def test_when_the_disk_is_unreachable_the_file_is_still_removed_from_the_site_and_cleaned_up_later(world, scene, monkeypatch) -> None:
    from app.config import get_settings
    from app.services import background

    paths = _paths(world, scene.gallery)

    async def failing_delete(self, path):
        raise YandexDiskError(503, "unavailable")

    monkeypatch.setattr(_FakeYandexDiskClient, "delete", failing_delete)

    response = _delete(world, scene.gallery)

    assert response.status_code == 200 and response.json() == {"deleted": True, "storage_deleted": False}
    assert scene.player.ok("GET", f"/api/profile/media/{scene.player.user_id}") == []  # already gone from the site
    assert scene.player.call("GET", f"/api/files/{scene.gallery}").status_code == 404
    assert sql_value(world.dsn, "SELECT deleted_at IS NOT NULL FROM files WHERE id = $1::uuid", scene.gallery) is True  # kept for the clean-up
    assert all(p in _shared_disk_storage for p in paths)
    cleanup = [e for e in _audit(world) if e["action"] == "media_storage_cleanup" and e["target_id"] == scene.gallery]
    assert cleanup and cleanup[0]["result"] == "failed"

    monkeypatch.undo()  # the disk is back; the background loop runs
    monkeypatch.setenv("YANDEX_DISK_OAUTH_TOKEN", "token")
    get_settings.cache_clear()

    async def run_purge():
        conn = await asyncpg.connect(world.dsn)
        try:
            await background.purge_soft_deleted_files(conn, get_settings())
        finally:
            await conn.close()

    monkeypatch.setattr(background, "YandexDiskClient", _FakeYandexDiskClient)
    asyncio.run(run_purge())

    assert all(p not in _shared_disk_storage for p in paths)
    assert sql_value(world.dsn, "SELECT count(*) FROM files WHERE id = $1::uuid", scene.gallery) == 0


def test_a_file_shared_with_another_record_is_never_deleted(world, scene) -> None:
    sql(
        world.dsn,
        """
        INSERT INTO files (owner_id, entity_type, entity_id, disk_path, filename, mime_type, size_bytes, status, access_level)
        SELECT owner_id, 'exercise_photo', NULL, disk_path, 'copy.webp', mime_type, size_bytes, 'ready', 'PRIVATE' FROM files WHERE id = $1::uuid
        """,
        scene.avatar,
    )
    paths = _paths(world, scene.avatar)

    response = _delete(world, scene.avatar)

    assert response.status_code == 409 and response.json()["error"]["code"] == "file_shared"
    assert all(p in _shared_disk_storage for p in paths)
    assert scene.player.ok("GET", "/api/auth/me")["avatar_file_id"] == scene.avatar  # nothing was detached
    assert any(e["result"] == "denied" for e in _audit(world) if e["action"] == "media_delete")


def test_a_file_used_by_two_objects_is_never_deleted(world, scene) -> None:
    sql(world.dsn, "UPDATE users SET avatar_file_id = $1::uuid WHERE id = $2::uuid", scene.listing_photo, scene.player.user_id)

    response = _delete(world, scene.listing_photo)

    assert response.status_code == 409 and response.json()["error"]["code"] == "file_shared"
    assert sql_value(world.dsn, "SELECT photo_file_id FROM coach_listings WHERE id = $1::uuid", scene.listing["id"]) is not None


def test_files_outside_the_applications_storage_folder_are_never_removed_from_the_disk(world, scene) -> None:
    sql(world.dsn, "UPDATE files SET disk_path = '/Documents/private/passport.jpg' WHERE id = $1::uuid", scene.avatar)
    _shared_disk_storage["/Documents/private/passport.jpg"] = b"not ours"

    response = _delete(world, scene.avatar)

    assert response.status_code == 409 and response.json()["error"]["code"] == "unmanaged_path"
    assert _shared_disk_storage["/Documents/private/passport.jpg"] == b"not ours"
    sql(world.dsn, "UPDATE files SET disk_path = '/TeamFlow/sandbox/../../etc/x.jpg' WHERE id = $1::uuid", scene.avatar)
    assert _delete(world, scene.avatar).status_code == 409  # path tricks do not pass either


def test_every_foreign_key_to_files_is_known_to_the_deletion_code(world) -> None:
    async def check():
        conn = await asyncpg.connect(world.dsn)
        try:
            return await media_repo.unknown_references(conn)
        finally:
            await conn.close()

    assert asyncio.run(check()) == [], "a table references files(id) but admin_media.REFERENCES does not know how to detach it"


# --- who may use these routes at all -----------------------------------------------------------------------------------


def test_only_an_unlocked_administrator_can_touch_media(world, scene) -> None:
    calls = [
        ("GET", "/api/admin/media", None),
        ("GET", f"/api/admin/media/{scene.avatar}", None),
        ("GET", f"/api/admin/media/{scene.avatar}/content", None),
        ("POST", f"/api/admin/media/{scene.avatar}/hide", {"reason": "нарушение правил"}),
        ("POST", f"/api/admin/media/{scene.avatar}/restore", {"reason": "ошибка модератора"}),
        ("POST", f"/api/admin/media/{scene.avatar}/delete", {"reason": "нарушение правил", "confirm": True}),
    ]
    for method, path, body in calls:
        world.client.cookies.clear()
        assert world.client.request(method, path, json=body).status_code == 401, ("guest", path)
        assert scene.player.call(method, path, json=body).status_code == 403, ("the file's own owner", path)
        assert scene.coach.call(method, path, json=body).status_code == 403, ("another user", path)
        locked = world.admin.fresh_session().call(method, path, json=body)
        assert locked.status_code == 403 and locked.json()["error"]["code"] == "mfa_required", ("no second factor", path)
    assert world.admin.fresh_unlocked_session().ok("GET", f"/api/admin/media/{scene.avatar}")["hidden"] is False
    assert sql_value(world.dsn, "SELECT count(*) FROM files WHERE id = $1::uuid", scene.avatar) == 1


def test_a_user_cannot_use_the_ordinary_api_to_hide_or_delete_somebody_elses_media(world, scene) -> None:
    stranger = Browser(world.client, "stranger@example.com", "Чужой")

    assert stranger.call("DELETE", f"/api/profile/media/{sql_value(world.dsn, 'SELECT id FROM profile_media LIMIT 1')}").status_code == 404
    assert stranger.call("DELETE", "/api/users/me/avatar").status_code == 200  # only their own (nothing to remove)
    assert scene.player.ok("GET", "/api/auth/me")["avatar_file_id"] == scene.avatar
    assert add_user and ADMIN_EMAIL
