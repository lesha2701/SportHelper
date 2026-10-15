"""Shared streaming-upload helper for Yandex.Disk-backed files (team logos,
exercise photos/videos, ...). Kept storage-agnostic about *what* is being
uploaded — callers own path building, mime validation and DB bookkeeping."""
from __future__ import annotations

import asyncio
import logging
import os
import re
import tempfile
import time
import unicodedata
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass

from fastapi import UploadFile

from app.config import Settings
from app.core.exceptions import APIError
from app.integrations.yandex_disk import YandexDiskClient, YandexDiskError
from app.services import images
from app.services.images import PROFILES, ImageError

logger = logging.getLogger("teamflow.images")

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
    reader = SizeLimitedReader(upload, max_bytes, chunk_size)
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


# --- images: verified, optimised and only then stored ------------------------------------------------


@dataclass(frozen=True)
class StoredImage:
    disk_path: str
    thumb_disk_path: str | None
    mime_type: str
    extension: str
    size_bytes: int
    width: int
    height: int


def _human_size(size: int) -> str:
    return f"{size / (1024 * 1024):.1f}MB" if size >= 1024 * 1024 else f"{size / 1024:.0f}KB"


def safe_filename(original: str | None, extension: str, fallback: str = "image") -> str:
    """A display name derived from what the user called the file - never a path, never control
    characters, never longer than 100 characters, always ending in the stored format's extension."""
    name = unicodedata.normalize("NFKC", (original or "").replace("\\", "/").rsplit("/", 1)[-1])
    stem = name.rsplit(".", 1)[0] if "." in name else name
    stem = re.sub(r"[\x00-\x1f\x7f\"<>|:*?]+", " ", stem)
    stem = re.sub(r"\s+", " ", stem).strip(" .")[:80].strip(" .")
    return f"{stem or fallback}.{extension}"


async def _chunks(data: bytes, chunk_size: int) -> AsyncIterator[bytes]:
    for start in range(0, len(data), chunk_size):
        yield data[start : start + chunk_size]


async def store_image(
    settings: Settings, upload: UploadFile, profile_name: str, build_path: Callable[[str], str]
) -> StoredImage:
    """Reads the upload (bounded by MAX_IMAGE_SIZE_MB), verifies it is really an image, optimises it for
    `profile_name` and sends ONLY the optimised result (and a thumbnail where the profile has one) to
    Yandex.Disk. `build_path(extension)` returns the target path for the format that was chosen.

    Raises RuntimeError (Yandex.Disk not configured), FileTooLarge, images.ImageError subclasses or
    YandexDiskError - `store_image_or_raise` turns them into API errors."""
    profile = PROFILES[profile_name]
    client = YandexDiskClient(settings)  # fails fast when the disk is not configured, before any work
    max_bytes = settings.max_image_size_mb * 1024 * 1024
    chunk_size = settings.upload_chunk_size_kb * 1024

    raw = bytearray()
    async for chunk in SizeLimitedReader(upload, max_bytes, chunk_size):
        raw += chunk
    data = bytes(raw)
    del raw

    started = time.perf_counter()
    result = await asyncio.to_thread(
        images.optimize_image,
        data,
        profile,
        max_pixels=settings.image_max_pixels,
        concurrency=settings.image_optimize_concurrency,
    )
    elapsed_ms = (time.perf_counter() - started) * 1000
    logger.info(
        "Image optimized: type=%s original=%s optimized=%s saved=%.1f%% duration=%dms size=%dx%d%s%s",
        profile_name,
        _human_size(result.original_size),
        _human_size(result.size),
        (1 - result.size / result.original_size) * 100,
        elapsed_ms,
        result.width,
        result.height,
        " kept_original=true" if result.kept_original else "",
        f" thumbnail={_human_size(len(result.thumbnail))}" if result.thumbnail else "",
    )

    disk_path = build_path(result.extension)
    await client.upload(disk_path, _chunks(result.data, chunk_size))

    thumb_disk_path = None
    if result.thumbnail:
        candidate = f"{disk_path.rsplit('.', 1)[0]}_thumb.webp"
        try:
            await client.upload(candidate, _chunks(result.thumbnail, chunk_size))
            thumb_disk_path = candidate
        except YandexDiskError as exc:  # the picture itself is stored; lists just fall back to it
            logger.warning("Thumbnail upload failed (status %s); continuing without it", exc.status_code)

    return StoredImage(
        disk_path=disk_path,
        thumb_disk_path=thumb_disk_path,
        mime_type=result.mime_type,
        extension=result.extension,
        size_bytes=result.size,
        width=result.width,
        height=result.height,
    )


async def store_image_or_raise(
    settings: Settings, upload: UploadFile, profile_name: str, build_path: Callable[[str], str]
) -> StoredImage:
    """`store_image` with every failure mapped to the API error the user should see."""
    try:
        return await store_image(settings, upload, profile_name, build_path)
    except RuntimeError as exc:
        raise APIError(str(exc), code="yandex_disk_not_configured", status_code=503) from exc
    except FileTooLarge as exc:
        raise APIError(
            f"Файл слишком большой: максимум {settings.max_image_size_mb} МБ.", code="file_too_large", status_code=413
        ) from exc
    except ImageError as exc:
        raise APIError(exc.message, code=exc.code, status_code=exc.status_code) from exc
    except YandexDiskError as exc:
        logger.error("Yandex.Disk upload failed (status %s)", exc.status_code)
        raise APIError("Не удалось сохранить файл. Попробуйте ещё раз позже.", code="storage_error", status_code=502) from exc


async def discard_stored_image(settings: Settings, stored: StoredImage) -> None:
    """Best-effort removal of freshly uploaded bytes when the database write that should have
    pointed at them failed - so a half-finished upload does not leave orphans on the disk."""
    try:
        client = YandexDiskClient(settings)
        for path in (stored.disk_path, stored.thumb_disk_path):
            if path:
                await client.delete(path)
    except (RuntimeError, YandexDiskError):
        logger.warning("Could not remove an orphaned upload from Yandex.Disk")
