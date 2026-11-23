"""«Подобрать тренера»: trainers' consent to be recommended, offers of a request to trainers, and their answers."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

from app.repositories import coach_reviews as coach_reviews_repo
from app.repositories import match_attribution
from app.repositories.admin_users import like_pattern
from app.repositories.coach_listings import PUBLIC_LISTING

# At most this many offers of one request can be waiting for an answer at once.
MAX_ACTIVE_PER_REQUEST = 5

# "expired" is not stored: a waiting offer whose time has run out reads as expired everywhere.
EFFECTIVE_STATUS = """
    CASE WHEN o.status = 'proposed' AND o.expires_at <= now() THEN 'expired'
         WHEN o.status = 'coach_accepted' AND o.athlete_expires_at IS NOT NULL AND o.athlete_expires_at <= now() THEN 'expired'
         ELSE o.status END
"""
_ACTIVE = """(o.status = 'proposed' AND o.expires_at > now())
             OR (o.status = 'coach_accepted' AND (o.athlete_expires_at IS NULL OR o.athlete_expires_at > now()))"""


class OfferClosed(Exception):
    """The offer is no longer waiting for this answer (answered, withdrawn, expired...)."""

    def __init__(self, status: str):
        self.status = status


class NotEligible(Exception):
    """The trainer cannot be offered this request (not opted in, blocked, already a client, ...)."""


class RequestNotOpen(Exception):
    def __init__(self, status: str):
        self.status = status


class TooManyOffers(Exception):
    pass


class AlreadyOffered(Exception):
    pass


# --- the trainer's consent -------------------------------------------------------------------------------------------


async def get_settings(conn: asyncpg.Connection, coach_user_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        "SELECT accepts_match_offers, match_terms_version, match_terms_accepted_at FROM coach_profiles WHERE user_id = $1", coach_user_id
    )
    return dict(row) if row else None


async def set_settings(conn: asyncpg.Connection, coach_user_id: UUID, *, enabled: bool, terms_version: str | None) -> None:
    """Switching on records the accepted version (and when); switching off keeps the record of the last acceptance."""
    if enabled:
        await conn.execute(
            """
            UPDATE coach_profiles SET accepts_match_offers = TRUE, match_terms_version = $2,
                   match_terms_accepted_at = CASE WHEN match_terms_version IS DISTINCT FROM $2 THEN now() ELSE match_terms_accepted_at END
            WHERE user_id = $1
            """,
            coach_user_id, terms_version,
        )
    else:
        await conn.execute("UPDATE coach_profiles SET accepts_match_offers = FALSE WHERE user_id = $1", coach_user_id)


# --- who can be offered a request ------------------------------------------------------------------------------------

# Opted in with the current terms; alive and not banned; has a published listing; not the author; no block either way;
# and not already the athlete's trainer (a booking in progress or made, or leading a team the athlete is in).
_ELIGIBLE = f"""
    FROM coach_match_requests r
    CROSS JOIN coach_profiles cp
    JOIN users u ON u.id = cp.user_id
    WHERE r.id = $1
      AND cp.accepts_match_offers AND cp.match_terms_version = $2
      AND u.deleted_at IS NULL AND NOT (u.is_banned AND (u.banned_until IS NULL OR u.banned_until > now()))
      AND u.id <> r.user_id
      AND EXISTS (SELECT 1 FROM coach_listings cl WHERE cl.coach_user_id = u.id AND {PUBLIC_LISTING} AND cl.price_per_session > 0)
      AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = r.user_id)
                                                     OR (b.blocker_id = r.user_id AND b.blocked_id = u.id))
      AND NOT EXISTS (SELECT 1 FROM bookings bk WHERE bk.coach_user_id = u.id AND bk.athlete_user_id = r.user_id
                                                   AND bk.status IN ('pending', 'confirmed'))
      AND NOT EXISTS (SELECT 1 FROM team_members tc JOIN team_members ta ON ta.team_id = tc.team_id
                      WHERE tc.user_id = u.id AND tc.role IN ('head_coach', 'assistant_coach') AND ta.user_id = r.user_id)
"""


async def is_eligible(conn: asyncpg.Connection, request_id: UUID, coach_user_id: UUID, terms_version: str) -> bool:
    return bool(await conn.fetchval(f"SELECT EXISTS (SELECT 1 {_ELIGIBLE} AND u.id = $3)", request_id, terms_version, coach_user_id))


async def candidates(conn: asyncpg.Connection, request_id: UUID, terms_version: str, *, query: str | None, limit: int = 30) -> list[dict[str, Any]]:
    """Eligible trainers for the request: the same sport first, then Pro, then by rating."""
    rows = await conn.fetch(
        f"""
        SELECT u.id AS coach_user_id, cp.full_name AS name, cp.is_pro, cp.sport, cp.specialization, cp.experience_years,
               (lower(btrim(cp.sport)) = lower(btrim(r.sport))) AS same_sport,
               EXISTS (SELECT 1 FROM coach_match_offers o WHERE o.request_id = r.id AND o.coach_user_id = u.id) AS already_offered
        {_ELIGIBLE}
          AND ($3::text IS NULL OR cp.full_name ILIKE $3 OR cp.sport ILIKE $3 OR cp.specialization ILIKE $3)
        LIMIT 200
        """,
        request_id, terms_version, like_pattern(query),
    )
    result = []
    for row in rows:
        item = dict(row)
        rating = await coach_reviews_repo.get_rating_summary(conn, item["coach_user_id"])
        item["average_rating"] = rating["average"]
        item["review_count"] = rating["count"]
        result.append(item)
    result.sort(key=lambda c: (not c["same_sport"], not c["is_pro"], -(c["average_rating"] or 0), c["name"] or ""))
    return result[:limit]


# --- offers: creating and withdrawing (administrators) ---------------------------------------------------------------


async def create_offer(
    conn: asyncpg.Connection,
    request_id: UUID,
    coach_user_id: UUID,
    admin_id: UUID,
    *,
    message: str | None,
    percent: Any,
    terms_version: str,
    coach_hours: int,
    percent_reason: str | None = None,
) -> dict[str, Any] | None:
    """None when the request does not exist. `percent_reason` is set when the percent was chosen for this offer alone. A new request is taken into work by the first offer."""
    async with conn.transaction():
        request = await conn.fetchrow("SELECT status FROM coach_match_requests WHERE id = $1 FOR UPDATE", request_id)
        if request is None:
            return None
        if request["status"] not in ("new", "in_progress"):
            raise RequestNotOpen(request["status"])
        if await conn.fetchval("SELECT EXISTS (SELECT 1 FROM coach_match_offers WHERE request_id = $1 AND coach_user_id = $2)", request_id, coach_user_id):
            raise AlreadyOffered
        if not await is_eligible(conn, request_id, coach_user_id, terms_version):
            raise NotEligible
        active = await conn.fetchval(f"SELECT count(*) FROM coach_match_offers o WHERE o.request_id = $1 AND ({_ACTIVE})", request_id)
        if active >= MAX_ACTIVE_PER_REQUEST:
            raise TooManyOffers
        row = await conn.fetchrow(
            """
            INSERT INTO coach_match_offers (request_id, coach_user_id, first_session_percent, terms_version, admin_message, created_by, expires_at,
                                            percent_overridden, percent_reason)
            VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(hours => $7), $8::text IS NOT NULL, $8::text)
            RETURNING id, request_id, coach_user_id, first_session_percent, expires_at
            """,
            request_id, coach_user_id, percent, terms_version, message, admin_id, coach_hours, percent_reason,
        )
        if request["status"] == "new":
            await conn.execute(
                "UPDATE coach_match_requests SET status = 'in_progress', handled_by = $2, updated_at = now() WHERE id = $1", request_id, admin_id
            )
    return dict(row)


async def get_offer(conn: asyncpg.Connection, offer_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"""
        SELECT o.id, o.request_id, o.coach_user_id, o.first_session_percent, o.status AS stored_status, ({EFFECTIVE_STATUS}) AS status,
               r.sport, r.user_id AS athlete_user_id
        FROM coach_match_offers o JOIN coach_match_requests r ON r.id = o.request_id WHERE o.id = $1
        """,
        offer_id,
    )
    return dict(row) if row else None


async def withdraw_offer(conn: asyncpg.Connection, offer_id: UUID) -> dict[str, Any] | None:
    """A waiting offer is taken back. None if there is none; OfferClosed if it is already over."""
    async with conn.transaction():
        offer = await get_offer(conn, offer_id)
        if offer is None:
            return None
        await conn.fetchrow("SELECT id FROM coach_match_requests WHERE id = $1 FOR UPDATE", offer["request_id"])
        offer = await get_offer(conn, offer_id)
        if offer["status"] not in ("proposed", "coach_accepted"):
            raise OfferClosed(offer["status"])
        await conn.execute("UPDATE coach_match_offers SET status = 'withdrawn', updated_at = now() WHERE id = $1", offer_id)
    return offer


async def withdraw_all_for_request(conn: asyncpg.Connection, request_id: UUID) -> None:
    """The request ended (the author withdrew it, an administrator closed it): nothing is waiting any more."""
    await conn.execute(
        "UPDATE coach_match_offers SET status = 'withdrawn', updated_at = now() WHERE request_id = $1 AND status IN ('proposed', 'coach_accepted')",
        request_id,
    )


# --- offers: the trainer's side --------------------------------------------------------------------------------------


async def list_for_coach(conn: asyncpg.Connection, coach_user_id: UUID, *, limit: int = 50) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT o.id, ({EFFECTIVE_STATUS}) AS status, o.created_at, o.expires_at, o.first_session_percent, o.admin_message,
               r.sport, r.goal, r.level, r.format, r.city, r.budget_min, r.budget_max, r.currency, r.weekdays, r.day_parts,
               r.schedule_note, r.comment
        FROM coach_match_offers o JOIN coach_match_requests r ON r.id = o.request_id
        WHERE o.coach_user_id = $1
        ORDER BY (o.status = 'proposed' AND o.expires_at > now()) DESC, o.created_at DESC, o.id
        LIMIT $2
        """,
        coach_user_id, limit,
    )
    return [dict(r) for r in rows]


async def count_waiting_for_coach(conn: asyncpg.Connection, coach_user_id: UUID) -> int:
    return await conn.fetchval(
        "SELECT count(*) FROM coach_match_offers o WHERE o.coach_user_id = $1 AND o.status = 'proposed' AND o.expires_at > now()", coach_user_id
    )


async def coach_answer(
    conn: asyncpg.Connection,
    offer_id: UUID,
    coach_user_id: UUID,
    *,
    accept: bool,
    reason: str | None,
    athlete_hours: int,
    terms_version: str,
) -> dict[str, Any] | None:
    """None if the offer is not this trainer's. OfferClosed if it no longer waits for an answer; NotEligible when accepting
    while the matching is switched off, the terms are old, or the athlete became unavailable (a block, a booking).
    Accepting takes the athlete: the other waiting offers of the request are withdrawn (the first one wins)."""
    async with conn.transaction():
        own = await conn.fetchrow("SELECT request_id, coach_user_id FROM coach_match_offers WHERE id = $1", offer_id)
        if own is None or own["coach_user_id"] != coach_user_id:
            return None
        await conn.fetchrow("SELECT id FROM coach_match_requests WHERE id = $1 FOR UPDATE", own["request_id"])
        offer = await get_offer(conn, offer_id)
        if offer["status"] != "proposed":
            raise OfferClosed(offer["status"])
        if accept:
            if not await is_eligible(conn, offer["request_id"], coach_user_id, terms_version):
                raise NotEligible
            await conn.execute(
                """
                UPDATE coach_match_offers SET status = 'coach_accepted', coach_responded_at = now(), updated_at = now(),
                       athlete_expires_at = now() + make_interval(hours => $2) WHERE id = $1
                """,
                offer_id, athlete_hours,
            )
            await conn.execute(
                """
                UPDATE coach_match_offers SET status = 'withdrawn', updated_at = now()
                WHERE request_id = $1 AND id <> $2 AND status = 'proposed'
                """,
                offer["request_id"], offer_id,
            )
        else:
            await conn.execute(
                "UPDATE coach_match_offers SET status = 'coach_declined', coach_decline_reason = $2, coach_responded_at = now(), updated_at = now() WHERE id = $1",
                offer_id, reason,
            )
    return offer


# --- offers: the athlete's side --------------------------------------------------------------------------------------


async def athlete_answer(
    conn: asyncpg.Connection, offer_id: UUID, athlete_user_id: UUID, *, accept: bool, attribution_days: int = 30
) -> dict[str, Any] | None:
    """None if the offer is not about this athlete's request. OfferClosed unless the trainer has agreed and the time is not out.
    Choosing a trainer makes the request «matched» and opens the attribution window (the athlete's bookings with this trainer follow
    the matching rules for `attribution_days`); declining leaves the request with the administrators."""
    async with conn.transaction():
        own = await conn.fetchrow(
            "SELECT o.request_id, r.user_id FROM coach_match_offers o JOIN coach_match_requests r ON r.id = o.request_id WHERE o.id = $1", offer_id
        )
        if own is None or own["user_id"] != athlete_user_id:
            return None
        request = await conn.fetchrow("SELECT status FROM coach_match_requests WHERE id = $1 FOR UPDATE", own["request_id"])
        offer = await get_offer(conn, offer_id)
        if offer["status"] != "coach_accepted" or request["status"] != "in_progress":
            raise OfferClosed(offer["status"] if offer["status"] != "coach_accepted" else request["status"])
        if accept:
            await conn.execute(
                "UPDATE coach_match_offers SET status = 'athlete_accepted', athlete_responded_at = now(), updated_at = now(), "
                "window_ends_at = now() + make_interval(days => $2) WHERE id = $1",
                offer_id, attribution_days,
            )
            await conn.execute(
                "UPDATE coach_match_offers SET status = 'withdrawn', updated_at = now() WHERE request_id = $1 AND id <> $2 AND status IN ('proposed', 'coach_accepted')",
                offer["request_id"], offer_id,
            )
            await conn.execute("UPDATE coach_match_requests SET status = 'matched', updated_at = now() WHERE id = $1", offer["request_id"])
            # A booking the athlete already made with this trainer (after the trainer agreed) takes the right of the first session now.
            await match_attribution.claim_waiting(conn, offer["coach_user_id"], athlete_user_id)
        else:
            await conn.execute(
                "UPDATE coach_match_offers SET status = 'athlete_declined', athlete_responded_at = now(), updated_at = now() WHERE id = $1", offer_id
            )
    return offer


async def accepted_for_requests(conn: asyncpg.Connection, request_ids: list[UUID]) -> dict[UUID, list[dict[str, Any]]]:
    """What the athlete sees: trainers who agreed (and the one chosen), with a card of each."""
    if not request_ids:
        return {}
    rows = await conn.fetch(
        f"""
        SELECT o.id, o.request_id, ({EFFECTIVE_STATUS}) AS status, o.athlete_expires_at AS expires_at,
               u.id AS coach_user_id, cp.full_name, cp.is_pro, u.photo_url, cp.sport, cp.specialization, cp.experience_years
        FROM coach_match_offers o
        JOIN coach_profiles cp ON cp.user_id = o.coach_user_id
        JOIN users u ON u.id = o.coach_user_id
        WHERE o.request_id = ANY($1::uuid[]) AND o.status IN ('coach_accepted', 'athlete_accepted')
        ORDER BY o.coach_responded_at, o.id
        """,
        request_ids,
    )
    result: dict[UUID, list[dict[str, Any]]] = {}
    for row in rows:
        item = dict(row)
        if item["status"] == "expired":
            continue
        rating = await coach_reviews_repo.get_rating_summary(conn, item["coach_user_id"])
        item["average_rating"] = rating["average"]
        item["review_count"] = rating["count"]
        result.setdefault(item["request_id"], []).append(item)
    return result


async def all_for_requests(conn: asyncpg.Connection, request_ids: list[UUID]) -> dict[UUID, list[dict[str, Any]]]:
    """What the administrators see: every offer of the requests, newest first."""
    if not request_ids:
        return {}
    rows = await conn.fetch(
        f"""
        SELECT o.id, o.request_id, ({EFFECTIVE_STATUS}) AS status, o.first_session_percent, o.admin_message, o.coach_decline_reason,
               o.created_at, o.expires_at, o.athlete_expires_at, o.coach_responded_at, o.athlete_responded_at,
               o.window_ends_at, o.percent_overridden, o.percent_reason,
               u.id AS coach_user_id, u.email AS coach_email, cp.full_name AS coach_name, cp.sport AS coach_sport
        FROM coach_match_offers o
        JOIN users u ON u.id = o.coach_user_id
        LEFT JOIN coach_profiles cp ON cp.user_id = o.coach_user_id
        WHERE o.request_id = ANY($1::uuid[])
        ORDER BY o.created_at DESC, o.id
        """,
        request_ids,
    )
    result: dict[UUID, list[dict[str, Any]]] = {}
    for row in rows:
        result.setdefault(row["request_id"], []).append(dict(row))
    return result
