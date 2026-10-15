"""Real (tiny or large) images for the upload tests - the backend now verifies uploads by content,
so a PNG signature followed by padding is no longer an image."""
from __future__ import annotations

import io
import random

from PIL import Image


def photo(size: tuple[int, int] = (800, 600), seed: int = 1, alpha: bool = False) -> Image.Image:
    """A smooth, detailed, noisy picture - compresses like a camera photo, not like a flat colour."""
    rng = random.Random(seed)
    small = Image.new("RGB", (max(2, size[0] // 24), max(2, size[1] // 24)))
    small.putdata([(rng.randrange(256), rng.randrange(256), rng.randrange(256)) for _ in range(small.width * small.height)])
    base = small.resize(size, Image.Resampling.BICUBIC)
    noise = Image.effect_noise(size, 18).convert("RGB")
    image = Image.blend(base, noise, 0.15)
    if alpha:
        mask = Image.new("L", size, 255)
        mask.paste(0, (0, 0, size[0] // 2, size[1] // 2))
        image.putalpha(mask)
    return image


def encode(image: Image.Image, fmt: str, **options) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, fmt, **options)
    return buffer.getvalue()


def png_bytes(seed: int = 20, size: tuple[int, int] = (16, 16)) -> bytes:
    """A tiny valid PNG; different seeds give different bytes."""
    return encode(Image.new("RGB", size, (seed % 256, (seed * 7) % 256, (seed * 13) % 256)), "PNG")


def jpeg_bytes(size: tuple[int, int] = (800, 600), seed: int = 1, quality: int = 95, exif: Image.Exif | None = None) -> bytes:
    options = {"quality": quality}
    if exif is not None:
        options["exif"] = exif
    return encode(photo(size, seed), "JPEG", **options)


def exif_with(orientation: int | None = None, gps: bool = False) -> Image.Exif:
    exif = Image.Exif()
    if orientation is not None:
        exif[0x0112] = orientation
    exif[0x010F] = "TestCamera"  # Make
    if gps:
        exif.get_ifd(0x8825)[1] = "N"  # GPSLatitudeRef
        exif.get_ifd(0x8825)[2] = (55.0, 45.0, 21.0)
    return exif
