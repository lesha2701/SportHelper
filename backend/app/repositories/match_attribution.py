"""«Подобрать тренера», stage 3: which booking carries the raised commission of the first session, and who may see the athlete.

The right belongs to ONE booking of the pair (trainer, athlete) at a time. A booking takes it when it is created (or, if the right was
taken then, when its payment starts after the holder has gone): inside the attribution window of an accepted offer, with a price, and
when no other booking of the offer is «alive». Alive: waiting for the trainer, confirmed and not yet over, or paid (a paid booking has
used the right for good - even if it was cancelled late and nothing was returned). A booking that was declined, expired, cancelled
or fully refunded lets the right go to the next one. Nothing is written when a booking ends: the check is made when the next one asks."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

from app.core import session_time

HIDDEN_NAME = "Спортсмен из подбора"

# A booking of the offer that still holds the right. `b2` is the other booking.
_ALIVE = f"""(
    EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b2.id AND p.status IN ('paid', 'partially_refunded'))
    OR (b2.status IN ('pending', 'confirmed')
        AND b2.starts_at + make_interval(mins => b2.duration_minutes) > {session_time.sql_wall_now()}
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b2.id AND p.status = 'refunded'))
)"""


def _alive(alias: str) -> str:
    return _ALIVE.replace("b2", alias)


def hidden_sql(coach: str, athlete: str) -> str:
    """SQL (a boolean expression) for «the trainer must not see who this athlete is yet»: the pair has a booking from the matching that is
    still in play (its window is open or the booking itself is alive) and none of the pair's matching bookings has been paid. Once the
    first one is paid the identity stays open, even if the money is later returned."""
    return f"""(
        EXISTS (SELECT 1 FROM bookings hb JOIN coach_match_offers ho ON ho.id = hb.match_offer_id
                WHERE hb.coach_user_id = {coach} AND hb.athlete_user_id = {athlete}
                  AND (ho.window_ends_at > now() OR {_alive("hb")}))
        AND NOT EXISTS (SELECT 1 FROM bookings pb JOIN payments pp ON pp.booking_id = pb.id
                        WHERE pb.coach_user_id = {coach} AND pb.athlete_user_id = {athlete} AND pb.match_offer_id IS NOT NULL
                          AND pp.status IN ('paid', 'partially_refunded', 'refunded'))
    )"""


async def has_open_first_session(conn: asyncpg.Connection, coach_user_id: UUID, athlete_user_id: UUID) -> bool:
    """The athlete already has a booking with this trainer that holds the right of the first session and is not paid. Another booking
    now would be a way round the in-app payment (a plain booking, paid at the usual share, opens the chat and with it the contacts)."""
    return bool(await conn.fetchval(
        f"""SELECT EXISTS (SELECT 1 FROM bookings b2 WHERE b2.coach_user_id = $1 AND b2.athlete_user_id = $2 AND b2.match_offer_id IS NOT NULL
                          AND {_ALIVE}
                          AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b2.id AND p.status IN ('paid', 'partially_refunded')))""",
        coach_user_id, athlete_user_id,
    ))


async def athlete_hidden(conn: asyncpg.Connection, coach_user_id: UUID, athlete_user_id: UUID) -> bool:
    return bool(await conn.fetchval(f"SELECT {hidden_sql('$1::uuid', '$2::uuid')}", coach_user_id, athlete_user_id))


async def claim(conn: asyncpg.Connection, booking: dict[str, Any]) -> UUID | None:
    """Gives the booking the right of the first session if it is due; returns the offer or None. Safe to repeat; run it in a transaction
    (the offer is locked so that two bookings made together cannot both take the right)."""
    if booking.get("match_offer_id") is not None:
        return booking["match_offer_id"]
    if not booking.get("price_per_session") or booking["price_per_session"] <= 0:
        return None  # a free booking uses nothing up
    async with conn.transaction():
        offer = await conn.fetchrow(
            """
            SELECT o.id FROM coach_match_offers o JOIN coach_match_requests r ON r.id = o.request_id
            WHERE o.coach_user_id = $1 AND r.user_id = $2 AND o.status = 'athlete_accepted'
              AND o.coach_responded_at <= $3 AND o.window_ends_at > $3
            ORDER BY o.athlete_responded_at DESC LIMIT 1 FOR UPDATE OF o
            """,
            booking["coach_user_id"], booking["athlete_user_id"], booking["created_at"],
        )
        if offer is None:
            return None
        taken = await conn.fetchval(
            f"SELECT EXISTS (SELECT 1 FROM bookings b2 WHERE b2.match_offer_id = $1 AND b2.id <> $2 AND {_ALIVE})", offer["id"], booking["id"]
        )
        if taken:
            return None
        if await conn.fetchval("SELECT EXISTS (SELECT 1 FROM payments WHERE booking_id = $1)", booking["id"]):
            return None  # the amounts of a payment already made were frozen without the matching rule
        await conn.execute("UPDATE bookings SET match_offer_id = $1 WHERE id = $2 AND match_offer_id IS NULL", offer["id"], booking["id"])
    return offer["id"]


async def claim_waiting(conn: asyncpg.Connection, coach_user_id: UUID, athlete_user_id: UUID) -> None:
    """The athlete has just chosen the trainer: a booking they made in the meantime (after the trainer agreed) takes the right."""
    rows = await conn.fetch(
        """
        SELECT b.id, b.coach_user_id, b.athlete_user_id, b.price_per_session, b.created_at, b.match_offer_id
        FROM bookings b WHERE b.coach_user_id = $1 AND b.athlete_user_id = $2 AND b.match_offer_id IS NULL
          AND b.status IN ('pending', 'confirmed') ORDER BY b.created_at
        """,
        coach_user_id, athlete_user_id,
    )
    for row in rows:
        if await claim(conn, dict(row)) is not None:
            break


async def offer_percent_for_booking(conn: asyncpg.Connection, booking_id: UUID) -> Any:
    """The percent frozen in the offer behind the booking, or None for an ordinary booking."""
    return await conn.fetchval(
        "SELECT o.first_session_percent FROM bookings b JOIN coach_match_offers o ON o.id = b.match_offer_id WHERE b.id = $1", booking_id
    )
