"""Image optimisation, done in memory BEFORE anything is sent to Yandex.Disk.

Photos arrive in whatever shape a phone produced (often 4-12 MB, 4000+ px, with GPS in
the EXIF). Here they are verified by their actual content, rotated upright, scaled down to
what a screen can use and re-encoded as WebP; the original is never stored. The goal is
fast pages and a noticeably smaller disk footprint, not the smallest possible file, so the
quality settings are deliberately moderate and a file that is already lean is left alone.

This module is pure CPU work on bytes (no network, no database) - the caller runs it in a
worker thread and `optimize_image` keeps the number of simultaneous jobs small so a few
large uploads cannot exhaust a small VPS.
"""
from __future__ import annotations

import io
import threading
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError


class ImageError(Exception):
    """The upload cannot be turned into a stored image; `message` is safe to show the user."""

    code = "invalid_image"
    status_code = 415
    message = "Не удалось обработать изображение."


class InvalidImage(ImageError):
    message = "Файл не является изображением или повреждён. Загрузите JPEG, PNG, WebP или GIF."


class AnimatedImage(ImageError):
    code = "animated_image"
    message = "Анимированные изображения не поддерживаются. Загрузите обычное фото (JPEG, PNG или WebP)."


class ImageTooManyPixels(ImageError):
    code = "image_too_large_dimensions"
    status_code = 413
    message = "Разрешение изображения слишком большое. Уменьшите фото и загрузите снова."


@dataclass(frozen=True)
class ImageProfile:
    """What a category of image is allowed to be.

    The box is orientation-aware: `max_long` x `max_short` applies to a landscape picture and
    the same numbers swapped to a portrait one, so a tall photo is not squeezed into a wide box.
    Nothing is ever enlarged or cropped."""

    name: str
    max_long: int
    max_short: int
    quality: int
    # Logos/emblems: fine lines and text must stay crisp, so lossless WebP and PNG compete
    # and the smaller wins (unless the source was a lossy JPEG - then lossy is no worse).
    logo: bool = False
    # Long side of the extra small version used in lists/cards; None = no thumbnail.
    thumbnail: int | None = None


PROFILES: dict[str, ImageProfile] = {
    "avatar": ImageProfile("avatar", 512, 512, 85),
    "team_logo": ImageProfile("team_logo", 1024, 1024, 90, logo=True),
    "listing_photo": ImageProfile("listing_photo", 1600, 1200, 82, thumbnail=480),
    "gallery_photo": ImageProfile("gallery_photo", 1920, 1920, 85, thumbnail=480),
    "exercise_photo": ImageProfile("exercise_photo", 1600, 1600, 82, thumbnail=480),
    "report_photo": ImageProfile("report_photo", 1600, 1600, 82),
}

THUMBNAIL_QUALITY = 75
# Re-encoding an already lean file only adds generation loss: below this saving it is kept as is.
KEEP_ORIGINAL_UNLESS_SMALLER_THAN = 0.85
# Without JPEG's cheap reduced-size decoding, every pixel costs 4 bytes (+ copies) of memory.
LOSSLESS_FORMAT_PIXEL_CAP = 30_000_000

# A JPEG with extra frames (some Android/Fuji cameras, "MPO") is opened by the JPEG plugin and reports format "MPO".
_ACCEPTED_FORMATS = ("JPEG", "PNG", "WEBP", "GIF")
_JPEG_FORMATS = ("JPEG", "MPO")
_ORIGINAL_TYPES = {
    "JPEG": ("jpg", "image/jpeg"),
    "MPO": ("jpg", "image/jpeg"),
    "PNG": ("png", "image/png"),
    "WEBP": ("webp", "image/webp"),
    "GIF": ("gif", "image/gif"),
}
_EXIF_ORIENTATION = 0x0112
_METADATA_KEYS = ("xmp", "XML:com.adobe.xmp", "photoshop", "exif")


@dataclass(frozen=True)
class OptimizedImage:
    data: bytes
    extension: str
    mime_type: str
    width: int
    height: int
    thumbnail: bytes | None
    original_size: int
    kept_original: bool

    @property
    def size(self) -> int:
        return len(self.data)


_gates: dict[int, threading.BoundedSemaphore] = {}
_gates_lock = threading.Lock()


def _gate(concurrency: int) -> threading.BoundedSemaphore:
    with _gates_lock:
        return _gates.setdefault(concurrency, threading.BoundedSemaphore(concurrency))


def fit_size(width: int, height: int, profile: ImageProfile) -> tuple[int, int]:
    """The size to scale (width x height) to so it fits the profile's box; never larger than the source."""
    box_w, box_h = (profile.max_long, profile.max_short) if width >= height else (profile.max_short, profile.max_long)
    scale = min(box_w / width, box_h / height, 1.0)
    if scale >= 1.0:
        return width, height
    return max(1, round(width * scale)), max(1, round(height * scale))


def optimize_image(data: bytes, profile: ImageProfile, *, max_pixels: int, concurrency: int = 2) -> OptimizedImage:
    """Blocking. Raises ImageError subclasses for anything that cannot be stored."""
    with _gate(concurrency):
        try:
            return _optimize(data, profile, max_pixels)
        except ImageError:
            raise
        except (MemoryError, Image.DecompressionBombError) as exc:
            raise ImageTooManyPixels() from exc
        except (OSError, ValueError, SyntaxError, EOFError) as exc:
            raise InvalidImage() from exc


def _optimize(data: bytes, profile: ImageProfile, max_pixels: int) -> OptimizedImage:
    try:
        image = Image.open(io.BytesIO(data), formats=_ACCEPTED_FORMATS)
    except Image.DecompressionBombError as exc:  # Pillow's own backstop, far above our limit
        raise ImageTooManyPixels() from exc
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as exc:
        raise InvalidImage() from exc

    with image:
        fmt = image.format or ""
        width, height = image.size
        if width < 1 or height < 1:
            raise InvalidImage()
        is_jpeg = fmt in _JPEG_FORMATS
        # Checked on the header, before a single pixel is decoded (decompression-bomb guard).
        if width * height > (max_pixels if is_jpeg else min(max_pixels, LOSSLESS_FORMAT_PIXEL_CAP)):
            raise ImageTooManyPixels()
        if not is_jpeg and (getattr(image, "is_animated", False) or getattr(image, "n_frames", 1) > 1):
            raise AnimatedImage()

        exif = image.getexif()
        orientation = exif.get(_EXIF_ORIENTATION, 1)
        has_metadata = bool(exif) or any(key in image.info for key in _METADATA_KEYS)
        icc_profile = image.info.get("icc_profile")

        oriented_w, oriented_h = (height, width) if orientation in (5, 6, 7, 8) else (width, height)
        target = fit_size(oriented_w, oriented_h, profile)
        needs_resize = target != (oriented_w, oriented_h)
        if is_jpeg and needs_resize:
            # Lets the JPEG decoder produce a 1/2, 1/4 or 1/8 size picture directly - far less memory/CPU
            # for a 12-48 MP photo that is going to be shrunk anyway. Never goes below the requested size.
            swapped = (oriented_w, oriented_h) != (width, height)
            image.draft("RGB", (target[1], target[0]) if swapped else target)
        image.load()  # truncated/corrupt data fails here, not later

        work = ImageOps.exif_transpose(image) if orientation != 1 else image
        work = _normalise_mode(work)
        if needs_resize:
            work = work.resize(target, Image.Resampling.LANCZOS, reducing_gap=2.0)

        data_out, extension, mime = _encode_best(work, profile, icc_profile, source_is_lossy=is_jpeg)

        untouched = not needs_resize and orientation == 1 and not has_metadata
        kept_original = untouched and len(data_out) > KEEP_ORIGINAL_UNLESS_SMALLER_THAN * len(data)
        if kept_original:
            extension, mime = _ORIGINAL_TYPES[fmt]
            data_out = data

        return OptimizedImage(
            data=data_out,
            extension=extension,
            mime_type=mime,
            width=work.width,
            height=work.height,
            thumbnail=_make_thumbnail(work, profile),
            original_size=len(data),
            kept_original=kept_original,
        )


def _normalise_mode(image: Image.Image) -> Image.Image:
    """RGB, or RGBA only when the picture really has see-through pixels."""
    has_alpha = image.mode in ("RGBA", "LA", "PA") or "transparency" in image.info
    if not has_alpha:
        return image.convert("RGB") if image.mode != "RGB" else image
    rgba = image.convert("RGBA")
    if rgba.getchannel("A").getextrema() == (255, 255):  # alpha channel present but fully opaque
        return rgba.convert("RGB")
    return rgba


def _encode_best(
    image: Image.Image, profile: ImageProfile, icc_profile: bytes | None, *, source_is_lossy: bool
) -> tuple[bytes, str, str]:
    extra = {"icc_profile": icc_profile} if icc_profile else {}
    if profile.logo and not source_is_lossy:
        candidates = {
            ("webp", "image/webp"): _save(image, "WEBP", lossless=True, quality=90, method=4, **extra),
            ("png", "image/png"): _save(image, "PNG", optimize=True, **extra),
        }
    else:
        quality = 90 if profile.logo else profile.quality
        candidates = {("webp", "image/webp"): _save(image, "WEBP", quality=quality, method=4, **extra)}
    (extension, mime), best = min(candidates.items(), key=lambda item: len(item[1]))
    return best, extension, mime


def _make_thumbnail(image: Image.Image, profile: ImageProfile) -> bytes | None:
    # A picture that is already about thumbnail-sized needs no second copy.
    if profile.thumbnail is None or max(image.size) <= profile.thumbnail * 1.3:
        return None
    small = image.copy()
    small.thumbnail((profile.thumbnail, profile.thumbnail), Image.Resampling.LANCZOS)
    return _save(small, "WEBP", quality=THUMBNAIL_QUALITY, method=4)


def _save(image: Image.Image, fmt: str, **options) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, fmt, **options)
    return buffer.getvalue()
