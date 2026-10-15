"""The optimiser on its own: what comes out of a photo, a logo, a rotated phone picture - and what is
refused (broken, animated, absurdly large). No HTTP, no disk."""
from __future__ import annotations

import io
import struct
import threading
import time
import zlib

import pytest
from PIL import Image, ImageDraw, JpegImagePlugin

from app.services import images
from app.services.images import PROFILES, AnimatedImage, ImageTooManyPixels, InvalidImage, fit_size, optimize_image
from tests.image_helpers import encode, exif_with, jpeg_bytes, photo

MAX_PIXELS = 64_000_000


def run(data: bytes, profile: str = "gallery_photo", **kwargs):
    return optimize_image(data, PROFILES[profile], max_pixels=kwargs.pop("max_pixels", MAX_PIXELS), **kwargs)


def decode(result) -> Image.Image:
    image = Image.open(io.BytesIO(result.data))
    image.load()
    return image


# --- formats in, WebP out ----------------------------------------------------------------------------------


def test_a_jpeg_photo_becomes_a_clearly_smaller_webp() -> None:
    original = jpeg_bytes((2400, 1800), quality=92)

    result = run(original)

    assert (result.extension, result.mime_type) == ("webp", "image/webp")
    assert decode(result).format == "WEBP"
    assert result.size < original.__len__() * 0.7
    assert result.kept_original is False


def test_a_png_photo_becomes_webp() -> None:
    original = encode(photo((1200, 800)), "PNG")

    result = run(original)

    assert result.extension == "webp" and result.size < len(original) * 0.5


def test_a_webp_upload_is_accepted() -> None:
    original = encode(photo((1000, 700)), "WEBP", quality=95)

    result = run(original)

    assert decode(result).format == "WEBP" and decode(result).size == (1000, 700)


def test_a_still_gif_is_accepted() -> None:
    gif = encode(photo((120, 90)).convert("P"), "GIF")

    result = run(gif)

    assert decode(result).size == (120, 90)


# --- orientation, privacy -----------------------------------------------------------------------------------


def test_exif_orientation_is_applied_and_the_pixels_end_up_upright() -> None:
    picture = Image.new("RGB", (400, 200), (0, 0, 255))
    ImageDraw.Draw(picture).rectangle((0, 0, 199, 199), fill=(255, 0, 0))  # red on the left half
    rotated_by_camera = encode(picture, "JPEG", quality=95, exif=exif_with(orientation=6))  # "rotate 90 clockwise to view"

    result = run(rotated_by_camera)

    out = decode(result).convert("RGB")
    assert out.size == (200, 400)  # displayed upright: portrait
    top, bottom = out.getpixel((100, 50)), out.getpixel((100, 350))
    assert top[0] > 200 and top[2] < 80  # the red half is now on top
    assert bottom[2] > 200 and bottom[0] < 80


def test_gps_and_camera_metadata_do_not_survive() -> None:
    original = jpeg_bytes((1600, 1200), exif=exif_with(orientation=1, gps=True))
    assert Image.open(io.BytesIO(original)).getexif().get_ifd(0x8825)  # the source really carries a location

    result = run(original)

    out = Image.open(io.BytesIO(result.data))
    assert not out.getexif() and "exif" not in out.info
    assert b"TestCamera" not in result.data and b"GPS" not in result.data


def test_an_untouched_small_jpeg_with_a_location_is_still_re_encoded_to_drop_it() -> None:
    original = jpeg_bytes((300, 200), quality=40, exif=exif_with(gps=True))

    result = run(original)

    assert result.kept_original is False and not Image.open(io.BytesIO(result.data)).getexif()


# --- size, proportions ----------------------------------------------------------------------------------------


def test_a_large_photo_is_scaled_down_with_the_same_proportions() -> None:
    result = run(jpeg_bytes((5000, 3000)), "gallery_photo")

    assert max(result.width, result.height) == 1920
    assert result.width / result.height == pytest.approx(5000 / 3000, abs=0.01)


def test_a_tall_photo_is_limited_by_its_height_not_squeezed_into_a_wide_box() -> None:
    result = run(jpeg_bytes((1500, 3000)), "listing_photo")

    # the 1600x1200 box is turned upright (1200 wide, 1600 tall): 3000 high -> 1600, 1500 wide -> 800
    assert (result.width, result.height) == (800, 1600)


def test_a_small_picture_is_not_enlarged() -> None:
    result = run(encode(photo((100, 80)), "PNG"), "avatar")

    assert (result.width, result.height) == (100, 80)


def test_an_avatar_is_fitted_into_512_without_cropping() -> None:
    result = run(jpeg_bytes((3000, 2000)), "avatar")

    assert (result.width, result.height) == (512, 341)


def test_fit_size_never_exceeds_the_box_and_keeps_the_aspect_ratio() -> None:
    for width, height in [(4032, 3024), (3024, 4032), (10000, 100), (100, 10000), (2000, 2000), (512, 512), (1, 1)]:
        for profile in PROFILES.values():
            w, h = fit_size(width, height, profile)
            assert 1 <= w <= width and 1 <= h <= height
            box = (profile.max_long, profile.max_short) if width >= height else (profile.max_short, profile.max_long)
            assert w <= box[0] and h <= box[1] or (w, h) == (width, height)
            if w > 8 and h > 8:
                assert w / h == pytest.approx(width / height, rel=0.03)


# --- transparency, logos ---------------------------------------------------------------------------------------


def _logo(size: int = 400) -> Image.Image:
    logo = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(logo)
    draw.ellipse((10, 10, size - 10, size - 10), fill=(20, 90, 200, 255))
    for x in range(20, size - 20, 7):  # fine hairlines and a sharp edge: lossy compression would smear them
        draw.line((x, 40, x, size - 40), fill=(255, 255, 255, 255), width=1)
    draw.text((size // 3, size // 2), "SAG", fill=(255, 220, 0, 255))
    return logo


def test_a_transparent_logo_keeps_its_transparency_and_is_not_given_a_background() -> None:
    result = run(encode(_logo(), "PNG"), "team_logo")

    out = decode(result)
    assert out.mode == "RGBA"
    assert out.getpixel((2, 2))[3] == 0  # the corner is still see-through, not black or white


def test_a_logo_keeps_every_pixel_exactly() -> None:
    logo = _logo()

    out = decode(run(encode(logo, "PNG"), "team_logo")).convert("RGBA")

    assert out.tobytes() == logo.tobytes()  # lossless: hairlines and text are untouched


def test_the_smaller_lossless_candidate_wins_for_a_logo() -> None:
    logo = encode(_logo(), "PNG")

    result = run(logo, "team_logo")

    assert result.extension in ("webp", "png") and result.size <= len(logo)


def test_a_photo_with_a_transparent_part_keeps_it_too() -> None:
    result = run(encode(photo((800, 600), alpha=True), "PNG"), "gallery_photo")

    out = decode(result)
    assert out.mode == "RGBA" and out.getpixel((5, 5))[3] == 0 and out.getpixel((790, 590))[3] == 255


def test_an_opaque_alpha_channel_is_dropped() -> None:
    rgba = photo((600, 400)).convert("RGBA")

    assert decode(run(encode(rgba, "PNG"))).mode == "RGB"


def test_a_big_jpeg_logo_is_not_inflated_by_lossless_encoding() -> None:
    jpeg = jpeg_bytes((1000, 1000), quality=85)

    result = run(jpeg, "team_logo")

    assert result.size <= len(jpeg) * 1.0


# --- not degrading what is already lean ---------------------------------------------------------------------


def test_an_already_lean_jpeg_is_kept_byte_for_byte() -> None:
    lean = jpeg_bytes((1200, 900), quality=55)

    result = run(lean)

    assert result.kept_original is True and result.data == lean
    assert (result.extension, result.mime_type) == ("jpg", "image/jpeg")


# --- thumbnails ------------------------------------------------------------------------------------------------


def test_profiles_with_a_thumbnail_make_a_small_webp_and_others_do_not() -> None:
    big = jpeg_bytes((2000, 1500))

    gallery = run(big, "gallery_photo")
    avatar = run(big, "avatar")
    tiny = run(jpeg_bytes((300, 200)), "gallery_photo")

    assert gallery.thumbnail is not None
    thumb = Image.open(io.BytesIO(gallery.thumbnail))
    assert thumb.format == "WEBP" and max(thumb.size) == 480 and len(gallery.thumbnail) < gallery.size / 3
    assert avatar.thumbnail is None
    assert tiny.thumbnail is None  # already thumbnail-sized: no second copy


# --- refusing what cannot be stored --------------------------------------------------------------------------


@pytest.mark.parametrize("junk", [b"", b"not an image at all", b"\x89PNG\r\n\x1a\n" + b"0" * 40, b"GIF89a" + b"\x00" * 10, b"%PDF-1.4 ..."])
def test_things_that_are_not_images_are_refused(junk: bytes) -> None:
    with pytest.raises(InvalidImage):
        run(junk)


def test_the_content_decides_not_the_name_so_an_html_file_in_disguise_is_refused() -> None:
    with pytest.raises(InvalidImage):
        run(b"<html><script>alert(1)</script></html>")


def test_other_image_formats_are_not_accepted() -> None:
    with pytest.raises(InvalidImage):
        run(encode(photo((50, 50)), "BMP"))


def test_a_truncated_jpeg_is_refused() -> None:
    whole = jpeg_bytes((1200, 900))

    with pytest.raises(InvalidImage):
        run(whole[: len(whole) // 2])


def test_a_png_with_damaged_data_is_refused() -> None:
    whole = encode(photo((300, 300)), "PNG")
    damaged = whole[:200] + bytes(b ^ 0xFF for b in whole[200:400]) + whole[400:]

    with pytest.raises(InvalidImage):
        run(damaged)


def test_an_animated_gif_is_refused_explicitly() -> None:
    frames = [photo((60, 60), seed=n).convert("P") for n in range(3)]
    buffer = io.BytesIO()
    frames[0].save(buffer, "GIF", save_all=True, append_images=frames[1:], duration=80, loop=0)

    with pytest.raises(AnimatedImage):
        run(buffer.getvalue())


def test_an_animated_webp_is_refused_explicitly() -> None:
    frames = [photo((60, 60), seed=n) for n in range(3)]
    buffer = io.BytesIO()
    frames[0].save(buffer, "WEBP", save_all=True, append_images=frames[1:], duration=80, loop=0)

    with pytest.raises(AnimatedImage):
        run(buffer.getvalue())


def test_a_picture_with_too_many_pixels_is_refused_before_it_is_decoded() -> None:
    with pytest.raises(ImageTooManyPixels):
        run(jpeg_bytes((400, 300)), max_pixels=100_000)


def test_a_decompression_bomb_header_is_refused_without_decoding_it() -> None:
    """A valid 1x1 PNG whose header claims 60000 x 60000 (3.6 billion pixels)."""
    tiny = encode(Image.new("RGB", (1, 1)), "PNG")
    start = tiny.index(b"IHDR")
    header = b"IHDR" + struct.pack(">II", 60000, 60000) + tiny[start + 12 : start + 17]
    forged = tiny[: start - 4] + struct.pack(">I", 13) + header + struct.pack(">I", zlib.crc32(header)) + tiny[start + 21 :]

    started = time.perf_counter()
    with pytest.raises(ImageTooManyPixels):
        run(forged)
    assert time.perf_counter() - started < 1.0  # nothing was allocated or decoded


def test_non_jpeg_formats_have_a_lower_pixel_cap_than_jpeg() -> None:
    # 6000 x 6000 = 36 MP: fine as a JPEG (decoded at reduced size), too heavy as a PNG (4 bytes/pixel in memory).
    header_only_png = encode(Image.new("1", (6000, 6000)), "PNG")

    with pytest.raises(ImageTooManyPixels):
        run(header_only_png)


# --- resources -----------------------------------------------------------------------------------------------


def test_a_big_jpeg_is_decoded_at_reduced_size_not_in_full(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[tuple[tuple[int, int], tuple[int, int]]] = []
    original_draft = JpegImagePlugin.JpegImageFile.draft

    def spy(self, mode, size):
        before = self.size
        result = original_draft(self, mode, size)
        seen.append((before, self.size))
        return result

    monkeypatch.setattr(JpegImagePlugin.JpegImageFile, "draft", spy)

    run(jpeg_bytes((4000, 3000)), "gallery_photo")

    (before, after), = seen
    assert before == (4000, 3000) and after[0] * after[1] <= before[0] * before[1] / 4  # decoded at 1/2 scale or less


def test_only_the_configured_number_of_optimisations_run_at_the_same_time(monkeypatch: pytest.MonkeyPatch) -> None:
    lock = threading.Lock()
    running = 0
    peak = 0
    real = images._optimize

    def slow(data, profile, max_pixels):
        nonlocal running, peak
        with lock:
            running += 1
            peak = max(peak, running)
        time.sleep(0.05)
        try:
            return real(data, profile, max_pixels)
        finally:
            with lock:
                running -= 1

    monkeypatch.setattr(images, "_optimize", slow)
    data = jpeg_bytes((200, 150))
    threads = [threading.Thread(target=lambda: run(data, concurrency=2)) for _ in range(8)]

    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert peak == 2
