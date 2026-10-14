"""Outgoing email over SMTP (configured through environment variables).

No extra infrastructure or paid service is required: any SMTP relay works
(Yandex 360, Mail.ru for business, Unisender, Mailgun, a Postfix of your own).
In development point it at Mailpit (see docker-compose.dev.yml), which catches
every message and shows it at http://localhost:8025.

Security rules honoured here:
  * a message body can contain a one-time link, so it is NEVER logged when
    APP_MODE is "main" (production); only the recipient and subject are;
  * sending never raises into the request that triggered it - it runs as a
    background task and failures are logged, because an HTTP response must not
    reveal whether an address exists.
"""
from __future__ import annotations

import asyncio
import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, parseaddr

from app.config import Settings

logger = logging.getLogger("teamflow.email")


@dataclass(frozen=True)
class OutgoingEmail:
    to: str
    subject: str
    text: str
    html: str | None = None


def _build_message(mail: OutgoingEmail, settings: Settings) -> EmailMessage:
    message = EmailMessage()
    name, address = parseaddr(settings.smtp_from)
    message["From"] = formataddr((name, address)) if name else address
    message["To"] = mail.to
    message["Subject"] = mail.subject
    message.set_content(mail.text)
    if mail.html:
        message.add_alternative(mail.html, subtype="html")
    return message


def _send_blocking(mail: OutgoingEmail, settings: Settings) -> None:
    message = _build_message(mail, settings)
    security = settings.smtp_security.lower()
    if security == "ssl":
        smtp: smtplib.SMTP = smtplib.SMTP_SSL(
            settings.smtp_host,
            settings.smtp_port,
            timeout=settings.smtp_timeout_seconds,
            context=ssl.create_default_context(),
        )
    else:
        smtp = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=settings.smtp_timeout_seconds)
    try:
        if security == "starttls":
            smtp.starttls(context=ssl.create_default_context())
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(message)
    finally:
        try:
            smtp.quit()
        except smtplib.SMTPException:
            pass


async def send_email(mail: OutgoingEmail, settings: Settings) -> bool:
    """Sends one message. Returns False (never raises) if it could not be sent."""
    if not settings.smtp_host:
        if settings.app_mode == "main":
            logger.error("SMTP_HOST is not configured: email to %s (%s) was NOT sent", mail.to, mail.subject)
        else:
            # Development convenience only: lets you copy a verification link
            # from the log when no Mailpit/SMTP is running.
            logger.warning("SMTP not configured; would send to %s: %s\n%s", mail.to, mail.subject, mail.text)
        return False
    try:
        await asyncio.to_thread(_send_blocking, mail, settings)
    except (OSError, smtplib.SMTPException) as exc:
        logger.error("Failed to send email to %s (%s): %s", mail.to, mail.subject, exc)
        return False
    logger.info("Email sent to %s: %s", mail.to, mail.subject)
    return True
