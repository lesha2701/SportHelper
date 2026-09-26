from __future__ import annotations

import asyncpg
from aiogram import F, Router
from aiogram.filters import CommandObject, CommandStart
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message, WebAppInfo

from app.bot.deeplink import build_mini_app_url
from app.config import Settings
from app.repositories import login_tokens as login_tokens_repo
from app.repositories import users as users_repo
from app.security.telegram_auth import TelegramUser

router = Router(name="start")

_INVITE_PREFIX = "invite_"
_LOGIN_PREFIX = "login_"
_LOGIN_CALLBACK = "browser_login:"


def _build_keyboard(mini_app_url: str, invite_token: str | None) -> InlineKeyboardMarkup | None:
    if not mini_app_url:
        return None
    url = build_mini_app_url(mini_app_url, {"invite": invite_token} if invite_token else {})
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="Открыть SportArena Global", web_app=WebAppInfo(url=url))]]
    )


def register(router_settings: Settings, pool: asyncpg.Pool | None = None) -> Router:
    @router.message(CommandStart(deep_link=True, magic=F.args.startswith(_LOGIN_PREFIX)))
    async def handle_browser_login(message: Message, command: CommandObject) -> None:
        token = (command.args or "")[len(_LOGIN_PREFIX):]
        if pool is None or message.from_user is None:
            await message.answer("Вход через браузер сейчас недоступен.")
            return
        # An explicit confirm tap, so a link someone else sent you can't log
        # them into your account by merely opening it.
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[[InlineKeyboardButton(text="Подтвердить вход", callback_data=_LOGIN_CALLBACK + token)]]
        )
        await message.answer(
            "Вход в <b>SportArena Global</b> в браузере.\n\nЕсли это вы — подтвердите вход. "
            "Если нет — просто проигнорируйте сообщение.",
            reply_markup=keyboard,
        )

    @router.callback_query(F.data.startswith(_LOGIN_CALLBACK))
    async def handle_browser_login_confirm(callback: CallbackQuery) -> None:
        token = (callback.data or "")[len(_LOGIN_CALLBACK):]
        if pool is None or callback.message is None:
            await callback.answer("Недоступно", show_alert=True)
            return
        tg = callback.from_user
        async with pool.acquire() as conn:
            user = await users_repo.upsert_from_telegram(
                conn,
                TelegramUser(
                    id=tg.id,
                    first_name=tg.first_name,
                    last_name=tg.last_name,
                    username=tg.username,
                    language_code=tg.language_code,
                    photo_url=None,
                ),
            )
            confirmed = not user["is_banned"] and await login_tokens_repo.confirm(conn, token, user["id"])
        await callback.answer()
        text = (
            "Готово — вернитесь в браузер, вход выполнен."
            if confirmed
            else "Ссылка для входа устарела. Начните вход в браузере заново."
        )
        await callback.message.edit_text(text)

    @router.message(CommandStart(deep_link=True))
    async def handle_start_with_deep_link(message: Message, command: CommandObject) -> None:
        invite_token: str | None = None
        payload = command.args or ""
        if payload.startswith(_INVITE_PREFIX):
            invite_token = payload[len(_INVITE_PREFIX):]

        keyboard = _build_keyboard(router_settings.mini_app_url, invite_token)
        text = (
            "Вас пригласили в команду в <b>SportArena Global</b>.\n\nНажмите кнопку ниже, чтобы открыть "
            "приглашение."
            if invite_token
            else "Добро пожаловать в <b>SportArena Global</b> — приложение для управления "
            "спортивными командами.\n\nНажмите кнопку ниже, чтобы открыть приложение."
        )
        await message.answer(text, reply_markup=keyboard)

    @router.message(CommandStart())
    async def handle_start(message: Message) -> None:
        keyboard = _build_keyboard(router_settings.mini_app_url, invite_token=None)
        await message.answer(
            "Добро пожаловать в <b>SportArena Global</b> — приложение для управления "
            "спортивными командами.\n\nНажмите кнопку ниже, чтобы открыть приложение.",
            reply_markup=keyboard,
        )

    return router
