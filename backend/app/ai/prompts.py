"""Loads AI prompts from separate text files (app/ai/prompts/*.txt) per the
project spec ("промпты должны храниться в отдельных файлах"), rather than
inlining them as Python string literals.

System prompts get a shared safety/behavior suffix appended here instead of
repeating it in every file — every AI feature must refuse diagnoses/medical
advice, never guarantee results, and answer in Russian as a draft the coach
still has to review.

User prompt templates use {{placeholder}} tokens, filled in via plain
str.replace (not str.format) because the templates themselves instruct the
model to output JSON containing literal braces, which str.format would
choke on.
"""
from __future__ import annotations

from pathlib import Path

_PROMPTS_DIR = Path(__file__).parent / "prompts"

_SAFETY_SUFFIX = (
    "\n\nВажные ограничения: ты не ставишь диагнозы, не назначаешь лечение и не даёшь "
    "медицинских рекомендаций; если видишь упоминание боли, травмы или ограничения по "
    "здоровью — учти это и предложи снизить нагрузку на проблемную зону, порекомендуй "
    "обратиться к врачу, но не давай медицинских советов сам. Никогда не гарантируй "
    "результат. Отвечай на русском языке, конкретно и по делу, без общих фраз и воды — "
    "избегай советов вида «больше тренируйтесь» без конкретики. Любой твой ответ — черновик, "
    "который перед публикацией игрокам проверит и при необходимости отредактирует тренер."
)


def load_system_prompt(name: str) -> str:
    text = (_PROMPTS_DIR / f"{name}_system.txt").read_text(encoding="utf-8").strip()
    return text + _SAFETY_SUFFIX


def render_user_prompt(name: str, **values: str) -> str:
    template = (_PROMPTS_DIR / f"{name}_user.txt").read_text(encoding="utf-8")
    for key, value in values.items():
        template = template.replace("{{" + key + "}}", str(value))
    return template.strip()
