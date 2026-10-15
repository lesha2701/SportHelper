"""The bot's user-facing commands.

Telegram is no longer how people sign in - the website has its own accounts
(email + password). The bot keeps two small jobs:

  * /start for a legacy account (created back when Telegram was the login):
    proves Telegram ownership by issuing a one-time link that lets the owner
    attach an email and a password to the SAME account, so none of their data
    is lost;
  * /start link_<token>: connects a website account to this Telegram chat so
    notifications are also delivered here.
"""
from __future__ import annotations

import html

import asyncpg
from aiogram import F, Router
from aiogram.filters import CommandObject, CommandStart
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from app.bot.deeplink import build_site_url
from app.config import Settings
from app.repositories import accounts as accounts_repo
from app.repositories import users as users_repo
from app.security.tokens import hash_token
from app.services import claim as claim_service

router = Router(name="start")

_INVITE_PREFIX = "invite_"
_LINK_PREFIX = "link_"
_LINK_CALLBACK = "tg_link:"


def _site_button(
    settings: Settings, text: str, path: str = "/", params: dict[str, str] | None = None
) -> InlineKeyboardMarkup | None:
    if not settings.app_base_url:
        return None
    url = build_site_url(settings.app_base_url, params or {}, path)
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=text, url=url)]])


def register(router_settings: Settings, pool: asyncpg.Pool | None = None) -> Router:
    settings = router_settings

    @router.message(CommandStart(deep_link=True, magic=F.args.startswith(_LINK_PREFIX)))
    async def handle_link(message: Message, command: CommandObject) -> None:
        token = (command.args or "")[len(_LINK_PREFIX):]
        if pool is None or message.from_user is None:
            await message.answer("Подключение сейчас недоступно.")
            return
        async with pool.acquire() as conn:
            owner = await claim_service.owner_of_link_token(conn, token)
        if owner is None:
            await message.answer("Ссылка устарела. Нажмите «Подключить Telegram» на сайте ещё раз.")
            return
        # An explicit confirm tap, and the account is named: a link someone else
        # sent you can't attach your Telegram to THEIR account without you seeing whose it is.
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[[InlineKeyboardButton(text="Подключить уведомления", callback_data=_LINK_CALLBACK + token)]]
        )
        await message.answer(
            f"Подключить этот Telegram к аккаунту <b>{html.escape(owner)}</b> на SportArenaGlobal? "
            "Уведомления о тренировках, заявках и заданиях будут приходить сюда.\n\n"
            "Если это не ваш аккаунт или вы ничего не подключали — проигнорируйте сообщение.",
            reply_markup=keyboard,
        )

    @router.callback_query(F.data.startswith(_LINK_CALLBACK))
    async def handle_link_confirm(callback: CallbackQuery) -> None:
        token = (callback.data or "")[len(_LINK_CALLBACK):]
        if pool is None or callback.message is None:
            await callback.answer("Недоступно", show_alert=True)
            return
        tg = callback.from_user
        async with pool.acquire() as conn:
            status, _user = await accounts_repo.link_telegram(conn, hash_token(token), tg.id, tg.username)
        await callback.answer()
        text = {
            "ok": "Готово — уведомления будут приходить в этот чат.",
            "telegram_taken": "Этот Telegram уже подключён к другому аккаунту. Отвяжите его там или используйте другой Telegram.",
        }.get(status, "Ссылка устарела. Нажмите «Подключить Telegram» на сайте ещё раз.")
        await callback.message.edit_text(text)

    @router.message(CommandStart(deep_link=True, magic=F.args.startswith(_INVITE_PREFIX)))
    async def handle_invite(message: Message, command: CommandObject) -> None:
        invite_token = (command.args or "")[len(_INVITE_PREFIX):]
        keyboard = _site_button(settings, "Открыть приглашение", params={"invite": invite_token})
        await message.answer(
            "Вас пригласили в команду в <b>SportArenaGlobal</b>.\n\nОткройте приглашение на сайте — "
            "войдите или зарегистрируйтесь, и вы окажетесь в команде.",
            reply_markup=keyboard,
        )

    @router.message(CommandStart())
    async def handle_start(message: Message) -> None:
        tg = message.from_user
        user = None
        if pool is not None and tg is not None:
            async with pool.acquire() as conn:
                user = await users_repo.get_by_telegram_id(conn, tg.id)
                if claim_service.is_claimable(user):
                    # A legacy account that still has no email/password: hand out
                    # a one-time link (valid for a short time, usable once).
                    token = await claim_service.issue_claim_token(conn, user, settings)
                    keyboard = _site_button(settings, "Перенести аккаунт на email", "/claim", {"token": token})
                    await message.answer(
                        "Теперь <b>SportArenaGlobal</b> работает как обычный сайт — вход по email и паролю, "
                        "Telegram больше не нужен.\n\nВаш аккаунт со всеми тренировками и данными можно "
                        "перенести: нажмите кнопку, укажите email и придумайте пароль. Ссылка действует "
                        f"{settings.telegram_token_ttl_minutes} мин. и открывается один раз.",
                        reply_markup=keyboard,
                    )
                    return

        if user is not None:
            await message.answer(
                "Этот Telegram подключён к аккаунту <b>SportArenaGlobal</b>. Уведомления будут приходить сюда. "
                "Войти можно на сайте по email и паролю.",
                reply_markup=_site_button(settings, "Открыть сайт"),
            )
            return
        await message.answer(
            "Добро пожаловать в <b>SportArenaGlobal</b>!\n\nСоздайте аккаунт на сайте. Потом в настройках "
            "аккаунта можно подключить Telegram, чтобы получать уведомления здесь.",
            reply_markup=_site_button(settings, "Открыть сайт", "/register"),
        )

    return router
