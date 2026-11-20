"""The commission percent in force: a trainer's personal one if an administrator gave him one, otherwise the general one (what an
administrator set last, otherwise the environment's PLATFORM_COMMISSION_PERCENT)."""
from __future__ import annotations

from decimal import Decimal
from uuid import UUID

import asyncpg

from app.config import Settings
from app.repositories import coach_commission as coach_commission_repo
from app.repositories import commission as commission_repo


async def current_percent(conn: asyncpg.Connection, settings: Settings) -> Decimal:
    chosen = await commission_repo.latest(conn)
    return chosen if chosen is not None else Decimal(settings.platform_commission_percent)


async def percent_for_coach(conn: asyncpg.Connection, settings: Settings, coach_user_id: UUID) -> Decimal:
    """What this trainer pays: his personal percent, or the general one."""
    personal = await coach_commission_repo.latest(conn, coach_user_id)
    return personal if personal is not None else await current_percent(conn, settings)


def percent_text(percent: Decimal) -> str:
    """«10» and «7.5», not «10.00»: the way the percent is shown and sent."""
    text = format(Decimal(percent).quantize(Decimal("0.01")), "f").rstrip("0").rstrip(".")
    return text or "0"
