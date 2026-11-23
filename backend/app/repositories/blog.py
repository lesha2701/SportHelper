"""Data access for the blog (database/patches/0059). Counters are recomputed from the rows they count, so they cannot drift."""
from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import asyncpg

from app.services import blog as svc

# Who may be shown to a reader: the author is a live, unblocked account, the reader has not blocked them (or the other way round),
# has not muted them, and has not hidden the article. $v is the viewer's id (NULL for a guest).
def _visible(viewer: str) -> str:
    return f"""
        p.status = 'published' AND p.deleted_at IS NULL AND u.deleted_at IS NULL
        AND NOT (u.is_banned AND (u.banned_until IS NULL OR u.banned_until > now()))
        AND ({viewer}::uuid IS NULL OR (
            NOT EXISTS (SELECT 1 FROM post_hides h WHERE h.user_id = {viewer}::uuid AND h.post_id = p.id)
            AND NOT EXISTS (SELECT 1 FROM post_author_mutes m WHERE m.user_id = {viewer}::uuid AND m.author_id = p.author_id)
            AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = {viewer}::uuid AND b.blocked_id = p.author_id)
                                                           OR (b.blocker_id = p.author_id AND b.blocked_id = {viewer}::uuid))))
    """


_AUTHOR = """
    u.id AS author_id,
    CASE WHEN cp.user_id IS NOT NULL THEN cp.full_name
         WHEN u.show_profile_in_posts AND pp.full_name IS NOT NULL THEN pp.full_name
         ELSE u.first_name END AS author_name,
    (cp.user_id IS NOT NULL) AS author_is_coach,
    COALESCE(cp.is_pro, FALSE) AS author_is_pro,
    (cp.user_id IS NOT NULL OR u.show_profile_in_posts) AS author_profile_open,
    CASE WHEN cp.user_id IS NOT NULL OR u.show_profile_in_posts
         THEN (SELECT hf.id FROM files hf WHERE hf.id = u.avatar_file_id AND hf.hidden_at IS NULL) END AS author_avatar_file_id
"""
_AUTHOR_FROM = """
    JOIN users u ON u.id = p.author_id
    LEFT JOIN coach_profiles cp ON cp.user_id = u.id
    LEFT JOIN player_profiles pp ON pp.user_id = u.id
"""
_COVER = """(SELECT pi.file_id FROM post_images pi JOIN files f ON f.id = pi.file_id AND f.hidden_at IS NULL
             WHERE pi.post_id = p.id ORDER BY pi.position LIMIT 1) AS cover_file_id"""
_IMAGES_COUNT = "(SELECT count(*) FROM post_images pi WHERE pi.post_id = p.id)::int AS images_count"
_CARD = f"""
    p.id, p.title, p.sport, left(p.body_text, 600) AS body_head, p.likes_count, p.comments_count, p.views_count, p.published_at,
    {_COVER}, {_IMAGES_COUNT}, {_AUTHOR}
"""


def _liked(viewer: str) -> str:
    return f"EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = {viewer}::uuid) AS liked_by_me"


def card_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"], "title": row["title"], "sport": row["sport"], "excerpt": svc.excerpt(row["body_head"]),
        "cover_file_id": row["cover_file_id"], "images_count": row["images_count"],
        "author": author_row(row),
        "likes_count": row["likes_count"], "comments_count": row["comments_count"], "views_count": row["views_count"],
        "published_at": row["published_at"], "liked_by_me": row.get("liked_by_me", False),
    }


def author_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["author_id"], "name": row["author_name"], "is_coach": row["author_is_coach"], "is_pro": row["author_is_pro"],
        "profile_open": row["author_profile_open"], "avatar_file_id": row["author_avatar_file_id"],
    }


# --- reading ----------------------------------------------------------------------------------------------------------------

async def list_feed(
    conn: asyncpg.Connection, *, viewer: UUID | None, sport: str | None, author_id: UUID | None, sort: str, limit: int, offset: int
) -> tuple[int, list[dict[str, Any]]]:
    where = f"{_visible('$1')} AND ($2::text IS NULL OR p.sport = $2) AND ($3::uuid IS NULL OR p.author_id = $3)"
    args = (viewer, sport, author_id)
    order = f"{svc.SCORE_SQL} DESC, p.published_at DESC" if sort == "popular" else "p.published_at DESC, p.id"
    total = await conn.fetchval(f"SELECT count(*) FROM posts p {_AUTHOR_FROM} WHERE {where}", *args)
    rows = await conn.fetch(
        f"SELECT {_CARD}, {_liked('$1')} FROM posts p {_AUTHOR_FROM} WHERE {where} ORDER BY {order} LIMIT $4 OFFSET $5", *args, limit, offset
    )
    return total, [card_row(dict(r)) for r in rows]


async def viewer_sport(conn: asyncpg.Connection, user_id: UUID) -> str | None:
    """The sport from the person's profile (the active mode first, then any profile)."""
    return await conn.fetchval(
        """
        SELECT COALESCE(
            CASE WHEN u.active_mode = 'coach' THEN cp.sport ELSE pp.sport END,
            pp.sport, cp.sport)
        FROM users u LEFT JOIN coach_profiles cp ON cp.user_id = u.id LEFT JOIN player_profiles pp ON pp.user_id = u.id
        WHERE u.id = $1
        """,
        user_id,
    )


async def ranked_ids(conn: asyncpg.Connection, sport: str | None, limit: int = 12) -> list[UUID]:
    """The best published articles of the last two weeks (of one sport, or of all), best first. Not tied to a viewer: it is cached for an hour."""
    rows = await conn.fetch(
        f"""
        SELECT p.id FROM posts p {_AUTHOR_FROM}
        WHERE {_visible('NULL')} AND ($1::text IS NULL OR p.sport = $1)
          AND p.published_at > now() - make_interval(days => {svc.WINDOW_DAYS})
        ORDER BY {svc.SCORE_SQL} DESC, p.published_at DESC LIMIT $2
        """,
        sport, limit,
    )
    return [r["id"] for r in rows]


async def random_ids(conn: asyncpg.Connection, limit: int = 12) -> list[UUID]:
    """Any published articles, in an order that is the same for everyone within the hour."""
    rows = await conn.fetch(
        f"""
        SELECT p.id FROM posts p {_AUTHOR_FROM} WHERE {_visible('NULL')}
        ORDER BY md5(p.id::text || to_char(now(), 'YYYYMMDDHH24')) LIMIT $1
        """,
        limit,
    )
    return [r["id"] for r in rows]


async def first_visible_card(conn: asyncpg.Connection, viewer: UUID | None, ids: list[UUID]) -> dict[str, Any] | None:
    """Of the candidate articles (in their order), the first the viewer may see now."""
    if not ids:
        return None
    rows = await conn.fetch(
        f"SELECT {_CARD}, {_liked('$1')} FROM posts p {_AUTHOR_FROM} WHERE p.id = ANY($2::uuid[]) AND {_visible('$1')}", viewer, ids
    )
    by_id = {r["id"]: dict(r) for r in rows}
    for post_id in ids:
        if post_id in by_id:
            return card_row(by_id[post_id])
    return None


_FULL = f"""
    p.id, p.title, p.sport, p.body, p.status, p.flags, p.reject_reason, p.listing_id, p.likes_count, p.comments_count, p.views_count,
    p.published_at, p.updated_at, p.submitted_at, p.author_id AS post_author_id, p.deleted_at, {_AUTHOR}
"""


async def get_post(conn: asyncpg.Connection, post_id: UUID, viewer: UUID | None) -> dict[str, Any] | None:
    """Any non-deleted article with the viewer's own marks. Who may read it is decided by the caller (the author, or everyone if published)."""
    row = await conn.fetchrow(
        f"""
        SELECT {_FULL}, {_liked('$2')},
               EXISTS (SELECT 1 FROM post_bookmarks b WHERE b.post_id = p.id AND b.user_id = $2::uuid) AS bookmarked_by_me,
               (SELECT COALESCE(array_agg(pi.file_id ORDER BY pi.position), '{{}}') FROM post_images pi WHERE pi.post_id = p.id) AS image_ids,
               ({_visible('NULL')}) AS is_public
        FROM posts p {_AUTHOR_FROM} WHERE p.id = $1 AND p.deleted_at IS NULL
        """,
        post_id, viewer,
    )
    return _decode_body(dict(row)) if row else None


def _decode_body(row: dict[str, Any]) -> dict[str, Any]:
    if isinstance(row.get("body"), str):
        row["body"] = json.loads(row["body"])
    return row


async def listing_card(conn: asyncpg.Connection, listing_id: UUID | None) -> dict[str, Any] | None:
    """The attached listing, if it is still on sale (a hidden or switched-off listing disappears from the article by itself)."""
    if listing_id is None:
        return None
    row = await conn.fetchrow(
        """
        SELECT cl.id, cl.title, cl.price_per_session::float8 AS price_per_session, cl.currency, cl.coach_user_id,
               (SELECT hf.id FROM files hf WHERE hf.id = cl.photo_file_id AND hf.hidden_at IS NULL) AS photo_file_id
        FROM coach_listings cl JOIN users u ON u.id = cl.coach_user_id
        WHERE cl.id = $1 AND cl.is_listed = TRUE AND cl.deleted_at IS NULL AND cl.moderation_hidden_at IS NULL
          AND NOT (u.is_banned AND (u.banned_until IS NULL OR u.banned_until > now()))
        """,
        listing_id,
    )
    return dict(row) if row else None


async def author_profile(conn: asyncpg.Connection, author_id: UUID, viewer: UUID | None) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"""
        SELECT {_AUTHOR},
               CASE WHEN cp.user_id IS NOT NULL THEN cp.sport WHEN u.show_profile_in_posts THEN pp.sport END AS sport,
               cp.specialization, cp.experience_years,
               (SELECT count(*) FROM posts p WHERE p.author_id = u.id AND p.status = 'published' AND p.deleted_at IS NULL)::int AS posts_count,
               EXISTS (SELECT 1 FROM post_author_mutes m WHERE m.user_id = $2::uuid AND m.author_id = u.id) AS muted_by_me
        FROM users u LEFT JOIN coach_profiles cp ON cp.user_id = u.id LEFT JOIN player_profiles pp ON pp.user_id = u.id
        WHERE u.id = $1 AND u.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM posts p WHERE p.author_id = u.id AND p.status = 'published' AND p.deleted_at IS NULL)
        """,
        author_id, viewer,
    )
    return dict(row) if row else None


async def list_mine(conn: asyncpg.Connection, user_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT p.id, p.title, p.sport, p.status, p.reject_reason, p.published_at, p.updated_at, p.likes_count, p.comments_count, p.views_count,
               {_COVER}
        FROM posts p WHERE p.author_id = $1 AND p.deleted_at IS NULL ORDER BY p.updated_at DESC
        """,
        user_id,
    )
    return [dict(r) for r in rows]


async def list_bookmarks(conn: asyncpg.Connection, viewer: UUID, limit: int, offset: int) -> tuple[int, list[dict[str, Any]]]:
    where = f"{_visible('$1')} AND EXISTS (SELECT 1 FROM post_bookmarks b WHERE b.post_id = p.id AND b.user_id = $1)"
    total = await conn.fetchval(f"SELECT count(*) FROM posts p {_AUTHOR_FROM} WHERE {where}", viewer)
    rows = await conn.fetch(
        f"""SELECT {_CARD}, {_liked('$1')} FROM posts p {_AUTHOR_FROM} WHERE {where}
            ORDER BY (SELECT b.created_at FROM post_bookmarks b WHERE b.post_id = p.id AND b.user_id = $1) DESC LIMIT $2 OFFSET $3""",
        viewer, limit, offset,
    )
    return total, [card_row(dict(r)) for r in rows]


# --- writing ----------------------------------------------------------------------------------------------------------------

class ImageNotUsable(Exception):
    pass


async def _set_images(conn: asyncpg.Connection, post_id: UUID, author_id: UUID, image_ids: list[UUID]) -> None:
    """The article's photos, in order. Each must be an image this author uploaded for an article and nothing else uses yet."""
    await conn.execute("DELETE FROM post_images WHERE post_id = $1", post_id)
    for position, file_id in enumerate(image_ids):
        usable = await conn.fetchval(
            """
            SELECT EXISTS (SELECT 1 FROM files f WHERE f.id = $1 AND f.owner_id = $2 AND f.entity_type = 'post_image' AND f.deleted_at IS NULL
                           AND NOT EXISTS (SELECT 1 FROM post_images x WHERE x.file_id = f.id))
            """,
            file_id, author_id,
        )
        if not usable:
            raise ImageNotUsable()
        await conn.execute("INSERT INTO post_images (post_id, file_id, position) VALUES ($1, $2, $3)", post_id, file_id, position)


async def create_post(
    conn: asyncpg.Connection, author_id: UUID, *, title: str, sport: str, blocks: list[dict], image_ids: list[UUID], listing_id: UUID | None,
    status: str, flags: list[str], published: bool,
) -> UUID:
    async with conn.transaction():
        post_id = await conn.fetchval(
            """
            INSERT INTO posts (author_id, title, sport, body, body_text, listing_id, status, flags, submitted_at, published_at)
            VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, CASE WHEN $7 = 'draft' THEN NULL ELSE now() END, CASE WHEN $9 THEN now() END)
            RETURNING id
            """,
            author_id, title, sport, json.dumps(blocks, ensure_ascii=False), svc.plain_text(blocks), listing_id, status, flags, published,
        )
        await _set_images(conn, post_id, author_id, image_ids)
    return post_id


async def update_post(
    conn: asyncpg.Connection, post_id: UUID, author_id: UUID, *, title: str, sport: str, blocks: list[dict], image_ids: list[UUID],
    listing_id: UUID | None, status: str, flags: list[str], published: bool,
) -> None:
    async with conn.transaction():
        await conn.execute(
            """
            UPDATE posts SET title = $2, sport = $3, body = $4::jsonb, body_text = $5, listing_id = $6, status = $7, flags = $8,
                   reject_reason = NULL,
                   submitted_at = CASE WHEN $7 = 'draft' THEN submitted_at ELSE now() END,
                   published_at = CASE WHEN $9 THEN COALESCE(published_at, now()) ELSE published_at END
            WHERE id = $1
            """,
            post_id, title, sport, json.dumps(blocks, ensure_ascii=False), svc.plain_text(blocks), listing_id, status, flags, published,
        )
        await _set_images(conn, post_id, author_id, image_ids)


async def soft_delete(conn: asyncpg.Connection, post_id: UUID) -> None:
    await conn.execute("UPDATE posts SET deleted_at = now() WHERE id = $1", post_id)


async def _recount(conn: asyncpg.Connection, post_id: UUID) -> None:
    await conn.execute(
        """
        UPDATE posts SET
            likes_count = (SELECT count(*) FROM post_likes WHERE post_id = $1),
            comments_count = (SELECT count(*) FROM post_comments WHERE post_id = $1 AND deleted_at IS NULL AND hidden_at IS NULL)
        WHERE id = $1
        """,
        post_id,
    )


async def set_like(conn: asyncpg.Connection, post_id: UUID, user_id: UUID, liked: bool) -> int:
    async with conn.transaction():
        if liked:
            await conn.execute("INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", post_id, user_id)
        else:
            await conn.execute("DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2", post_id, user_id)
        await _recount(conn, post_id)
    return await conn.fetchval("SELECT likes_count FROM posts WHERE id = $1", post_id)


async def set_bookmark(conn: asyncpg.Connection, post_id: UUID, user_id: UUID, saved: bool) -> None:
    if saved:
        await conn.execute("INSERT INTO post_bookmarks (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", post_id, user_id)
    else:
        await conn.execute("DELETE FROM post_bookmarks WHERE post_id = $1 AND user_id = $2", post_id, user_id)


async def set_hidden(conn: asyncpg.Connection, post_id: UUID, user_id: UUID, hidden: bool) -> None:
    if hidden:
        await conn.execute("INSERT INTO post_hides (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", user_id, post_id)
    else:
        await conn.execute("DELETE FROM post_hides WHERE user_id = $1 AND post_id = $2", user_id, post_id)


async def set_author_muted(conn: asyncpg.Connection, user_id: UUID, author_id: UUID, muted: bool) -> None:
    if muted:
        await conn.execute("INSERT INTO post_author_mutes (user_id, author_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", user_id, author_id)
    else:
        await conn.execute("DELETE FROM post_author_mutes WHERE user_id = $1 AND author_id = $2", user_id, author_id)


async def count_view(conn: asyncpg.Connection, post_id: UUID, user_id: UUID) -> bool:
    """One view per person per day, never the author's own. True if it was counted."""
    async with conn.transaction():
        inserted = await conn.fetchval(
            """
            INSERT INTO post_views (post_id, user_id, day)
            SELECT p.id, $2::uuid, CURRENT_DATE FROM posts p WHERE p.id = $1 AND p.author_id <> $2::uuid AND p.status = 'published'
            ON CONFLICT DO NOTHING RETURNING 1
            """,
            post_id, user_id,
        )
        if inserted:
            await conn.execute("UPDATE posts SET views_count = views_count + 1 WHERE id = $1", post_id)
    return bool(inserted)


# --- comments ---------------------------------------------------------------------------------------------------------------

async def list_comments(conn: asyncpg.Connection, post_id: UUID, viewer: UUID | None, limit: int = 200) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT c.id, c.post_id, c.body, c.contact_hidden, c.created_at, c.author_id AS comment_author_id,
               (c.author_id = $2::uuid) AS is_mine, {_AUTHOR}
        FROM post_comments c
        JOIN users u ON u.id = c.author_id
        LEFT JOIN coach_profiles cp ON cp.user_id = u.id
        LEFT JOIN player_profiles pp ON pp.user_id = u.id
        WHERE c.post_id = $1 AND c.deleted_at IS NULL AND c.hidden_at IS NULL AND u.deleted_at IS NULL
          AND ($2::uuid IS NULL OR NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = $2::uuid AND b.blocked_id = c.author_id)
                                                                              OR (b.blocker_id = c.author_id AND b.blocked_id = $2::uuid)))
        ORDER BY c.created_at LIMIT $3
        """,
        post_id, viewer, limit,
    )
    return [dict(r) for r in rows]


async def add_comment(conn: asyncpg.Connection, post_id: UUID, author_id: UUID, body: str, contact_hidden: bool) -> UUID:
    async with conn.transaction():
        comment_id = await conn.fetchval(
            "INSERT INTO post_comments (post_id, author_id, body, contact_hidden) VALUES ($1, $2, $3, $4) RETURNING id",
            post_id, author_id, body, contact_hidden,
        )
        await _recount(conn, post_id)
    return comment_id


async def get_comment(conn: asyncpg.Connection, comment_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow("SELECT id, post_id, author_id, deleted_at, hidden_at FROM post_comments WHERE id = $1", comment_id)
    return dict(row) if row else None


async def delete_comment(conn: asyncpg.Connection, comment_id: UUID, post_id: UUID) -> None:
    async with conn.transaction():
        await conn.execute("UPDATE post_comments SET deleted_at = now() WHERE id = $1", comment_id)
        await _recount(conn, post_id)


async def recent_comments_by(conn: asyncpg.Connection, user_id: UUID, minutes: int) -> int:
    return await conn.fetchval(
        "SELECT count(*) FROM post_comments WHERE author_id = $1 AND created_at > now() - make_interval(mins => $2)", user_id, minutes
    )


# --- settings ---------------------------------------------------------------------------------------------------------------

async def get_settings(conn: asyncpg.Connection, user_id: UUID) -> dict[str, Any]:
    row = await conn.fetchrow(
        "SELECT u.show_profile_in_posts, EXISTS (SELECT 1 FROM coach_profiles c WHERE c.user_id = u.id) AS is_coach FROM users u WHERE u.id = $1", user_id
    )
    return dict(row)


async def set_show_profile(conn: asyncpg.Connection, user_id: UUID, value: bool) -> None:
    await conn.execute("UPDATE users SET show_profile_in_posts = $2 WHERE id = $1", user_id, value)


async def is_trusted(conn: asyncpg.Connection, user_id: UUID) -> bool:
    return bool(await conn.fetchval("SELECT posts_trusted_at IS NOT NULL FROM users WHERE id = $1", user_id))


async def is_coach(conn: asyncpg.Connection, user_id: UUID) -> bool:
    return bool(await conn.fetchval("SELECT EXISTS (SELECT 1 FROM coach_profiles WHERE user_id = $1)", user_id))


async def own_public_listing(conn: asyncpg.Connection, listing_id: UUID, coach_user_id: UUID) -> bool:
    return bool(
        await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM coach_listings WHERE id = $1 AND coach_user_id = $2 AND deleted_at IS NULL)", listing_id, coach_user_id
        )
    )


# --- the administrators' side -----------------------------------------------------------------------------------------------

_ADMIN = """
    p.id, p.title, p.sport, p.status, p.flags, p.reject_reason, p.submitted_at, p.published_at, p.likes_count, p.comments_count,
    p.author_id, COALESCE(cp.full_name, pp.full_name, u.first_name) AS author_name, u.email AS author_email,
    (u.posts_trusted_at IS NOT NULL) AS author_trusted, rb.email AS reviewed_by,
    (SELECT count(*) FROM complaints c WHERE c.target_type = 'post' AND c.target_id = p.id AND c.status IN ('new', 'in_progress'))::int AS open_complaints
"""
_ADMIN_FROM = """
    FROM posts p JOIN users u ON u.id = p.author_id
    LEFT JOIN coach_profiles cp ON cp.user_id = u.id LEFT JOIN player_profiles pp ON pp.user_id = u.id
    LEFT JOIN users rb ON rb.id = p.reviewed_by
"""


async def admin_list(
    conn: asyncpg.Connection, *, status: str | None, query: str | None, with_complaints: bool, limit: int, offset: int
) -> tuple[int, list[dict[str, Any]]]:
    pattern = f"%{query.strip()}%" if query and query.strip() else None
    where = """
        WHERE p.deleted_at IS NULL AND p.status <> 'draft' AND ($1::text IS NULL OR p.status = $1)
          AND ($2::text IS NULL OR p.title ILIKE $2 OR u.email ILIKE $2 OR p.body_text ILIKE $2)
          AND (NOT $3 OR EXISTS (SELECT 1 FROM complaints c WHERE c.target_type = 'post' AND c.target_id = p.id AND c.status IN ('new', 'in_progress')))
    """
    total = await conn.fetchval(f"SELECT count(*) {_ADMIN_FROM} {where}", status, pattern, with_complaints)
    rows = await conn.fetch(
        f"SELECT {_ADMIN} {_ADMIN_FROM} {where} ORDER BY (p.status = 'pending') DESC, COALESCE(p.submitted_at, p.created_at) {'ASC' if status == 'pending' else 'DESC'} LIMIT $4 OFFSET $5",
        status, pattern, with_complaints, limit, offset,
    )
    return total, [dict(r) for r in rows]


async def admin_get(conn: asyncpg.Connection, post_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"""SELECT {_ADMIN}, p.body, p.listing_id,
                   (SELECT COALESCE(array_agg(pi.file_id ORDER BY pi.position), '{{}}') FROM post_images pi WHERE pi.post_id = p.id) AS image_ids
            {_ADMIN_FROM} WHERE p.id = $1 AND p.deleted_at IS NULL""",
        post_id,
    )
    return _decode_body(dict(row)) if row else None


async def pending_count(conn: asyncpg.Connection) -> int:
    return await conn.fetchval("SELECT count(*) FROM posts WHERE status = 'pending' AND deleted_at IS NULL")


async def review(conn: asyncpg.Connection, post_id: UUID, admin_id: UUID, *, status: str, reason: str | None) -> dict[str, Any] | None:
    """Moves an article to published / rejected / removed, only from a state where that makes sense. Returns the row before the change."""
    allowed = {"published": ("pending", "rejected", "removed"), "rejected": ("pending",), "removed": ("published", "pending")}
    async with conn.transaction():
        row = await conn.fetchrow("SELECT id, author_id, title, status FROM posts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", post_id)
        if row is None:
            return None
        if row["status"] not in allowed[status]:
            raise BadTransition(row["status"])
        await conn.execute(
            """
            UPDATE posts SET status = $2, reject_reason = $3, reviewed_by = $4, reviewed_at = now(),
                   published_at = CASE WHEN $2 = 'published' THEN COALESCE(published_at, now()) ELSE published_at END
            WHERE id = $1
            """,
            post_id, status, reason, admin_id,
        )
    return dict(row)


class BadTransition(Exception):
    def __init__(self, current: str):
        self.current = current


async def hide_comment(conn: asyncpg.Connection, comment_id: UUID, admin_id: UUID, reason: str) -> dict[str, Any] | None:
    async with conn.transaction():
        row = await conn.fetchrow("SELECT id, post_id, author_id, hidden_at FROM post_comments WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", comment_id)
        if row is None:
            return None
        await conn.execute(
            "UPDATE post_comments SET hidden_at = now(), hidden_by = $2, hidden_reason = $3 WHERE id = $1 AND hidden_at IS NULL", comment_id, admin_id, reason
        )
        await _recount(conn, row["post_id"])
    return dict(row)


async def set_trusted(conn: asyncpg.Connection, user_id: UUID, admin_id: UUID, trusted: bool) -> bool:
    status = await conn.execute(
        "UPDATE users SET posts_trusted_at = CASE WHEN $3 THEN now() END, posts_trusted_by = CASE WHEN $3 THEN $2::uuid END WHERE id = $1 AND deleted_at IS NULL",
        user_id, admin_id, trusted,
    )
    return status.endswith("1")


async def author_summary(conn: asyncpg.Connection, user_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        """
        SELECT u.id, u.email, COALESCE(cp.full_name, pp.full_name, u.first_name) AS name, (u.posts_trusted_at IS NOT NULL) AS trusted,
               (SELECT count(*) FROM posts p WHERE p.author_id = u.id AND p.status = 'published' AND p.deleted_at IS NULL)::int AS published,
               (SELECT count(*) FROM posts p WHERE p.author_id = u.id AND p.status IN ('rejected', 'removed') AND p.deleted_at IS NULL)::int AS refused
        FROM users u LEFT JOIN coach_profiles cp ON cp.user_id = u.id LEFT JOIN player_profiles pp ON pp.user_id = u.id
        WHERE u.id = $1 AND u.deleted_at IS NULL
        """,
        user_id,
    )
    return dict(row) if row else None
