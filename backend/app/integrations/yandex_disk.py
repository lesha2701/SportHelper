"""Thin async client for the Yandex.Disk REST API.

Docs: https://yandex.ru/dev/disk/api/reference/

The OAuth token is only ever used here, server-side: it is loaded from
config, never logged, never returned to the frontend. Uploads/downloads are
streamed through httpx so large videos are not buffered fully in memory.
"""
from __future__ import annotations

from collections.abc import AsyncIterator

import httpx

from app.config import Settings

_API_BASE = "https://cloud-api.yandex.net/v1/disk"


class YandexDiskError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code


class YandexDiskClient:
    def __init__(self, settings: Settings):
        if not settings.yandex_disk_oauth_token:
            raise RuntimeError("YANDEX_DISK_OAUTH_TOKEN is not configured")
        self._token = settings.yandex_disk_oauth_token
        self._timeout = settings.http_client_timeout_seconds

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"OAuth {self._token}"}

    async def get_disk_info(self) -> dict:
        """Returns total/used/trash space in bytes, per the /v1/disk endpoint."""
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.get(_API_BASE, headers=self._headers())
        except httpx.HTTPError as exc:
            raise YandexDiskError(502, f"network error contacting Yandex.Disk: {exc}") from exc
        if response.status_code != 200:
            raise YandexDiskError(response.status_code, response.text)
        data = response.json()
        return {
            "total_space": data["total_space"],
            "used_space": data["used_space"],
            "trash_size": data.get("trash_size", 0),
        }

    async def ensure_folder(self, path: str) -> None:
        """Create a folder, creating any missing parent folders first.
        Idempotent: an already-existing folder is not an error."""
        parts = [p for p in path.strip("/").split("/") if p]
        current = ""
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                for part in parts:
                    current = f"{current}/{part}"
                    response = await client.put(
                        f"{_API_BASE}/resources",
                        headers=self._headers(),
                        params={"path": current},
                    )
                    if response.status_code not in (201, 409):
                        raise YandexDiskError(response.status_code, response.text)
        except httpx.HTTPError as exc:
            raise YandexDiskError(502, f"network error contacting Yandex.Disk: {exc}") from exc

    async def _get_upload_url(self, path: str) -> str:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.get(
                    f"{_API_BASE}/resources/upload",
                    headers=self._headers(),
                    params={"path": path, "overwrite": "true"},
                )
        except httpx.HTTPError as exc:
            raise YandexDiskError(502, f"network error contacting Yandex.Disk: {exc}") from exc
        if response.status_code != 200:
            raise YandexDiskError(response.status_code, response.text)
        return response.json()["href"]

    async def upload(self, path: str, content: AsyncIterator[bytes]) -> None:
        # Note: the upload href does not redirect in practice (unlike the
        # download href below), so we intentionally do not set
        # follow_redirects here — a redirected PUT would need to replay the
        # streamed body, which a one-shot async iterator cannot do safely.
        href = await self._get_upload_url(path)
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                response = await client.put(href, content=content)
        except httpx.HTTPError as exc:
            raise YandexDiskError(502, f"network error contacting Yandex.Disk: {exc}") from exc
        if response.status_code not in (201, 202):
            raise YandexDiskError(response.status_code, response.text)

    async def _get_download_url(self, path: str) -> str:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.get(
                    f"{_API_BASE}/resources/download",
                    headers=self._headers(),
                    params={"path": path},
                )
        except httpx.HTTPError as exc:
            raise YandexDiskError(502, f"network error contacting Yandex.Disk: {exc}") from exc
        if response.status_code != 200:
            raise YandexDiskError(response.status_code, response.text)
        return response.json()["href"]

    async def stream_download(self, path: str) -> AsyncIterator[bytes]:
        # Unlike the upload href, the download href redirects to a CDN edge
        # (302) — a GET has no body to replay, so following is safe here.
        href = await self._get_download_url(path)
        try:
            async with httpx.AsyncClient(timeout=None, follow_redirects=True) as client:
                async with client.stream("GET", href) as response:
                    if response.status_code != 200:
                        body = await response.aread()
                        raise YandexDiskError(response.status_code, body.decode(errors="replace"))
                    async for chunk in response.aiter_bytes():
                        yield chunk
        except httpx.HTTPError as exc:
            raise YandexDiskError(502, f"network error contacting Yandex.Disk: {exc}") from exc

    async def delete(self, path: str) -> None:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.delete(
                    f"{_API_BASE}/resources",
                    headers=self._headers(),
                    params={"path": path, "permanently": "true"},
                )
        except httpx.HTTPError as exc:
            raise YandexDiskError(502, f"network error contacting Yandex.Disk: {exc}") from exc
        if response.status_code not in (202, 204, 404):
            raise YandexDiskError(response.status_code, response.text)
