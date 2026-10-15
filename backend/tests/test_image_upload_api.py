"""Image uploads end to end: what reaches Yandex.Disk (a fake here), what is stored in the database, what
the browser gets back, and the failures a user can run into."""
from __future__ import annotations

import io

import pytest
from PIL import Image

from app.integrations.yandex_disk import YandexDiskError
from tests.conftest import _shared_disk_storage, _FakeYandexDiskClient
from tests.image_helpers import exif_with, jpeg_bytes, photo, png_bytes
from tests.test_teams_api import _create_coach_profile, _create_team


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _upload_avatar(client, token, data: bytes, name: str = "me.jpg", content_type: str = "image/jpeg"):
    return client.post("/api/users/me/avatar", headers=_auth(token), files={"file": (name, io.BytesIO(data), content_type)})


def _upload_gallery_photo(client, token, data: bytes, name: str = "g.jpg", content_type: str = "image/jpeg"):
    return client.post("/api/profile/media/photo", headers=_auth(token), files={"file": (name, io.BytesIO(data), content_type)})


def _stored_paths() -> list[str]:
    return sorted(_shared_disk_storage)


def _settings_override(monkeypatch: pytest.MonkeyPatch, **env: str) -> None:
    from app.config import get_settings

    for key, value in env.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def _reset_settings():
    from app.config import get_settings

    yield
    get_settings.cache_clear()


# --- what gets stored ------------------------------------------------------------------------------------------


def test_a_phone_photo_is_stored_as_a_small_webp_and_the_original_is_never_sent(logged_in_client) -> None:
    client, token = logged_in_client
    original = jpeg_bytes((3000, 2250), quality=93, exif=exif_with(orientation=1, gps=True))

    response = _upload_avatar(client, token, original, name="IMG_2041.JPG")

    assert response.status_code == 200, response.text
    (path,) = _stored_paths()
    assert path.endswith(".webp")  # the format that was stored, not the one that was uploaded
    stored = _shared_disk_storage[path]
    assert len(stored) < len(original) * 0.2 and stored != original
    image = Image.open(io.BytesIO(stored))
    assert image.format == "WEBP" and max(image.size) == 512 and not image.getexif()


def test_the_download_has_the_right_type_a_clean_name_and_cache_headers(logged_in_client) -> None:
    client, token = logged_in_client
    file_id = _upload_avatar(client, token, jpeg_bytes((1200, 900)), name="IMG_2041.JPG").json()["avatar_file_id"]

    download = client.get(f"/api/files/{file_id}", headers=_auth(token))

    assert download.status_code == 200
    assert download.headers["content-type"] == "image/webp"
    assert 'filename="IMG_2041.webp"' in download.headers["content-disposition"]
    assert download.headers["cache-control"] == "public, max-age=86400"  # an avatar is public


def test_a_private_looking_file_is_only_cached_by_the_viewers_own_browser(logged_in_client) -> None:
    client, token = logged_in_client
    _create_coach_profile(client, token)
    team = _create_team(client, token)
    logo = client.post(f"/api/teams/{team['id']}/logo", headers=_auth(token), files={"file": ("l.png", io.BytesIO(png_bytes()), "image/png")})
    file_id = logo.json()["logo_file_id"]

    download = client.get(f"/api/files/{file_id}", headers=_auth(token))

    assert download.headers["cache-control"] == "private, max-age=3600"


def test_a_dangerous_filename_cannot_choose_where_the_file_goes_or_break_the_headers(logged_in_client) -> None:
    client, token = logged_in_client

    response = _upload_avatar(client, token, jpeg_bytes((400, 300)), name='../../../etc/passwd"\r\nX-Evil: 1.jpg')

    assert response.status_code == 200, response.text
    (path,) = _stored_paths()
    assert path.startswith("/TeamFlow/") and ".." not in path and "passwd" not in path and "Evil" not in path
    file_id = response.json()["avatar_file_id"]
    headers = client.get(f"/api/files/{file_id}", headers=_auth(token)).headers
    assert "x-evil" not in headers and "\r" not in headers["content-disposition"] and "\n" not in headers["content-disposition"]


def test_a_russian_filename_is_kept_and_the_download_still_works(logged_in_client) -> None:
    client, token = logged_in_client
    file_id = _upload_avatar(client, token, jpeg_bytes((400, 300)), name="Моё фото.jpg").json()["avatar_file_id"]

    download = client.get(f"/api/files/{file_id}", headers=_auth(token))

    assert download.status_code == 200
    assert "filename*=UTF-8''%D0%9C%D0%BE%D1%91%20%D1%84%D0%BE%D1%82%D0%BE.webp" in download.headers["content-disposition"]


def test_content_disposition_survives_any_name_an_old_record_may_hold() -> None:
    from app.api.routes.files import _content_disposition

    for name in ['a"b.png', "фото.jpg", "line\nbreak.png", "x" * 300 + ".png", ""]:
        header = _content_disposition(name)
        header.encode("latin-1")  # raises if a non-latin-1 character would reach the wire
        assert "\n" not in header and "\r" not in header


def test_a_transparent_logo_stays_transparent_end_to_end(logged_in_client) -> None:
    client, token = logged_in_client
    _create_coach_profile(client, token)
    team = _create_team(client, token)
    logo = photo((600, 600), alpha=True)
    buffer = io.BytesIO()
    logo.save(buffer, "PNG")

    response = client.post(f"/api/teams/{team['id']}/logo", headers=_auth(token), files={"file": ("l.png", io.BytesIO(buffer.getvalue()), "image/png")})

    assert response.status_code == 200, response.text
    file_id = response.json()["logo_file_id"]
    out = Image.open(io.BytesIO(client.get(f"/api/files/{file_id}", headers=_auth(token)).content))
    assert out.mode == "RGBA" and out.getpixel((3, 3))[3] == 0


# --- thumbnails ------------------------------------------------------------------------------------------------------


def test_a_gallery_photo_gets_a_thumbnail_that_lists_can_ask_for(logged_in_client) -> None:
    client, token = logged_in_client
    media = _upload_gallery_photo(client, token, jpeg_bytes((3000, 2000))).json()
    file_id = media["file_id"]

    full = client.get(f"/api/files/{file_id}", headers=_auth(token))
    thumb = client.get(f"/api/files/{file_id}?size=thumb", headers=_auth(token))

    assert full.status_code == thumb.status_code == 200
    assert len(thumb.content) < len(full.content) / 3
    assert thumb.headers["content-type"] == "image/webp"
    assert max(Image.open(io.BytesIO(thumb.content)).size) == 480
    assert max(Image.open(io.BytesIO(full.content)).size) == 1920
    assert len(_stored_paths()) == 2  # the picture and its thumbnail - not three variants of everything


def test_asking_for_a_thumbnail_of_a_file_without_one_returns_the_file_itself(logged_in_client) -> None:
    client, token = logged_in_client
    file_id = _upload_avatar(client, token, jpeg_bytes((1200, 900))).json()["avatar_file_id"]  # avatars have no thumbnail

    full = client.get(f"/api/files/{file_id}", headers=_auth(token))
    thumb = client.get(f"/api/files/{file_id}?size=thumb", headers=_auth(token))

    assert thumb.status_code == 200 and thumb.content == full.content


def test_only_known_sizes_are_accepted(logged_in_client) -> None:
    client, token = logged_in_client
    file_id = _upload_avatar(client, token, jpeg_bytes((400, 300))).json()["avatar_file_id"]

    assert client.get(f"/api/files/{file_id}?size=../../x", headers=_auth(token)).status_code == 422


def test_a_thumbnail_is_as_private_as_its_picture(logged_in_client, login_as) -> None:
    client, token = logged_in_client
    _create_coach_profile(client, token)
    exercise = client.post("/api/exercises", headers=_auth(token), json={
        "sport": "Баскетбол", "name": "Тест", "description": None, "goal": None, "sets": None, "reps": None, "duration_seconds": None,
        "rest_seconds": None, "equipment": None, "difficulty": None, "technique": None, "common_mistakes": None, "warnings": None,
        "coach_comment": None}).json()
    uploaded = client.post(f"/api/exercises/{exercise['id']}/photo", headers=_auth(token), files={"file": ("e.jpg", io.BytesIO(jpeg_bytes((2000, 1500))), "image/jpeg")})
    file_id = uploaded.json()["photo_file_id"]
    stranger = login_as(990011, first_name="Stranger")

    assert client.get(f"/api/files/{file_id}?size=thumb", headers=_auth(token)).status_code == 200
    assert client.get(f"/api/files/{file_id}?size=thumb", headers=_auth(stranger)).status_code == 403
    assert client.get(f"/api/files/{file_id}?size=thumb").status_code == 401


# --- refusals --------------------------------------------------------------------------------------------------------


def test_a_text_file_pretending_to_be_a_jpeg_is_refused_and_nothing_is_stored(logged_in_client) -> None:
    client, token = logged_in_client

    response = _upload_avatar(client, token, b"just some text, not a picture", name="evil.jpg")

    assert response.status_code == 415
    assert response.json()["error"]["code"] == "invalid_image"
    assert "изображением" in response.json()["error"]["message"]  # in Russian, for the person who sees it
    assert _stored_paths() == []


def test_a_damaged_photo_is_refused_with_a_clear_message(logged_in_client) -> None:
    client, token = logged_in_client
    whole = jpeg_bytes((1200, 900))

    response = _upload_avatar(client, token, whole[: len(whole) // 3])

    assert response.status_code == 415 and response.json()["error"]["code"] == "invalid_image"
    assert _stored_paths() == []


def test_an_animated_gif_is_refused_instead_of_silently_losing_frames(logged_in_client) -> None:
    client, token = logged_in_client
    frames = [photo((80, 80), seed=n).convert("P") for n in range(3)]
    buffer = io.BytesIO()
    frames[0].save(buffer, "GIF", save_all=True, append_images=frames[1:], duration=80, loop=0)

    response = _upload_avatar(client, token, buffer.getvalue(), name="dance.gif", content_type="image/gif")

    assert response.status_code == 415
    assert response.json()["error"]["code"] == "animated_image" and "Анимированные" in response.json()["error"]["message"]
    assert _stored_paths() == []


def test_a_picture_with_too_many_pixels_is_refused(logged_in_client, monkeypatch: pytest.MonkeyPatch) -> None:
    client, token = logged_in_client
    _settings_override(monkeypatch, IMAGE_MAX_PIXELS="100000")

    response = _upload_avatar(client, token, jpeg_bytes((800, 600)))

    assert response.status_code == 413 and response.json()["error"]["code"] == "image_too_large_dimensions"
    assert _stored_paths() == []


def test_a_file_over_the_size_limit_is_refused_in_russian(logged_in_client, monkeypatch: pytest.MonkeyPatch) -> None:
    client, token = logged_in_client
    _settings_override(monkeypatch, MAX_IMAGE_SIZE_MB="1")

    response = _upload_avatar(client, token, b"\x00" * (1024 * 1024 + 10))

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "file_too_large" and "1 МБ" in response.json()["error"]["message"]
    assert _stored_paths() == []


def test_uploading_without_signing_in_is_refused(logged_in_client) -> None:
    client, _ = logged_in_client

    response = client.post("/api/users/me/avatar", files={"file": ("a.jpg", io.BytesIO(jpeg_bytes((200, 100))), "image/jpeg")})

    assert response.status_code == 401
    assert _stored_paths() == []


def test_nobody_can_replace_someone_elses_team_logo_or_listing_photo(logged_in_client, login_as) -> None:
    client, owner = logged_in_client
    _create_coach_profile(client, owner)
    team = _create_team(client, owner)
    intruder = login_as(990012, first_name="Intruder")

    logo = client.post(f"/api/teams/{team['id']}/logo", headers=_auth(intruder), files={"file": ("l.png", io.BytesIO(png_bytes()), "image/png")})

    assert logo.status_code == 403
    assert _stored_paths() == []  # refused before any work was done or anything uploaded


# --- storage failures ------------------------------------------------------------------------------------------------


def test_a_yandex_disk_failure_gives_a_clear_error_and_no_record(logged_in_client, monkeypatch: pytest.MonkeyPatch) -> None:
    client, token = logged_in_client

    async def broken_upload(self, path, content):
        raise YandexDiskError(507, "Insufficient Storage")

    monkeypatch.setattr(_FakeYandexDiskClient, "upload", broken_upload)

    response = _upload_avatar(client, token, jpeg_bytes((400, 300)))

    assert response.status_code == 502 and response.json()["error"]["code"] == "storage_error"
    assert "Insufficient" not in response.text  # the provider's wording never reaches the user
    me = client.get("/api/auth/me", headers=_auth(token)).json()
    assert me["avatar_file_id"] is None


def test_a_failed_thumbnail_upload_does_not_fail_the_photo(logged_in_client, monkeypatch: pytest.MonkeyPatch) -> None:
    client, token = logged_in_client
    real_upload = _FakeYandexDiskClient.upload

    async def upload(self, path, content):
        if path.endswith("_thumb.webp"):
            raise YandexDiskError(500, "boom")
        await real_upload(self, path, content)

    monkeypatch.setattr(_FakeYandexDiskClient, "upload", upload)

    response = _upload_gallery_photo(client, token, jpeg_bytes((2400, 1600)))

    assert response.status_code == 200, response.text
    file_id = response.json()["file_id"]
    full = client.get(f"/api/files/{file_id}", headers=_auth(token))
    assert client.get(f"/api/files/{file_id}?size=thumb", headers=_auth(token)).content == full.content  # falls back to the picture


def test_a_database_failure_after_the_upload_removes_the_orphaned_bytes(logged_in_client, monkeypatch: pytest.MonkeyPatch) -> None:
    client, token = logged_in_client
    from app.api.routes import files as files_routes

    async def broken_create_file(conn, **fields):
        raise RuntimeError("database is down")

    monkeypatch.setattr(files_routes.files_repo, "create_file", broken_create_file)

    with pytest.raises(RuntimeError, match="database is down"):
        _upload_avatar(client, token, jpeg_bytes((400, 300)))

    assert _stored_paths() == []


# --- everything uploaded before this existed keeps working ------------------------------------------------------------


def test_a_png_uploaded_the_old_way_is_still_served_untouched(logged_in_client) -> None:
    """A row as the previous version wrote it: original bytes, original PNG type, no thumbnail column value."""
    import asyncio

    from app.api.routes import files as files_routes

    client, token = logged_in_client
    me = client.get("/api/auth/me", headers=_auth(token)).json()
    legacy = png_bytes(77, size=(64, 64))
    path = "/TeamFlow/main/users/legacy/avatar/old.png"
    _shared_disk_storage[path] = legacy

    async def create():
        return await files_routes.files_repo.create_file(
            None, owner_id=me["id"], team_id=None, entity_type="user_avatar", entity_id=me["id"], disk_path=path,
            filename="Старое фото.png", mime_type="image/png", size_bytes=len(legacy), access_level="PUBLIC")

    record = asyncio.run(create())

    download = client.get(f"/api/files/{record['id']}", headers=_auth(token))
    thumb = client.get(f"/api/files/{record['id']}?size=thumb", headers=_auth(token))

    assert download.status_code == 200 and download.content == legacy
    assert download.headers["content-type"] == "image/png"
    assert thumb.status_code == 200 and thumb.content == legacy


def test_the_optimisation_is_logged_with_sizes_and_savings_but_no_private_details(logged_in_client, caplog: pytest.LogCaptureFixture) -> None:
    client, token = logged_in_client
    caplog.set_level("INFO", logger="teamflow.images")

    _upload_avatar(client, token, jpeg_bytes((3000, 2250), quality=93), name="secret-holiday-photo.jpg")

    (line,) = [r.getMessage() for r in caplog.records if r.name == "teamflow.images"]
    assert line.startswith("Image optimized: type=avatar original=")
    assert " optimized=" in line and " saved=" in line and "%" in line and " duration=" in line and "ms" in line
    assert "secret-holiday-photo" not in line and "/TeamFlow" not in line and "users/" not in line


def test_a_file_the_disk_cannot_serve_is_an_error_not_an_empty_picture(logged_in_client, monkeypatch: pytest.MonkeyPatch) -> None:
    client, token = logged_in_client
    file_id = _upload_avatar(client, token, jpeg_bytes((800, 600))).json()["avatar_file_id"]

    async def missing(self, path):
        raise YandexDiskError(404, '{"error": "DiskNotFoundError"}')
        yield b""  # pragma: no cover - makes this an async generator

    monkeypatch.setattr(_FakeYandexDiskClient, "stream_download", missing)

    response = client.get(f"/api/files/{file_id}", headers=_auth(token))

    assert response.status_code == 502 and response.json()["error"]["code"] == "storage_error"


def test_a_file_the_disk_cannot_serve_is_an_error_not_an_empty_picture(logged_in_client, monkeypatch: pytest.MonkeyPatch) -> None:
    client, token = logged_in_client
    file_id = _upload_avatar(client, token, jpeg_bytes((800, 600))).json()["avatar_file_id"]

    async def missing(self, path):
        raise YandexDiskError(404, '{"error": "DiskNotFoundError"}')
        yield b""  # makes this an async generator

    monkeypatch.setattr(_FakeYandexDiskClient, "stream_download", missing)

    response = client.get(f"/api/files/{file_id}", headers=_auth(token))

    assert response.status_code == 502 and response.json()["error"]["code"] == "storage_error"
