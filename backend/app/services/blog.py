"""Blog articles: the text format, the automatic check at submission, and the home-page pick.

The text is a list of blocks. A block is a paragraph, a heading or a quote (`text`) or a list (`items`). Inside a text only **bold** and *italic* markers
are meaningful; every client shows the rest as plain text (no HTML), so an article cannot inject markup."""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any

from app.services.contact_filter import contains_contact

# The same list as the profile's sport picker (frontend/src/types/profile.ts COMMON_SPORTS).
SPORTS: tuple[str, ...] = (
    "Футбол", "Баскетбол", "Хоккей", "Волейбол", "Гандбол", "Футзал", "Регби", "Плавание", "Большой теннис", "Настольный теннис",
    "Боевые искусства", "Бокс", "Лёгкая атлетика", "Гимнастика", "Фитнес", "Киберспорт", "Другое",
)

TITLE_MIN, TITLE_MAX = 3, 120
BODY_MIN, BODY_MAX = 30, 10_000
MAX_BLOCKS = 60
MAX_LIST_ITEMS = 30
MAX_IMAGES = 3
COMMENT_MAX = 1000
BLOCK_TYPES = ("paragraph", "heading", "quote", "list")

# The words that make an article an advertisement more often than not. Not a rejection: the administrator sees the flag and decides.
_PROMO = re.compile(r"скидк|промокод|акци[яюи]\b|распродаж|записывайтесь|запишитесь|звоните|пишите в (?:лс|директ|личку)|купите|закажите", re.IGNORECASE)
_MARKERS = re.compile(r"\*{1,2}")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class ArticleProblem(Exception):
    """What is wrong with an article, in words the author can act on."""

    def __init__(self, problems: list[str], code: str = "article_rejected"):
        super().__init__("; ".join(problems))
        self.problems = problems
        self.code = code


def plain(text: str) -> str:
    return _MARKERS.sub("", text)


def _clean(text: str) -> str:
    return _CONTROL.sub("", text).strip()


def normalize_blocks(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The blocks as they are stored: known types only, trimmed text, no empty blocks."""
    result: list[dict[str, Any]] = []
    for block in blocks[:MAX_BLOCKS]:
        kind = block.get("type")
        if kind not in BLOCK_TYPES:
            continue
        if kind == "list":
            items = [_clean(str(i))[:500] for i in (block.get("items") or [])[:MAX_LIST_ITEMS]]
            items = [i for i in items if i]
            if items:
                result.append({"type": "list", "items": items})
        else:
            text = _clean(str(block.get("text") or ""))[:5000]
            if text:
                result.append({"type": kind, "text": text})
    return result


def plain_text(blocks: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for block in blocks:
        if block["type"] == "list":
            parts.extend(plain(i) for i in block["items"])
        else:
            parts.append(plain(block["text"]))
    return "\n".join(parts)


@dataclass
class CheckResult:
    flags: list[str] = field(default_factory=list)


def check_article(*, title: str, sport: str, blocks: list[dict[str, Any]], image_count: int) -> CheckResult:
    """The automatic check at submission. Raises ArticleProblem with every problem found; returns the flags for the administrator."""
    problems: list[str] = []
    text = plain_text(blocks)
    if not TITLE_MIN <= len(title.strip()) <= TITLE_MAX:
        problems.append(f"Заголовок: от {TITLE_MIN} до {TITLE_MAX} знаков.")
    if sport not in SPORTS:
        problems.append("Выберите вид спорта из списка.")
    if len(text) < BODY_MIN:
        problems.append(f"Статья слишком короткая: нужно хотя бы {BODY_MIN} знаков.")
    if len(text) > BODY_MAX:
        problems.append(f"Статья слишком длинная: не больше {BODY_MAX} знаков.")
    if image_count > MAX_IMAGES:
        problems.append(f"Не больше {MAX_IMAGES} фото.")
    if contains_contact(title) or contains_contact(text):
        problems.append("В статье нельзя указывать телефоны, почту, ссылки и ники. Для записи прикрепите своё объявление.")
    if problems:
        raise ArticleProblem(problems)
    flags = ["promo_words"] if _PROMO.search(title) or _PROMO.search(text) else []
    return CheckResult(flags=flags)


def excerpt(text: str, limit: int = 180) -> str:
    one_line = " ".join(text.split())
    return one_line if len(one_line) <= limit else one_line[: limit - 1].rstrip() + "…"


# --- the pick for the home page ---------------------------------------------------------------------------------------------

# score = (3 likes + 2 comments + views) / (hours since publication + 2) ^ 1.3: fresh and liked rises, old fades.
SCORE_SQL = "(3 * p.likes_count + 2 * p.comments_count + p.views_count)::float8 / power(extract(epoch FROM now() - p.published_at) / 3600.0 + 2, 1.3)"
WINDOW_DAYS = 14
PICK_TTL_SECONDS = 3600
_pick_cache: dict[str, tuple[float, list[Any]]] = {}


def cached_pick(key: str) -> list[Any] | None:
    hit = _pick_cache.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    return None


def remember_pick(key: str, ids: list[Any]) -> None:
    _pick_cache[key] = (time.monotonic() + PICK_TTL_SECONDS, ids)


def forget_picks() -> None:
    _pick_cache.clear()
