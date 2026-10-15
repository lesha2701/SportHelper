"""YandexDiskClient against a scripted fake of the REST API (no network)."""
from __future__ import annotations

import httpx
import pytest

from app.config import Settings
from app.integrations import yandex_disk
from app.integrations.yandex_disk import YandexDiskClient, YandexDiskError


class FakeDisk:
    """Just enough of cloud-api.yandex.net: folders must exist before an upload URL is handed out."""

    def __init__(self, folders: set[str] | None = None):
        self.folders = folders or set()
        self.requests: list[tuple[str, str]] = []
        self.files: dict[str, bytes] = {}

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.params.get("path", "")
        self.requests.append((request.method, request.url.path))
        if request.url.host == "cloud-api.yandex.net":
            if request.method == "PUT" and request.url.path.endswith("/resources"):
                if path in self.folders:
                    return httpx.Response(409, json={"error": "DiskPathPointsToExistentDirectoryError"})
                self.folders.add(path)
                return httpx.Response(201, json={})
            if request.method == "GET" and request.url.path.endswith("/resources/upload"):
                if path.rsplit("/", 1)[0] not in self.folders:
                    return httpx.Response(409, json={"error": "DiskPathDoesntExistsError"})
                return httpx.Response(200, json={"href": f"https://uploader.example/put?path={path}"})
        if request.method == "PUT" and request.url.host == "uploader.example":
            self.files[path] = request.read()
            return httpx.Response(201)
        return httpx.Response(500, text=f"unexpected {request.method} {request.url}")


async def _chunks(data: bytes):
    yield data


def _client(monkeypatch: pytest.MonkeyPatch, handler) -> YandexDiskClient:
    real = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real(*args, **kwargs)

    monkeypatch.setattr(yandex_disk.httpx, "AsyncClient", factory)
    return YandexDiskClient(Settings(_env_file=None, YANDEX_DISK_OAUTH_TOKEN="t"))


async def test_an_upload_into_an_existing_folder_needs_no_folder_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeDisk(folders={"/TeamFlow/main/users/u1/avatar"})
    client = _client(monkeypatch, fake.handler)

    await client.upload("/TeamFlow/main/users/u1/avatar/a.webp", _chunks(b"data"))

    assert fake.files == {"/TeamFlow/main/users/u1/avatar/a.webp": b"data"}
    assert [method for method, _ in fake.requests] == ["GET", "PUT"]  # an upload link, then the bytes


async def test_missing_folders_are_created_when_the_disk_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeDisk()
    client = _client(monkeypatch, fake.handler)

    await client.upload("/TeamFlow/main/users/u1/avatar/a.webp", _chunks(b"data"))

    assert fake.files["/TeamFlow/main/users/u1/avatar/a.webp"] == b"data"
    assert {"/TeamFlow", "/TeamFlow/main", "/TeamFlow/main/users", "/TeamFlow/main/users/u1", "/TeamFlow/main/users/u1/avatar"} <= fake.folders


async def test_other_errors_are_not_mistaken_for_missing_folders(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(monkeypatch, lambda request: httpx.Response(507, text="Insufficient Storage"))

    with pytest.raises(YandexDiskError) as caught:
        await client.upload("/x/a.webp", _chunks(b"data"))

    assert caught.value.status_code == 507
