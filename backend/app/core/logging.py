"""Logging setup.

Rule: never log secrets (session tokens, one-time link tokens, passwords, CSRF
tokens). Callers must not pass those values into log messages - and as a safety
net every handler also runs records through `redact`, so a token that slips
into a message (a URL, an exception text, a header dump) is masked before it
reaches stdout, a log file or the `error_log` table.
"""
from __future__ import annotations

import logging
import re

_REDACTIONS = (
    # Authorization: Bearer <session token>
    (re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]{12,}"), r"\1[redacted]"),
    # the session cookie, in a Cookie / Set-Cookie dump
    (re.compile(r"(?i)((?:__Host-)?sag_session=)[^;\s\"']+"), r"\1[redacted]"),
    # one-time links: ?token=..., &token=..., "token": "..."
    (re.compile(r"(?i)([?&]token=)[^&\s\"']+"), r"\1[redacted]"),
    (re.compile(r"(?i)(\"?(?:token|csrf_token|password|password_confirm|current_password|new_password)\"?\s*[:=]\s*\"?)[^\"\s,}&]{6,}"), r"\1[redacted]"),
    (re.compile(r"(?i)(x-csrf-token[\"':=\s]+)[A-Za-z0-9]{16,}"), r"\1[redacted]"),
)


def redact(text: str) -> str:
    for pattern, replacement in _REDACTIONS:
        text = pattern.sub(replacement, text)
    return text


class RedactingFilter(logging.Filter):
    """Masks secrets in a record's final message. Records flagged `devmail`
    (the development-only printout of an email that has no SMTP server to go
    to, where the link IS the point) are left alone - they are never produced
    when APP_MODE=main."""

    def filter(self, record: logging.LogRecord) -> bool:
        if getattr(record, "devmail", False):
            return True
        try:
            message = record.getMessage()
        except Exception:  # noqa: BLE001 - a bad format string must not break logging
            return True
        redacted = redact(message)
        if redacted != message:
            record.msg = redacted
            record.args = ()
        return True


def configure_logging(app_mode: str) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format=f"%(asctime)s [{app_mode}] %(levelname)s %(name)s: %(message)s",
    )
    # Silence noisy third-party loggers at DEBUG level.
    logging.getLogger("asyncpg").setLevel(logging.WARNING)
    logging.getLogger("aiogram").setLevel(logging.INFO)
    install_redaction()


def install_redaction() -> None:
    """Attach the filter to every handler of the root logger and of uvicorn's
    own loggers (they have separate handlers, including the access log)."""
    for name in ("", "uvicorn", "uvicorn.access", "uvicorn.error"):
        for handler in logging.getLogger(name).handlers:
            if not any(isinstance(f, RedactingFilter) for f in handler.filters):
                handler.addFilter(RedactingFilter())
