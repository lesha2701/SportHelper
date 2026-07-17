"""Admin commands for the Telegram bot. Access is restricted to Telegram IDs
listed in ADMIN_TELEGRAM_IDS — everything below is only reachable by those
users, enforced via a router-level filter set up in register().

This is the one part of the project where the main logic lives in aiogram
handlers rather than FastAPI routes (see run_bot.py, which is the only
place the admin router is actually wired up — it needs its own Postgres
pool since it runs as a separate process from the backend).
"""
from __future__ import annotations

import asyncio
import html
import logging
from contextlib import suppress
from uuid import UUID

import asyncpg
from aiogram import F, Router
from aiogram.exceptions import TelegramAPIError
from aiogram.filters import Command, CommandObject
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from app.config import Settings
from app.database import check_connection
from app.integrations.yandex_disk import YandexDiskClient, YandexDiskError
from app.repositories import admin as admin_repo

logger = logging.getLogger("teamflow.bot.admin")

router = Router(name="admin")

_PAGE_SIZE = 10
_BROADCAST_RATE_LIMIT_SECONDS = 0.05  # stays well under Telegram's ~30 msg/s cap
_ERRORS_LIMIT = 10


class BroadcastStates(StatesGroup):
    waiting_for_text = State()
    waiting_for_confirmation = State()


def _fmt_dt(value) -> str:
    return value.strftime("%Y-%m-%d %H:%M") if value else "—"


def _fmt_bytes(size: int) -> str:
    value = float(size)
    for unit in ("Б", "КБ", "МБ", "ГБ", "ТБ"):
        if value < 1024:
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} ПБ"


def _parse_page(args: str | None) -> int:
    if args and args.strip().isdigit():
        return max(1, int(args.strip()))
    return 1


def _parse_telegram_id(args: str | None) -> int | None:
    if args and args.strip().isdigit():
        return int(args.strip())
    return None


def _user_line(user: dict) -> str:
    name = html.escape(f"{user['first_name']} {user.get('last_name') or ''}".strip())
    marker = " 🚫" if user["is_banned"] else ""
    return f"• <code>{user['telegram_id']}</code> {name}{marker} ({user['teams_count']} команд)"


def _team_line(team: dict) -> str:
    marker = " (без тренера)" if team["status"] == "without_coach" else ""
    return f"• <code>{team['id']}</code> {html.escape(team['name'])} — {team['members_count']} чел.{marker}"


def _pagination_keyboard(prefix: str, page: int, total: int) -> InlineKeyboardMarkup | None:
    total_pages = max(1, -(-total // _PAGE_SIZE))
    if total_pages <= 1:
        return None
    buttons = []
    if page > 1:
        buttons.append(InlineKeyboardButton(text="« Назад", callback_data=f"{prefix}:{page - 1}"))
    buttons.append(InlineKeyboardButton(text=f"{page}/{total_pages}", callback_data="noop"))
    if page < total_pages:
        buttons.append(InlineKeyboardButton(text="Вперёд »", callback_data=f"{prefix}:{page + 1}"))
    return InlineKeyboardMarkup(inline_keyboard=[buttons])


_MENU_TEXT = (
    "<b>Административное меню TeamFlow Sports</b>\n\n"
    "/stats — общая статистика проекта\n"
    "/users [страница] — список пользователей\n"
    "/teams [страница] — список команд\n"
    "/user &lt;telegram_id&gt; — информация о пользователе\n"
    "/team &lt;team_id&gt; — информация о команде\n"
    "/ban &lt;telegram_id&gt; — заблокировать пользователя\n"
    "/unban &lt;telegram_id&gt; — разблокировать пользователя\n"
    "/broadcast — рассылка сообщения всем активным пользователям\n"
    "/health — проверка PostgreSQL, Яндекс.Диска, ИИ и backend\n"
    "/disk — свободное и занятое место на Яндекс.Диске\n"
    "/errors — последние безопасные ошибки"
)


def register(settings: Settings, pool: asyncpg.Pool) -> Router:
    admin_ids = set(settings.admin_telegram_ids_list)
    router.message.filter(F.from_user.id.in_(admin_ids))
    router.callback_query.filter(F.from_user.id.in_(admin_ids))

    @router.message(Command("admin"))
    async def cmd_admin(message: Message) -> None:
        await message.answer(_MENU_TEXT)

    @router.message(Command("stats"))
    async def cmd_stats(message: Message) -> None:
        async with pool.acquire() as conn:
            stats = await admin_repo.get_project_stats(conn)
        text = (
            "<b>Статистика проекта</b>\n\n"
            f"Пользователи: {stats['total_users']} (заблокировано: {stats['banned_users']})\n"
            f"Команды: {stats['total_teams']} (без тренера: {stats['teams_without_coach']})\n"
            f"Тренировки: {stats['total_trainings']}\n"
            f"Матчи: {stats['total_matches']}\n"
            f"Задания: {stats['total_tasks']}\n"
            f"Упражнения: {stats['total_exercises']}\n"
            f"Планы тренировок: {stats['total_plans']}\n"
            f"Файлы: {stats['total_files']} ({_fmt_bytes(stats['total_files_size_bytes'])})\n"
            f"Уведомлений в очереди: {stats['pending_notifications']}"
        )
        await message.answer(text)

    async def _render_users_page(page: int) -> tuple[str, InlineKeyboardMarkup | None]:
        async with pool.acquire() as conn:
            total = await admin_repo.count_users(conn)
            users = await admin_repo.list_users(conn, limit=_PAGE_SIZE, offset=(page - 1) * _PAGE_SIZE)
        lines = [f"<b>Пользователи</b> (всего: {total})", ""]
        if users:
            lines.extend(_user_line(u) for u in users)
        else:
            lines.append("Пусто.")
        return "\n".join(lines), _pagination_keyboard("users_page", page, total)

    @router.message(Command("users"))
    async def cmd_users(message: Message, command: CommandObject) -> None:
        text, keyboard = await _render_users_page(_parse_page(command.args))
        await message.answer(text, reply_markup=keyboard)

    @router.callback_query(F.data.startswith("users_page:"))
    async def cb_users_page(callback: CallbackQuery) -> None:
        page = int(callback.data.split(":", 1)[1])
        text, keyboard = await _render_users_page(page)
        await callback.message.edit_text(text, reply_markup=keyboard)
        await callback.answer()

    async def _render_teams_page(page: int) -> tuple[str, InlineKeyboardMarkup | None]:
        async with pool.acquire() as conn:
            total = await admin_repo.count_teams(conn)
            teams = await admin_repo.list_teams(conn, limit=_PAGE_SIZE, offset=(page - 1) * _PAGE_SIZE)
        lines = [f"<b>Команды</b> (всего: {total})", ""]
        if teams:
            lines.extend(_team_line(t) for t in teams)
        else:
            lines.append("Пусто.")
        return "\n".join(lines), _pagination_keyboard("teams_page", page, total)

    @router.message(Command("teams"))
    async def cmd_teams(message: Message, command: CommandObject) -> None:
        text, keyboard = await _render_teams_page(_parse_page(command.args))
        await message.answer(text, reply_markup=keyboard)

    @router.callback_query(F.data.startswith("teams_page:"))
    async def cb_teams_page(callback: CallbackQuery) -> None:
        page = int(callback.data.split(":", 1)[1])
        text, keyboard = await _render_teams_page(page)
        await callback.message.edit_text(text, reply_markup=keyboard)
        await callback.answer()

    @router.callback_query(F.data == "noop")
    async def cb_noop(callback: CallbackQuery) -> None:
        await callback.answer()

    @router.message(Command("user"))
    async def cmd_user(message: Message, command: CommandObject) -> None:
        telegram_id = _parse_telegram_id(command.args)
        if telegram_id is None:
            await message.answer("Использование: /user &lt;telegram_id&gt;")
            return
        async with pool.acquire() as conn:
            detail = await admin_repo.get_user_detail(conn, telegram_id)
        if detail is None:
            await message.answer("Пользователь не найден.")
            return
        name = html.escape(f"{detail['first_name']} {detail.get('last_name') or ''}".strip())
        username = f"@{detail['username']}" if detail.get("username") else "—"
        teams_lines = "\n".join(
            f"  • {html.escape(t['name'])} ({t['role']})" for t in detail["teams"]
        ) or "  —"
        profiles = [p for p, has in (("игрок", detail["has_player_profile"]), ("тренер", detail["has_coach_profile"])) if has]
        text = (
            f"<b>{name}</b> ({username})\n"
            f"Telegram ID: <code>{detail['telegram_id']}</code>\n"
            f"Статус: {'🚫 заблокирован' if detail['is_banned'] else 'активен'}\n"
            f"Профили: {', '.join(profiles) or '—'}\n"
            f"Регистрация: {_fmt_dt(detail['created_at'])}\n"
            f"Последний вход: {_fmt_dt(detail['last_login_at'])}\n"
            f"Команды:\n{teams_lines}"
        )
        await message.answer(text)

    @router.message(Command("team"))
    async def cmd_team(message: Message, command: CommandObject) -> None:
        if not command.args:
            await message.answer("Использование: /team &lt;team_id&gt;")
            return
        try:
            team_id = UUID(command.args.strip())
        except ValueError:
            await message.answer("Некорректный team_id (ожидается UUID).")
            return
        async with pool.acquire() as conn:
            detail = await admin_repo.get_team_detail(conn, team_id)
        if detail is None:
            await message.answer("Команда не найдена.")
            return
        status_map = {"active": "активна", "without_coach": "без тренера"}
        text = (
            f"<b>{html.escape(detail['name'])}</b>\n"
            f"ID: <code>{detail['id']}</code>\n"
            f"Вид спорта: {html.escape(detail['sport'])}\n"
            f"Уровень: {detail.get('level') or '—'}\n"
            f"Статус: {status_map.get(detail['status'], detail['status'])}\n"
            f"Главный тренер: {html.escape(detail['head_coach_name']) if detail['head_coach_name'] else '—'}\n"
            f"Участников: {detail['members_count']}\n"
            f"Тренировок: {detail['trainings_count']}\n"
            f"Матчей: {detail['matches_count']}\n"
            f"Заданий: {detail['tasks_count']}\n"
            f"Создана: {_fmt_dt(detail['created_at'])}"
        )
        await message.answer(text)

    async def _set_ban(message: Message, command: CommandObject, banned: bool) -> None:
        telegram_id = _parse_telegram_id(command.args)
        if telegram_id is None:
            await message.answer(f"Использование: /{'ban' if banned else 'unban'} &lt;telegram_id&gt;")
            return
        async with pool.acquire() as conn:
            user = await admin_repo.set_banned(conn, telegram_id, banned)
            if user is not None:
                await admin_repo.record_audit(
                    conn,
                    admin_telegram_id=message.from_user.id,
                    action="ban_user" if banned else "unban_user",
                    target_type="user",
                    target_id=str(telegram_id),
                )
        if user is None:
            await message.answer("Пользователь не найден.")
            return
        await message.answer(
            f"Пользователь <code>{telegram_id}</code> {'заблокирован' if banned else 'разблокирован'}."
        )
        if banned:
            with suppress(TelegramAPIError):
                await message.bot.send_message(
                    telegram_id, "Ваш доступ к TeamFlow Sports заблокирован администратором."
                )

    @router.message(Command("ban"))
    async def cmd_ban(message: Message, command: CommandObject) -> None:
        await _set_ban(message, command, True)

    @router.message(Command("unban"))
    async def cmd_unban(message: Message, command: CommandObject) -> None:
        await _set_ban(message, command, False)

    @router.message(Command("health"))
    async def cmd_health(message: Message) -> None:
        db_ok = await check_connection(pool)
        disk_status = "не настроен"
        if settings.yandex_disk_oauth_token:
            try:
                await YandexDiskClient(settings).get_disk_info()
                disk_status = "OK"
            except YandexDiskError as exc:
                disk_status = f"ошибка ({exc.status_code})"
        text = (
            "<b>Проверка сервисов</b>\n\n"
            f"PostgreSQL: {'OK' if db_ok else '⚠ ошибка'}\n"
            f"Яндекс.Диск: {disk_status}\n"
            "ИИ (Yandex AI Studio): не настроено (итерация 14)\n"
            "Бот: OK"
        )
        await message.answer(text)

    @router.message(Command("disk"))
    async def cmd_disk(message: Message) -> None:
        if not settings.yandex_disk_oauth_token:
            await message.answer("Яндекс.Диск не настроен (нет YANDEX_DISK_OAUTH_TOKEN).")
            return
        try:
            info = await YandexDiskClient(settings).get_disk_info()
        except YandexDiskError as exc:
            await message.answer(f"Не удалось получить данные Яндекс.Диска: {html.escape(str(exc))}")
            return
        free = info["total_space"] - info["used_space"]
        text = (
            "<b>Яндекс.Диск</b>\n\n"
            f"Занято: {_fmt_bytes(info['used_space'])}\n"
            f"Свободно: {_fmt_bytes(free)}\n"
            f"Всего: {_fmt_bytes(info['total_space'])}\n"
            f"Корзина: {_fmt_bytes(info['trash_size'])}"
        )
        await message.answer(text)

    @router.message(Command("errors"))
    async def cmd_errors(message: Message) -> None:
        async with pool.acquire() as conn:
            errors = await admin_repo.list_recent_errors(conn, limit=_ERRORS_LIMIT)
        if not errors:
            await message.answer("Ошибок не зафиксировано.")
            return
        blocks = ["<b>Последние ошибки</b>"]
        for err in errors:
            blocks.append(
                f"[{_fmt_dt(err['created_at'])}] {err['source']}/{html.escape(err['logger_name'])}\n"
                f"<code>{html.escape(err['message'][:300])}</code>"
            )
        await message.answer("\n\n".join(blocks))

    @router.message(Command("broadcast"))
    async def cmd_broadcast_start(message: Message, state: FSMContext) -> None:
        await state.set_state(BroadcastStates.waiting_for_text)
        await message.answer(
            "Введите текст рассылки одним сообщением (поддерживается HTML-разметка Telegram). "
            "Для отмены — /cancel."
        )

    @router.message(Command("cancel"), BroadcastStates.waiting_for_text)
    @router.message(Command("cancel"), BroadcastStates.waiting_for_confirmation)
    async def cmd_broadcast_cancel(message: Message, state: FSMContext) -> None:
        await state.clear()
        await message.answer("Рассылка отменена.")

    @router.message(BroadcastStates.waiting_for_text)
    async def broadcast_receive_text(message: Message, state: FSMContext) -> None:
        text = message.html_text or ""
        if not text.strip():
            await message.answer("Текст пуст, отправьте текстовое сообщение или /cancel.")
            return
        async with pool.acquire() as conn:
            recipients = await admin_repo.list_active_recipient_telegram_ids(conn)
        await state.update_data(broadcast_text=text, recipients=recipients)
        await state.set_state(BroadcastStates.waiting_for_confirmation)
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(text="✅ Отправить", callback_data="broadcast_confirm"),
                    InlineKeyboardButton(text="✖ Отмена", callback_data="broadcast_cancel"),
                ]
            ]
        )
        await message.answer(
            f"<b>Предпросмотр рассылки</b> (получателей: {len(recipients)}):\n\n{text}",
            reply_markup=keyboard,
        )

    @router.callback_query(F.data == "broadcast_cancel", BroadcastStates.waiting_for_confirmation)
    async def broadcast_cancel_cb(callback: CallbackQuery, state: FSMContext) -> None:
        await state.clear()
        await callback.message.edit_text("Рассылка отменена.")
        await callback.answer()

    @router.callback_query(F.data == "broadcast_confirm", BroadcastStates.waiting_for_confirmation)
    async def broadcast_confirm_cb(callback: CallbackQuery, state: FSMContext) -> None:
        data = await state.get_data()
        text = data.get("broadcast_text", "")
        recipients: list[int] = data.get("recipients", [])
        await state.clear()
        await callback.answer()
        await callback.message.edit_text(f"Рассылка запущена: {len(recipients)} получателей…")

        sent = 0
        failed = 0
        for telegram_id in recipients:
            try:
                await callback.bot.send_message(telegram_id, text)
                sent += 1
            except TelegramAPIError as exc:
                failed += 1
                logger.warning("Broadcast failed for %s: %s", telegram_id, exc)
            await asyncio.sleep(_BROADCAST_RATE_LIMIT_SECONDS)

        async with pool.acquire() as conn:
            await admin_repo.record_audit(
                conn,
                admin_telegram_id=callback.from_user.id,
                action="broadcast",
                details={"total": len(recipients), "sent": sent, "failed": failed},
            )
        await callback.message.answer(
            f"<b>Рассылка завершена.</b>\nОтправлено: {sent}\nНе удалось: {failed}\nВсего получателей: {len(recipients)}"
        )

    return router
