"""Texts of the transactional emails (Russian). Each function returns an
OutgoingEmail; links are built from APP_BASE_URL."""
from __future__ import annotations

from html import escape
from urllib.parse import quote

from app.config import Settings
from app.services.email import OutgoingEmail

_BRAND = "SportArena Global"


def _link(settings: Settings, path: str, token: str, next_path: str | None = None) -> str:
    url = f"{settings.app_base_url.rstrip('/')}{path}?token={quote(token, safe='')}"
    return f"{url}&next={quote(next_path, safe='')}" if next_path else url


def _wrap_html(title: str, paragraphs: list[str], button: tuple[str, str] | None, footer: str) -> str:
    body = "".join(f'<p style="margin:0 0 14px;line-height:1.5">{escape(p)}</p>' for p in paragraphs)
    cta = ""
    if button:
        label, url = button
        cta = (
            f'<p style="margin:22px 0"><a href="{escape(url)}" style="background:#d91e2b;color:#fff;'
            f'text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">'
            f"{escape(label)}</a></p>"
            f'<p style="margin:0 0 14px;color:#5c5e66;font-size:13px">Если кнопка не работает, откройте ссылку: '
            f'<br><span style="word-break:break-all">{escape(url)}</span></p>'
        )
    return (
        '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#17181b;max-width:520px;'
        'margin:0 auto;padding:24px">'
        f'<p style="font-size:20px;font-weight:800;margin:0 0 18px;letter-spacing:.02em">{escape(_BRAND)}</p>'
        f'<h1 style="font-size:20px;margin:0 0 14px">{escape(title)}</h1>{body}{cta}'
        f'<p style="margin:26px 0 0;color:#96979e;font-size:12px">{escape(footer)}</p></div>'
    )


def verification_email(
    settings: Settings, to: str, first_name: str, token: str, next_path: str | None = None
) -> OutgoingEmail:
    url = _link(settings, "/verify-email", token, next_path)
    hours = settings.email_verify_ttl_hours
    paragraphs = [
        f"Здравствуйте, {first_name}!",
        "Чтобы завершить регистрацию, подтвердите адрес электронной почты.",
        f"Ссылка действует {hours} ч. и открывается один раз.",
    ]
    text = "\n\n".join(paragraphs) + f"\n\nПодтвердить email: {url}\n\nЕсли вы не регистрировались — просто проигнорируйте письмо."
    return OutgoingEmail(
        to=to,
        subject=f"Подтвердите email — {_BRAND}",
        text=text,
        html=_wrap_html("Подтвердите email", paragraphs, ("Подтвердить email", url),
                        "Если вы не регистрировались, просто проигнорируйте это письмо."),
    )


def password_reset_email(settings: Settings, to: str, first_name: str, token: str) -> OutgoingEmail:
    url = _link(settings, "/reset-password", token)
    minutes = settings.password_reset_ttl_minutes
    paragraphs = [
        f"Здравствуйте, {first_name}!",
        "Мы получили запрос на восстановление пароля.",
        f"Ссылка действует {minutes} минут и открывается один раз. После смены пароля все активные сессии будут завершены.",
    ]
    text = "\n\n".join(paragraphs) + f"\n\nЗадать новый пароль: {url}\n\nЕсли это были не вы — ничего делать не нужно, пароль останется прежним."
    return OutgoingEmail(
        to=to,
        subject=f"Восстановление пароля — {_BRAND}",
        text=text,
        html=_wrap_html("Восстановление пароля", paragraphs, ("Задать новый пароль", url),
                        "Если это были не вы, ничего делать не нужно — пароль останется прежним."),
    )


def password_changed_email(settings: Settings, to: str, first_name: str) -> OutgoingEmail:
    paragraphs = [
        f"Здравствуйте, {first_name}!",
        "Пароль от вашего аккаунта был изменён.",
        "Если это сделали не вы, срочно восстановите доступ через «Забыли пароль?» и напишите в поддержку.",
    ]
    login = f"{settings.app_base_url.rstrip('/')}/forgot-password"
    return OutgoingEmail(
        to=to,
        subject=f"Пароль изменён — {_BRAND}",
        text="\n\n".join(paragraphs) + f"\n\nВосстановить доступ: {login}",
        html=_wrap_html("Пароль изменён", paragraphs, ("Восстановить доступ", login), "Это автоматическое уведомление безопасности."),
    )


def email_change_confirm_email(settings: Settings, to: str, first_name: str, token: str) -> OutgoingEmail:
    url = _link(settings, "/confirm-email-change", token)
    hours = settings.email_change_ttl_hours
    paragraphs = [
        f"Здравствуйте, {first_name}!",
        "Вы запросили смену адреса электронной почты. Подтвердите новый адрес.",
        f"Ссылка действует {hours} ч. и открывается один раз.",
    ]
    return OutgoingEmail(
        to=to,
        subject=f"Подтвердите новый email — {_BRAND}",
        text="\n\n".join(paragraphs) + f"\n\nПодтвердить: {url}",
        html=_wrap_html("Подтвердите новый email", paragraphs, ("Подтвердить новый адрес", url),
                        "Если вы не запрашивали смену, проигнорируйте письмо."),
    )


def email_change_notice_email(settings: Settings, to: str, first_name: str, new_email: str) -> OutgoingEmail:
    paragraphs = [
        f"Здравствуйте, {first_name}!",
        f"Для вашего аккаунта запрошена смена email на {new_email}.",
        "Если это были не вы, срочно смените пароль в настройках аккаунта.",
    ]
    return OutgoingEmail(
        to=to,
        subject=f"Запрошена смена email — {_BRAND}",
        text="\n\n".join(paragraphs),
        html=_wrap_html("Запрошена смена email", paragraphs, None, "Это автоматическое уведомление безопасности."),
    )


def email_changed_notice_email(settings: Settings, to: str, first_name: str, new_email: str) -> OutgoingEmail:
    paragraphs = [
        f"Здравствуйте, {first_name}!",
        f"Адрес электронной почты вашего аккаунта изменён на {new_email}.",
        "Если это были не вы, немедленно свяжитесь с поддержкой.",
    ]
    return OutgoingEmail(
        to=to,
        subject=f"Email аккаунта изменён — {_BRAND}",
        text="\n\n".join(paragraphs),
        html=_wrap_html("Email аккаунта изменён", paragraphs, None, "Это автоматическое уведомление безопасности."),
    )


def deletion_requested_email(settings: Settings, to: str, first_name: str) -> OutgoingEmail:
    days = settings.account_deletion_grace_days
    paragraphs = [
        f"Здравствуйте, {first_name}!",
        f"Мы получили запрос на удаление аккаунта. Он будет удалён через {days} дн.: личные данные будут обезличены, "
        "а записи, которые нужно хранить по закону (например, финансовая история), сохранятся без привязки к вам.",
        "Передумали? Войдите в аккаунт и отмените удаление в настройках безопасности.",
    ]
    return OutgoingEmail(
        to=to,
        subject=f"Запрос на удаление аккаунта — {_BRAND}",
        text="\n\n".join(paragraphs),
        html=_wrap_html("Запрос на удаление аккаунта", paragraphs, None, "Это автоматическое уведомление безопасности."),
    )
