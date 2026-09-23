from __future__ import annotations

import io


def _png_bytes(size: int = 20) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"0" * size


def _mp4_bytes(size: int = 20) -> bytes:
    return b"\x00\x00\x00\x18ftypmp42" + b"0" * size


def test_upload_photo_rejects_non_image(logged_in_client) -> None:
    client, token = logged_in_client
    resp = client.post(
        "/api/profile/media/photo",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("a.txt", io.BytesIO(b"nope"), "text/plain")},
    )
    assert resp.status_code == 415


def test_upload_video_rejects_non_video(logged_in_client) -> None:
    client, token = logged_in_client
    resp = client.post(
        "/api/profile/media/video",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("a.png", io.BytesIO(_png_bytes()), "image/png")},
    )
    assert resp.status_code == 415


def test_upload_photo_and_video_then_list_in_order(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    me = client.get("/api/auth/me", headers=headers).json()

    photo = client.post(
        "/api/profile/media/photo",
        headers=headers,
        data={"caption": "Финал турнира"},
        files={"file": ("p.png", io.BytesIO(_png_bytes()), "image/png")},
    )
    assert photo.status_code == 200, photo.text
    assert photo.json()["media_type"] == "photo"
    assert photo.json()["caption"] == "Финал турнира"

    video = client.post(
        "/api/profile/media/video",
        headers=headers,
        files={"file": ("v.mp4", io.BytesIO(_mp4_bytes()), "video/mp4")},
    )
    assert video.status_code == 200, video.text
    assert video.json()["media_type"] == "video"

    listed = client.get(f"/api/profile/media/{me['id']}", headers=headers)
    assert listed.status_code == 200
    items = listed.json()
    assert [i["media_type"] for i in items] == ["photo", "video"]
    assert [i["id"] for i in items] == [photo.json()["id"], video.json()["id"]]


def test_media_is_publicly_viewable_and_downloadable(logged_in_client, login_as) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    me = client.get("/api/auth/me", headers=headers).json()

    photo = client.post(
        "/api/profile/media/photo",
        headers=headers,
        files={"file": ("p.png", io.BytesIO(_png_bytes()), "image/png")},
    ).json()

    other_token = login_as(700060, first_name="Other")
    other_headers = {"Authorization": f"Bearer {other_token}"}

    listed = client.get(f"/api/profile/media/{me['id']}", headers=other_headers)
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    downloaded = client.get(f"/api/files/{photo['file_id']}", headers=other_headers)
    assert downloaded.status_code == 200


def test_delete_media_removes_it_and_revokes_file_access(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    me = client.get("/api/auth/me", headers=headers).json()

    photo = client.post(
        "/api/profile/media/photo",
        headers=headers,
        files={"file": ("p.png", io.BytesIO(_png_bytes()), "image/png")},
    ).json()

    delete_resp = client.delete(f"/api/profile/media/{photo['id']}", headers=headers)
    assert delete_resp.status_code == 204

    listed = client.get(f"/api/profile/media/{me['id']}", headers=headers)
    assert listed.json() == []

    assert client.get(f"/api/files/{photo['file_id']}", headers=headers).status_code == 404


def test_cannot_delete_another_users_media(logged_in_client, login_as) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}

    photo = client.post(
        "/api/profile/media/photo",
        headers=headers,
        files={"file": ("p.png", io.BytesIO(_png_bytes()), "image/png")},
    ).json()

    other_token = login_as(700061, first_name="Other")
    resp = client.delete(f"/api/profile/media/{photo['id']}", headers={"Authorization": f"Bearer {other_token}"})
    assert resp.status_code == 404

    # Still there, unaffected by the failed attempt.
    still_there = client.get(f"/api/files/{photo['file_id']}", headers=headers)
    assert still_there.status_code == 200
