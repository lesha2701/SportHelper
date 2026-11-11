"""Telling an out-of-date mobile app to update (card #28).

The apps send who they are on every request: `X-Client-Platform: ios|android` and `X-Client-Version: 1.4.0`. When the server's
MIN_CLIENT_VERSION_<PLATFORM> is higher than the app's version, the request is answered with 426 `client_update_required` (with the
minimum version and where to update) instead of whatever the route would have done, so a breaking change in the API never reaches an
app that cannot understand it. The website sends neither header and is never affected; an old app that sends none cannot be told."""
from __future__ import annotations

import re
from typing import Literal

Platform = Literal["ios", "android"]
PLATFORMS: tuple[Platform, ...] = ("ios", "android")

_VERSION = re.compile(r"\d{1,6}(\.\d{1,6}){0,3}")


def parse_version(text: str | None) -> tuple[int, ...] | None:
    """«1.4.0» -> (1, 4, 0). None for anything that is not a dotted number («1.4.0-beta», empty, garbage): such a value is never a reason to refuse."""
    if text is None:
        return None
    text = text.strip()
    if not _VERSION.fullmatch(text):
        return None
    return tuple(int(part) for part in text.split("."))


def is_older(version: tuple[int, ...], minimum: tuple[int, ...]) -> bool:
    """Numeric, part by part («1.10» is newer than «1.9»), missing parts are zeros («1.4» is «1.4.0»)."""
    length = max(len(version), len(minimum))
    return version + (0,) * (length - len(version)) < minimum + (0,) * (length - len(minimum))


def platform_of(header: str | None) -> Platform | None:
    value = (header or "").strip().lower()
    return value if value in PLATFORMS else None  # type: ignore[return-value]
