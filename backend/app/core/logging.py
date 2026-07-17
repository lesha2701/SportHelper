"""Logging setup.

Rule: never log secrets (tokens, passwords, JWTs, initData, OAuth tokens).
Callers must not pass those values into log messages.
"""
from __future__ import annotations

import logging


def configure_logging(app_mode: str) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format=f"%(asctime)s [{app_mode}] %(levelname)s %(name)s: %(message)s",
    )
    # Silence noisy third-party loggers at DEBUG level.
    logging.getLogger("asyncpg").setLevel(logging.WARNING)
    logging.getLogger("aiogram").setLevel(logging.INFO)
