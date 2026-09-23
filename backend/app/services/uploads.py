"""Shared streaming-upload helper for Yandex.Disk-backed files (team logos,
exercise photos/videos, ...). Kept storage-agnostic about *what* is being
uploaded — callers own path building, mime validation and DB bookkeeping."""
from __future__ import annotations

import asyncio
import os
import tempfile
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


class VideoTooLong(Exception):
    def __init__(self, duration_seconds: float):
        self.duration_seconds = duration_seconds
        super().__init__(f"video is {duration_seconds:.0f}s long")


class VideoProbeError(Exception):
    """ffprobe ran but could not make sense of the file (not a video ffprobe
    understands, corrupt upload, ...) — distinct from RuntimeError, which
    signals ffprobe itself is missing (a deployment problem, not a bad
    upload)."""


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


async def get_video_duration_seconds(path: str) -> float:
    """Probes a local video file's duration via ffprobe (installed in the
    backend image specifically for this — see the Dockerfile). Raises
    RuntimeError if ffprobe itself is missing or the file isn't a readable
    video ffprobe can make sense of."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("ffprobe is not installed") from exc
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0 or not stdout.strip():
        raise VideoProbeError(stderr.decode(errors="replace").strip() or "ffprobe could not read the video")
    return float(stdout.strip())


async def upload_video_to_disk(
    settings: Settings,
    disk_path: str,
    upload: UploadFile,
    max_bytes: int,
    chunk_size: int,
    max_duration_seconds: int,
) -> int:
    """Like upload_to_disk, but for video: buffers the stream to a local
    temp file first (bounded by max_bytes, so this stays small — video is
    capped well below image-sized memory concerns) so ffprobe can check its
    duration before anything is sent to Yandex.Disk. Raises FileTooLarge,
    VideoTooLong, or the same RuntimeError/YandexDiskError as upload_to_disk.
    Returns the total bytes written."""
    reader = SizeLimitedReader(upload, max_bytes, chunk_size)
    fd, tmp_path = tempfile.mkstemp(prefix="upload_video_")
    try:
        with os.fdopen(fd, "wb") as tmp_file:
            async for chunk in reader:
                tmp_file.write(chunk)

        duration = await get_video_duration_seconds(tmp_path)
        if duration > max_duration_seconds:
            raise VideoTooLong(duration)

        client = YandexDiskClient(settings)
        parent_dir = disk_path.rsplit("/", 1)[0]
        await client.ensure_folder(parent_dir)

        async def _read_tmp_file() -> AsyncIterator[bytes]:
            with open(tmp_path, "rb") as f:
                while True:
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    yield chunk

        await client.upload(disk_path, _read_tmp_file())
    finally:
        os.remove(tmp_path)
    return reader.total_size
