from __future__ import annotations

from urllib.parse import urlencode, urlparse, urlunparse

from aiogram import Router
from aiogram.filters import CommandObject, CommandStart
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message, WebAppInfo

from app.config import Settings

router = Router(name="start")

_INVITE_PREFIX = "invite_"


def _build_mini_app_url(mini_app_url: str, invite_token: str | None) -> str:
    if not invite_token:
        return mini_app_url
    parts = urlparse(mini_app_url)
    query = urlencode({"invite": invite_token})
    return urlunparse(parts._replace(query=query))


def _build_keyboard(mini_app_url: str, invite_token: str | None) -> InlineKeyboardMarkup | None:
    if not mini_app_url:
        return None
    url = _build_mini_app_url(mini_app_url, invite_token)
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="Открыть TeamFlow Sports", web_app=WebAppInfo(url=url))]]
    )


def register(router_settings: Settings) -> Router:
    @router.message(CommandStart(deep_link=True))
    async def handle_start_with_deep_link(message: Message, command: CommandObject) -> None:
        invite_token: str | None = None
        payload = command.args or ""
        if payload.startswith(_INVITE_PREFIX):
            invite_token = payload[len(_INVITE_PREFIX):]

        keyboard = _build_keyboard(router_settings.mini_app_url, invite_token)
        text = (
            "Вас пригласили в команду в <b>TeamFlow Sports</b>.\n\nНажмите кнопку ниже, чтобы открыть "
            "приглашение."
            if invite_token
            else "Добро пожаловать в <b>TeamFlow Sports</b> — приложение для управления "
            "спортивными командами.\n\nНажмите кнопку ниже, чтобы открыть приложение."
        )
        await message.answer(text, reply_markup=keyboard)

    @router.message(CommandStart())
    async def handle_start(message: Message) -> None:
        keyboard = _build_keyboard(router_settings.mini_app_url, invite_token=None)
        await message.answer(
            "Добро пожаловать в <b>TeamFlow Sports</b> — приложение для управления "
            "спортивными командами.\n\nНажмите кнопку ниже, чтобы открыть приложение.",
            reply_markup=keyboard,
        )

    return router
