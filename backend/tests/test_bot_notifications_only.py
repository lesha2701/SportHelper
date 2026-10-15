"""The Telegram bot only delivers notifications: /start (the link to the website) is the one thing it
answers, and the old admin commands (/admin, /stats, /broadcast, ...) are gone."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import pytest
from aiogram import Bot
from aiogram.client.session.base import BaseSession
from aiogram.methods import SendMessage, TelegramMethod
from aiogram.types import Chat, Message, Update, User

from app.bot import bot as bot_module
from app.bot.handlers import start as start_module
from app.config import Settings


class RecordingSession(BaseSession):
    """Collects every call the bot makes to the Telegram API instead of making it."""

    def __init__(self) -> None:
        super().__init__()
        self.calls: list[TelegramMethod] = []

    async def close(self) -> None:  # pragma: no cover - nothing to close
        return None

    async def make_request(self, bot, method, timeout=None):
        self.calls.append(method)
        if isinstance(method, SendMessage):
            return Message(
                message_id=1, date=datetime.now(timezone.utc), chat=Chat(id=method.chat_id, type="private"), text=method.text
            )
        return True

    async def stream_content(self, *args, **kwargs):  # pragma: no cover
        raise NotImplementedError


class FakePool:
    @asynccontextmanager
    async def acquire(self):
        yield object()


def _update(text: str, *, chat_type: str = "private") -> Update:
    user = User(id=42, is_bot=False, first_name="Аня")
    message = Message(
        message_id=1, date=datetime.now(timezone.utc), chat=Chat(id=42, type=chat_type), from_user=user, text=text,
        entities=[{"type": "bot_command", "offset": 0, "length": len(text.split()[0])}] if text.startswith("/") else None,
    )
    return Update(update_id=1, message=message)


@pytest.fixture
def harness(monkeypatch):
    settings = Settings(_env_file=None, APP_BASE_URL="https://sport.example.com", TELEGRAM_BOT_TOKEN="1:abc")
    session = RecordingSession()
    bot = Bot(token="1:abc", session=session)

    async def no_user(conn, telegram_id):
        return None

    monkeypatch.setattr(start_module.users_repo, "get_by_telegram_id", no_user)
    dispatcher = bot_module.create_dispatcher(settings, FakePool())

    def feed(text: str, **kwargs) -> list[TelegramMethod]:
        asyncio.run(dispatcher.feed_update(bot, _update(text, **kwargs)))
        return session.calls

    return feed


def test_start_sends_the_link_to_the_website(harness) -> None:
    calls = harness("/start")

    assert len(calls) == 1
    assert "https://sport.example.com/register" in str(calls[0].reply_markup)


@pytest.mark.parametrize(
    "text", ["/admin", "/stats", "/broadcast hello", "/ban 1", "/users", "/help", "привет", "/start_something_else"]
)
def test_everything_else_gets_no_reply(harness, text) -> None:
    assert harness(text) == []


def test_the_bot_stays_silent_in_group_chats(harness) -> None:
    assert harness("/start", chat_type="supergroup") == []


def test_the_command_menu_contains_only_start() -> None:
    assert [c.command for c in bot_module.BOT_COMMANDS] == ["start"]
