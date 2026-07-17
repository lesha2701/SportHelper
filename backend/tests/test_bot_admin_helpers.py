"""Unit tests for the pure formatting/parsing helpers behind the bot's admin
commands (app/bot/handlers/admin.py). The handlers themselves talk directly
to a real asyncpg pool and aiogram Message/CallbackQuery objects — like the
rest of the background-task machinery (app/services/background.py, which
has no pytest coverage either), they are exercised via the real-infra
verification pass described in the project's dev workflow, not fakes."""
from __future__ import annotations

from datetime import datetime, timezone

from app.bot.handlers import admin as admin_module


def test_fmt_bytes_scales_units():
    assert admin_module._fmt_bytes(0) == "0.0 Б"
    assert admin_module._fmt_bytes(1536) == "1.5 КБ"
    assert admin_module._fmt_bytes(1024 * 1024 * 3) == "3.0 МБ"
    assert admin_module._fmt_bytes(1024**4) == "1.0 ТБ"


def test_fmt_dt_handles_none_and_value():
    assert admin_module._fmt_dt(None) == "—"
    dt = datetime(2026, 7, 17, 9, 30, tzinfo=timezone.utc)
    assert admin_module._fmt_dt(dt) == "2026-07-17 09:30"


def test_parse_page_defaults_and_clamps():
    assert admin_module._parse_page(None) == 1
    assert admin_module._parse_page("") == 1
    assert admin_module._parse_page("abc") == 1
    assert admin_module._parse_page("0") == 1
    assert admin_module._parse_page("3") == 3


def test_parse_telegram_id_rejects_non_digits():
    assert admin_module._parse_telegram_id(None) is None
    assert admin_module._parse_telegram_id("not-an-id") is None
    assert admin_module._parse_telegram_id("123456789") == 123456789


def test_user_line_marks_banned_users():
    user = {
        "telegram_id": 42,
        "first_name": "Ivan",
        "last_name": "Petrov",
        "is_banned": True,
        "teams_count": 2,
    }
    line = admin_module._user_line(user)
    assert "42" in line
    assert "Ivan Petrov" in line
    assert "🚫" in line
    assert "2 команд" in line


def test_user_line_escapes_html_in_name():
    user = {
        "telegram_id": 1,
        "first_name": "<script>",
        "last_name": None,
        "is_banned": False,
        "teams_count": 0,
    }
    line = admin_module._user_line(user)
    assert "<script>" not in line
    assert "&lt;script&gt;" in line


def test_team_line_marks_without_coach():
    team = {"id": "abc-123", "name": "Дельфины", "status": "without_coach", "members_count": 5}
    line = admin_module._team_line(team)
    assert "без тренера" in line
    assert "Дельфины" in line


def test_pagination_keyboard_none_when_single_page():
    assert admin_module._pagination_keyboard("users_page", 1, total=5) is None
    assert admin_module._pagination_keyboard("users_page", 1, total=10) is None


def test_pagination_keyboard_first_page_has_only_next():
    keyboard = admin_module._pagination_keyboard("users_page", 1, total=25)
    assert keyboard is not None
    row = keyboard.inline_keyboard[0]
    texts = [button.text for button in row]
    assert texts == ["1/3", "Вперёд »"]


def test_pagination_keyboard_last_page_has_only_back():
    keyboard = admin_module._pagination_keyboard("users_page", 3, total=25)
    assert keyboard is not None
    row = keyboard.inline_keyboard[0]
    texts = [button.text for button in row]
    assert texts == ["« Назад", "3/3"]


def test_pagination_keyboard_middle_page_has_both():
    keyboard = admin_module._pagination_keyboard("teams_page", 2, total=25)
    assert keyboard is not None
    row = keyboard.inline_keyboard[0]
    callback_data = [button.callback_data for button in row]
    assert callback_data == ["teams_page:1", "noop", "teams_page:3"]
