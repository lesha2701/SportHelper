"""Administrators' view of trainings and coach listings. Trainings are read-only here (changing one would bypass the
team's own rules and the people on it); listings can be hidden, restored and - when nobody is booked - deleted."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

from app.repositories import coach_listings as listings_repo
from app.repositories.admin_users import like_pattern

_BANNED = "(cu.is_banned AND (cu.banned_until IS NULL OR cu.banned_until > now()))"


# --- trainings -------------------------------------------------------------------------------------------------------

_TRAINING_SELECT = """
    t.id, t.type, t.status, t.training_date, t.start_time, t.duration_minutes, t.location, t.description, t.created_at,
    t.team_id, tm.name AS team_name, u.id AS creator_id, u.email AS creator_email, u.first_name AS creator_first_name,
    u.last_name AS creator_last_name,
    CASE WHEN t.type = 'personal' THEN 1 + LEAST((SELECT count(*) FROM bookings b WHERE b.training_id = t.id AND b.status = 'confirmed'), 1)
         ELSE GREATEST((SELECT count(*) FROM training_attendance a WHERE a.training_id = t.id),
                       CASE WHEN t.team_id IS NULL THEN 0 ELSE (SELECT count(*) FROM team_members m WHERE m.team_id = t.team_id) END)
    END AS participants,
    (SELECT count(*) FROM bookings b WHERE b.training_id = t.id AND b.status = 'confirmed') AS bookings
"""
_TRAINING_FROM = "FROM trainings t JOIN users u ON u.id = t.created_by LEFT JOIN teams tm ON tm.id = t.team_id"


async def list_trainings(
    conn: asyncpg.Connection,
    *,
    query: str | None,
    status: str | None,
    kind: str | None,
    when: str | None,
    sort: str,
    limit: int,
    offset: int,
) -> tuple[int, list[dict[str, Any]]]:
    try:
        as_id = UUID(query.strip()) if query else None
    except ValueError:
        as_id = None
    where = """
        WHERE t.deleted_at IS NULL
          AND ($1::text IS NULL OR t.description ILIKE $1 OR t.location ILIKE $1 OR tm.name ILIKE $1
               OR u.email ILIKE $1 OR u.first_name ILIKE $1 OR u.last_name ILIKE $1
               OR (u.first_name || ' ' || COALESCE(u.last_name, '')) ILIKE $1
               OR ($2::uuid IS NOT NULL AND (t.id = $2::uuid OR t.created_by = $2::uuid OR t.team_id = $2::uuid)))
          AND ($3::text IS NULL OR t.status = $3)
          AND ($4::text IS NULL OR t.type = $4)
          AND ($5::text IS NULL OR ($5 = 'upcoming' AND t.training_date >= CURRENT_DATE) OR ($5 = 'past' AND t.training_date < CURRENT_DATE))
    """
    args = (like_pattern(query), as_id, status, kind, when)
    order = "t.training_date ASC, t.start_time ASC" if sort == "date_asc" else "t.training_date DESC, t.start_time DESC"
    total = await conn.fetchval(
        f"SELECT count(*) FROM trainings t JOIN users u ON u.id = t.created_by LEFT JOIN teams tm ON tm.id = t.team_id {where}", *args
    )
    rows = await conn.fetch(f"SELECT {_TRAINING_SELECT} {_TRAINING_FROM} {where} ORDER BY {order}, t.id LIMIT $6 OFFSET $7", *args, limit, offset)
    return total, [dict(r) for r in rows]


async def get_training(conn: asyncpg.Connection, training_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"""
        SELECT {_TRAINING_SELECT}, t.reminder_minutes_before, t.recurrence_group_id,
               (SELECT p.name FROM training_plans p WHERE p.id = t.plan_id) AS plan_name
        {_TRAINING_FROM} WHERE t.id = $1 AND t.deleted_at IS NULL
        """,
        training_id,
    )
    if row is None:
        return None
    training = dict(row)
    people = await conn.fetch(
        """
        SELECT u.id, u.first_name, u.last_name, a.status
        FROM training_attendance a JOIN users u ON u.id = a.user_id
        WHERE a.training_id = $1 ORDER BY u.first_name, u.last_name LIMIT 60
        """,
        training_id,
    )
    training["participant_list"] = [dict(p) for p in people]
    bookings = await conn.fetch(
        """
        SELECT b.id, b.status, b.starts_at, b.format,
               coach.first_name AS coach_first_name, coach.last_name AS coach_last_name,
               ath.first_name AS athlete_first_name, ath.last_name AS athlete_last_name
        FROM bookings b JOIN users coach ON coach.id = b.coach_user_id JOIN users ath ON ath.id = b.athlete_user_id
        WHERE b.training_id = $1 ORDER BY b.starts_at LIMIT 20
        """,
        training_id,
    )
    training["booking_list"] = [dict(b) for b in bookings]
    return training


# --- listings -------------------------------------------------------------------------------------------------------

_LISTING_SELECT = f"""
    cl.id, cl.title, cl.description, cl.is_listed, cl.price_per_session, cl.currency, cl.location, cl.created_at, cl.deleted_at,
    cl.moderation_hidden_at, cl.moderation_reason, hb.email AS hidden_by_email,
    cu.id AS coach_id, cu.email AS coach_email, cu.first_name AS coach_first_name, cu.last_name AS coach_last_name,
    {_BANNED} AS coach_blocked,
    (cl.photo_file_id IS NOT NULL) AS has_photo, (cl.video_file_id IS NOT NULL) AS has_video,
    (SELECT count(*) FROM bookings b WHERE b.listing_id = cl.id AND (b.status = 'pending'
        OR (b.status = 'confirmed' AND b.starts_at + (b.duration_minutes || ' minutes')::interval > now()))) AS active_bookings
"""
_LISTING_FROM = "FROM coach_listings cl JOIN users cu ON cu.id = cl.coach_user_id LEFT JOIN users hb ON hb.id = cl.moderation_hidden_by"


async def list_listings(
    conn: asyncpg.Connection, *, query: str | None, state: str | None, limit: int, offset: int
) -> tuple[int, list[dict[str, Any]]]:
    try:
        as_id = UUID(query.strip()) if query else None
    except ValueError:
        as_id = None
    where = f"""
        WHERE ($1::text IS NULL OR cl.title ILIKE $1 OR cu.email ILIKE $1 OR cu.first_name ILIKE $1 OR cu.last_name ILIKE $1
               OR (cu.first_name || ' ' || COALESCE(cu.last_name, '')) ILIKE $1
               OR ($2::uuid IS NOT NULL AND (cl.id = $2::uuid OR cl.coach_user_id = $2::uuid)))
          AND ($3::text IS NULL
               OR ($3 = 'deleted' AND cl.deleted_at IS NOT NULL)
               OR ($3 = 'hidden' AND cl.deleted_at IS NULL AND cl.moderation_hidden_at IS NOT NULL)
               OR ($3 = 'public' AND cl.deleted_at IS NULL AND cl.is_listed AND cl.moderation_hidden_at IS NULL AND NOT {_BANNED})
               OR ($3 = 'unlisted' AND cl.deleted_at IS NULL AND NOT cl.is_listed AND cl.moderation_hidden_at IS NULL))
    """
    args = (like_pattern(query), as_id, state)
    total = await conn.fetchval(f"SELECT count(*) FROM coach_listings cl JOIN users cu ON cu.id = cl.coach_user_id {where}", *args)
    rows = await conn.fetch(
        f"SELECT {_LISTING_SELECT} {_LISTING_FROM} {where} ORDER BY cl.created_at DESC, cl.id LIMIT $4 OFFSET $5", *args, limit, offset
    )
    return total, [dict(r) for r in rows]


async def get_listing(conn: asyncpg.Connection, listing_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_LISTING_SELECT} {_LISTING_FROM} WHERE cl.id = $1", listing_id)
    if row is None:
        return None
    listing = dict(row)
    listing["open_complaints"] = await conn.fetchval(
        "SELECT count(*) FROM complaints WHERE target_type = 'listing' AND target_id = $1 AND status IN ('new', 'in_progress')", listing_id
    )
    return listing


class ListingWrongState(Exception):
    pass


class HasActiveBookings(Exception):
    pass


async def set_listing_hidden(conn: asyncpg.Connection, listing_id: UUID, admin_id: UUID, hide: bool, reason: str) -> bool:
    """False if there is no such (live) listing; ListingWrongState if it already is in the requested state."""
    async with conn.transaction():
        row = await conn.fetchrow(
            "SELECT moderation_hidden_at FROM coach_listings WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", listing_id
        )
        if row is None:
            return False
        if (row["moderation_hidden_at"] is not None) == hide:
            raise ListingWrongState()
        if hide:
            await conn.execute(
                "UPDATE coach_listings SET moderation_hidden_at = now(), moderation_hidden_by = $2, moderation_reason = $3 WHERE id = $1",
                listing_id, admin_id, reason,
            )
        else:
            await conn.execute(
                "UPDATE coach_listings SET moderation_hidden_at = NULL, moderation_hidden_by = NULL, moderation_reason = NULL WHERE id = $1",
                listing_id,
            )
    return True


async def delete_listing(conn: asyncpg.Connection, listing_id: UUID) -> bool:
    """The same rule the coach's own delete follows: not while a request is pending or a confirmed session is still
    ahead - nobody who booked is silently left without their session. Soft delete, like the owner's."""
    async with conn.transaction():
        row = await conn.fetchrow("SELECT id FROM coach_listings WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", listing_id)
        if row is None:
            return False
        if await listings_repo.has_active_booking(conn, listing_id):
            raise HasActiveBookings()
        await conn.execute("UPDATE coach_listings SET deleted_at = now(), is_listed = FALSE WHERE id = $1", listing_id)
    return True
