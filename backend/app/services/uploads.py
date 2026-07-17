"""Shared streaming-upload helper for Yandex.Disk-backed files (team logos,
exercise photos/videos, ...). Kept storage-agnostic about *what* is being
uploaded — callers own path building, mime validation and DB bookkeeping."""
from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import UploadFile

from app.config import Settings
from app.integrations.yandex_disk import YandexDiskClient

IMAGE_MIME_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}

VIDEO_MIME_EXTENSIONS = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
}


class FileTooLarge(Exception):
    pass


class SizeLimitedReader:
    """Streams an UploadFile in chunks, tracking total size and aborting if
    it exceeds max_bytes, so large files are never fully buffered in memory."""

    def __init__(self, upload: UploadFile, max_bytes: int, chunk_size: int):
        self._upload = upload
        self._max_bytes = max_bytes
        self._chunk_size = chunk_size
        self.total_size = 0

    async def __aiter__(self) -> AsyncIterator[bytes]:
        while True:
            chunk = await self._upload.read(self._chunk_size)
            if not chunk:
                break
            self.total_size += len(chunk)
            if self.total_size > self._max_bytes:
                raise FileTooLarge()
            yield chunk


async def upload_to_disk(
    settings: Settings, disk_path: str, upload: UploadFile, max_bytes: int, chunk_size: int
) -> int:
    """Streams `upload` to `disk_path` on Yandex.Disk, creating parent
    folders as needed. Returns the total bytes written.

    Raises RuntimeError if Yandex.Disk is not configured, FileTooLarge if
    the stream exceeds max_bytes, or YandexDiskError on API failure —
    callers translate those into route-appropriate APIErrors."""
    client = YandexDiskClient(settings)
    parent_dir = disk_path.rsplit("/", 1)[0]
    reader = SizeLimitedReader(upload, max_bytes, chunk_size)
    await client.ensure_folder(parent_dir)
    await client.upload(disk_path, reader)
    return reader.total_size
