"""Blog: reading is open to everyone (guests included); writing, liking, commenting and saving need a signed-in person.

An article is checked automatically when it is sent, then by an administrator (unless the author is trusted); until then only its author sees it."""
from __future__ import annotations

import logging
from uuid import UUID, uuid4

import asyncpg
from fastapi import APIRouter, Depends, Query, Request, UploadFile

from app.api.deps import get_current_user, get_db, get_optional_user, get_settings_dep
from app.config import Settings
from app.core.exceptions import APIError, ConflictError, ForbiddenError, NotFoundError
from app.integrations.paths import build_user_file_path
from app.repositories import blog as repo
from app.repositories import files as files_repo
from app.schemas.blog import (
    AuthorProfileOut, BlogSettingsIn, BlogSettingsOut, CommentIn, CommentOut, FeedSort, ImageOut, LikeOut, ListingCardOut, MyPostOut, PostCardOut, PostIn,
    PostOut, PostPageOut,
)
from app.services import accounts as accounts_svc
from app.services import blog as svc
from app.services import notifications as notifications_service
from app.services.contact_filter import mask_contacts
from app.services.uploads import IMAGE_MIME_EXTENSIONS, discard_stored_image, safe_filename, store_image_or_raise

logger = logging.getLogger("teamflow.blog")

router = APIRouter(prefix="/api/blog", tags=["blog"])

_POSTS_PER_DAY = 10
_COMMENTS_PER_HOUR = 20
_UPLOADS_PER_HOUR = 30


# --- helpers ----------------------------------------------------------------------------------------------------------------

def _sport_or_none(sport: str | None) -> str | None:
    if sport is None:
        return None
    if sport not in svc.SPORTS:
        raise APIError("Неизвестный вид спорта.", code="unknown_sport", status_code=422)
    return sport


async def _post_out(conn: asyncpg.Connection, row: dict, viewer: dict | None, *, sent_for_review: bool = False) -> PostOut:
    mine = viewer is not None and row["post_author_id"] == viewer["id"]
    blocks = row["body"]
    image_ids = list(row["image_ids"])
    card = repo.card_row({**row, "body_head": svc.plain_text(blocks), "cover_file_id": image_ids[0] if image_ids else None, "images_count": len(image_ids)})
    listing = await repo.listing_card(conn, row["listing_id"])
    return PostOut(
        **card,
        status=row["status"],
        blocks=blocks,
        image_ids=image_ids,
        listing=ListingCardOut(**listing) if listing else None,
        bookmarked_by_me=row["bookmarked_by_me"],
        is_mine=mine,
        reject_reason=row["reject_reason"] if mine else None,
        flags=list(row["flags"]) if mine else [],
        updated_at=row["updated_at"],
        sent_for_review=sent_for_review,
    )


async def _readable_post(conn: asyncpg.Connection, post_id: UUID, viewer: dict | None) -> dict:
    row = await repo.get_post(conn, post_id, viewer["id"] if viewer else None)
    if row is None:
        raise NotFoundError("Статья не найдена.", code="post_not_found")
    mine = viewer is not None and row["post_author_id"] == viewer["id"]
    if not (mine or row["is_public"]):
        raise NotFoundError("Статья не найдена.", code="post_not_found")
    return row


async def _published_post(conn: asyncpg.Connection, post_id: UUID) -> dict:
    row = await repo.get_post(conn, post_id, None)
    if row is None or not row["is_public"]:
        raise NotFoundError("Статья не найдена.", code="post_not_found")
    return row


# --- the feed ---------------------------------------------------------------------------------------------------------------

@router.get("/posts", response_model=PostPageOut)
async def feed(
    sport: str | None = Query(default=None, max_length=60),
    author_id: UUID | None = None,
    sort: FeedSort = "new",
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0, le=10_000),
    user: dict | None = Depends(get_optional_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> PostPageOut:
    total, items = await repo.list_feed(
        conn, viewer=user["id"] if user else None, sport=_sport_or_none(sport), author_id=author_id, sort=sort, limit=limit, offset=offset
    )
    return PostPageOut(total=total, limit=limit, offset=offset, items=[PostCardOut(**i) for i in items])


@router.get("/sports", response_model=list[str])
async def sports() -> list[str]:
    return list(svc.SPORTS)


@router.get("/featured", response_model=PostCardOut | None)
async def featured(user: dict | None = Depends(get_optional_user), conn: asyncpg.Connection = Depends(get_db)) -> PostCardOut | None:
    """The one article for the home page: the best of the person's sport, else the best of any sport, else any. Re-ranked once an hour."""
    viewer = user["id"] if user else None
    sport = await repo.viewer_sport(conn, viewer) if viewer else None
    candidates = [(f"sport:{sport}", sport)] if sport else []
    candidates += [("all", None), ("random", "random")]
    for key, scope in candidates:
        ids = svc.cached_pick(key)
        if ids is None:
            ids = await (repo.random_ids(conn) if scope == "random" else repo.ranked_ids(conn, scope))
            svc.remember_pick(key, ids)
        card = await repo.first_visible_card(conn, viewer, ids)
        if card:
            return PostCardOut(**card)
    return None


@router.get("/mine", response_model=list[MyPostOut])
async def my_posts(user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> list[MyPostOut]:
    return [MyPostOut(**r) for r in await repo.list_mine(conn, user["id"])]


@router.get("/bookmarks", response_model=PostPageOut)
async def bookmarks(
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0, le=10_000),
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> PostPageOut:
    total, items = await repo.list_bookmarks(conn, user["id"], limit, offset)
    return PostPageOut(total=total, limit=limit, offset=offset, items=[PostCardOut(**i) for i in items])


# --- settings and the author's card -----------------------------------------------------------------------------------------

@router.get("/settings", response_model=BlogSettingsOut)
async def get_settings(user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> BlogSettingsOut:
    return BlogSettingsOut(**await repo.get_settings(conn, user["id"]))


@router.put("/settings", response_model=BlogSettingsOut)
async def put_settings(payload: BlogSettingsIn, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> BlogSettingsOut:
    await repo.set_show_profile(conn, user["id"], payload.show_profile_in_posts)
    return BlogSettingsOut(**await repo.get_settings(conn, user["id"]))


@router.get("/authors/{author_id}", response_model=AuthorProfileOut)
async def author(author_id: UUID, user: dict | None = Depends(get_optional_user), conn: asyncpg.Connection = Depends(get_db)) -> AuthorProfileOut:
    row = await repo.author_profile(conn, author_id, user["id"] if user else None)
    if row is None:
        raise NotFoundError("Автор не найден.", code="author_not_found")
    return AuthorProfileOut(
        **repo.author_row(row),
        sport=row["sport"], specialization=row["specialization"] if row["author_is_coach"] else None,
        experience_years=row["experience_years"] if row["author_is_coach"] else None,
        posts_count=row["posts_count"], muted_by_me=row["muted_by_me"],
    )


@router.put("/authors/{author_id}/mute", status_code=204, response_model=None)
async def mute_author(author_id: UUID, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> None:
    if author_id == user["id"]:
        raise APIError("Нельзя скрыть самого себя.", code="cannot_mute_self", status_code=400)
    await repo.set_author_muted(conn, user["id"], author_id, True)


@router.delete("/authors/{author_id}/mute", status_code=204, response_model=None)
async def unmute_author(author_id: UUID, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> None:
    await repo.set_author_muted(conn, user["id"], author_id, False)


# --- photos -----------------------------------------------------------------------------------------------------------------

@router.post("/images", response_model=ImageOut, status_code=201)
async def upload_image(
    file: UploadFile,
    request: Request,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> ImageOut:
    """A photo for an article. It belongs to no article until the article names it in `image_ids`."""
    await accounts_svc.enforce_rate_limit(request, conn, settings, "blog_image", str(user["id"]), limit=_UPLOADS_PER_HOUR, window_seconds=3600)
    if file.content_type not in IMAGE_MIME_EXTENSIONS:
        raise APIError("Фото должно быть изображением (jpeg, png, webp).", code="unsupported_media_type", status_code=415)
    file_id = uuid4()
    stored = await store_image_or_raise(
        settings, file, "gallery_photo",
        lambda extension: build_user_file_path(settings.yandex_disk_root_folder, settings.app_mode, user["id"], "blog", file_id, extension),
    )
    try:
        record = await files_repo.create_file(
            conn, owner_id=user["id"], team_id=None, entity_type="post_image", entity_id=None, disk_path=stored.disk_path,
            filename=safe_filename(file.filename, stored.extension, "photo"), mime_type=stored.mime_type, size_bytes=stored.size_bytes,
            # PUBLIC: an article is read by guests too. The id cannot be guessed, and a removed article's photos are hidden by moderation.
            access_level="PUBLIC", thumb_disk_path=stored.thumb_disk_path,
        )
    except Exception:
        await discard_stored_image(settings, stored)
        raise
    return ImageOut(file_id=record["id"])


# --- writing articles -------------------------------------------------------------------------------------------------------

async def _save(
    conn: asyncpg.Connection, user: dict, payload: PostIn, *, existing: dict | None, post_id: UUID | None
) -> tuple[UUID, bool]:
    """Validates and stores an article. Returns its id and whether this save sent a published article back to the administrators."""
    blocks = svc.normalize_blocks([b.model_dump(exclude_none=True) for b in payload.blocks])
    was_live = existing is not None and existing["status"] in ("published", "pending")
    submit = payload.submit or was_live  # a published or waiting article cannot go back to a draft: every edit is a submission
    if payload.listing_id is not None:
        if not await repo.is_coach(conn, user["id"]):
            raise APIError("Карточку объявления может прикрепить только тренер.", code="listing_not_allowed", status_code=422)
        if not await repo.own_public_listing(conn, payload.listing_id, user["id"]):
            raise APIError("Можно прикрепить только своё объявление.", code="listing_not_allowed", status_code=422)
    title = payload.title
    if submit:
        try:
            flags = svc.check_article(title=title, sport=payload.sport, blocks=blocks, image_count=len(payload.image_ids)).flags
        except svc.ArticleProblem as exc:
            raise APIError(" ".join(exc.problems), code=exc.code, status_code=422) from None
    else:
        if len(title) < svc.TITLE_MIN or payload.sport not in svc.SPORTS:
            raise APIError("Укажите заголовок (от 3 знаков) и вид спорта.", code="article_rejected", status_code=422)
        flags = []
    trusted = submit and await repo.is_trusted(conn, user["id"])
    status = "draft" if not submit else ("published" if trusted else "pending")
    fields = dict(
        title=title, sport=payload.sport, blocks=blocks, image_ids=payload.image_ids, listing_id=payload.listing_id,
        status=status, flags=flags, published=status == "published",
    )
    try:
        if post_id is None:
            post_id = await repo.create_post(conn, user["id"], **fields)
        else:
            await repo.update_post(conn, post_id, user["id"], **fields)
    except repo.ImageNotUsable:
        raise APIError("Одно из фото не найдено или уже занято. Загрузите его заново.", code="image_not_usable", status_code=422) from None
    if status == "published":
        svc.forget_picks()
    return post_id, was_live and status == "pending"


@router.post("/posts", response_model=PostOut, status_code=201)
async def create_post(
    payload: PostIn,
    request: Request,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> PostOut:
    if payload.submit:
        await accounts_svc.enforce_rate_limit(request, conn, settings, "blog_post", str(user["id"]), limit=_POSTS_PER_DAY, window_seconds=86400)
    post_id, _ = await _save(conn, user, payload, existing=None, post_id=None)
    return await _post_out(conn, await repo.get_post(conn, post_id, user["id"]), user)


@router.put("/posts/{post_id}", response_model=PostOut)
async def update_post(
    post_id: UUID,
    payload: PostIn,
    request: Request,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> PostOut:
    row = await repo.get_post(conn, post_id, user["id"])
    if row is None or row["post_author_id"] != user["id"]:
        raise NotFoundError("Статья не найдена.", code="post_not_found")
    if row["status"] == "removed":
        raise ConflictError("Администратор снял эту статью, её нельзя изменить.", code="post_removed")
    if payload.submit or row["status"] in ("published", "pending"):
        await accounts_svc.enforce_rate_limit(request, conn, settings, "blog_post", str(user["id"]), limit=_POSTS_PER_DAY * 3, window_seconds=86400)
    _, sent_for_review = await _save(conn, user, payload, existing=row, post_id=post_id)
    return await _post_out(conn, await repo.get_post(conn, post_id, user["id"]), user, sent_for_review=sent_for_review)


@router.post("/posts/{post_id}/submit", response_model=PostOut)
async def submit_draft(
    post_id: UUID,
    request: Request,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> PostOut:
    await accounts_svc.enforce_rate_limit(request, conn, settings, "blog_post", str(user["id"]), limit=_POSTS_PER_DAY * 3, window_seconds=86400)
    async with conn.transaction():
        owned = await conn.fetchval(
            "SELECT id FROM posts WHERE id = $1 AND author_id = $2 AND deleted_at IS NULL FOR UPDATE",
            post_id, user["id"],
        )
        if owned is None:
            raise NotFoundError("Статья не найдена.", code="post_not_found")
        row = await repo.get_post(conn, post_id, user["id"])
        if row["status"] not in ("draft", "pending", "published"):
            raise ConflictError("Этот черновик больше нельзя отправить. Обновите страницу.", code="post_not_draft")
        if row["status"] == "draft":
            payload = PostIn(
                title=row["title"], sport=row["sport"], blocks=row["body"],
                image_ids=row["image_ids"], listing_id=row["listing_id"], submit=True,
            )
            await _save(conn, user, payload, existing=row, post_id=post_id)
            row = await repo.get_post(conn, post_id, user["id"])
        return await _post_out(conn, row, user)


@router.delete("/posts/{post_id}", status_code=204, response_model=None)
async def delete_post(post_id: UUID, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> None:
    row = await repo.get_post(conn, post_id, user["id"])
    if row is None or row["post_author_id"] != user["id"]:
        raise NotFoundError("Статья не найдена.", code="post_not_found")
    await repo.soft_delete(conn, post_id)
    svc.forget_picks()


# --- reading one article ----------------------------------------------------------------------------------------------------

@router.get("/posts/{post_id}", response_model=PostOut)
async def read_post(post_id: UUID, user: dict | None = Depends(get_optional_user), conn: asyncpg.Connection = Depends(get_db)) -> PostOut:
    return await _post_out(conn, await _readable_post(conn, post_id, user), user)


@router.post("/posts/{post_id}/view", status_code=204, response_model=None)
async def view_post(post_id: UUID, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> None:
    """Counted once per person per day; the author's own views and guests' do not count."""
    await _published_post(conn, post_id)
    await repo.count_view(conn, post_id, user["id"])


@router.put("/posts/{post_id}/like", response_model=LikeOut)
async def like(post_id: UUID, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> LikeOut:
    await _published_post(conn, post_id)
    return LikeOut(liked=True, likes_count=await repo.set_like(conn, post_id, user["id"], True))


@router.delete("/posts/{post_id}/like", response_model=LikeOut)
async def unlike(post_id: UUID, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> LikeOut:
    await _published_post(conn, post_id)
    return LikeOut(liked=False, likes_count=await repo.set_like(conn, post_id, user["id"], False))


@router.put("/posts/{post_id}/bookmark", status_code=204, response_model=None)
async def bookmark(post_id: UUID, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> None:
    await _published_post(conn, post_id)
    await repo.set_bookmark(conn, post_id, user["id"], True)


@router.delete("/posts/{post_id}/bookmark", status_code=204, response_model=None)
async def unbookmark(post_id: UUID, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> None:
    await repo.set_bookmark(conn, post_id, user["id"], False)


@router.put("/posts/{post_id}/hide", status_code=204, response_model=None)
async def hide(post_id: UUID, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> None:
    await _published_post(conn, post_id)
    await repo.set_hidden(conn, post_id, user["id"], True)


@router.delete("/posts/{post_id}/hide", status_code=204, response_model=None)
async def unhide(post_id: UUID, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> None:
    await repo.set_hidden(conn, post_id, user["id"], False)


# --- comments ---------------------------------------------------------------------------------------------------------------

def _comment_out(row: dict) -> CommentOut:
    return CommentOut(
        id=row["id"], post_id=row["post_id"], author=repo.author_row(row), body=row["body"], contact_hidden=row["contact_hidden"],
        created_at=row["created_at"], is_mine=bool(row["is_mine"]),
    )


@router.get("/posts/{post_id}/comments", response_model=list[CommentOut])
async def comments(post_id: UUID, user: dict | None = Depends(get_optional_user), conn: asyncpg.Connection = Depends(get_db)) -> list[CommentOut]:
    await _readable_post(conn, post_id, user)
    return [_comment_out(r) for r in await repo.list_comments(conn, post_id, user["id"] if user else None)]


@router.post("/posts/{post_id}/comments", response_model=CommentOut, status_code=201)
async def add_comment(
    post_id: UUID,
    payload: CommentIn,
    request: Request,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> CommentOut:
    post = await _published_post(conn, post_id)
    await accounts_svc.enforce_rate_limit(request, conn, settings, "blog_comment", str(user["id"]), limit=_COMMENTS_PER_HOUR, window_seconds=3600)
    body = mask_contacts(payload.body) or payload.body
    comment_id = await repo.add_comment(conn, post_id, user["id"], body, contact_hidden=body != payload.body)
    if post["post_author_id"] != user["id"]:
        name = user.get("first_name") or "Читатель"
        await notifications_service.schedule_post_comment_notification(conn, {"id": post_id, "author_id": post["post_author_id"], "title": post["title"]}, name)
    row = next(r for r in await repo.list_comments(conn, post_id, user["id"]) if r["id"] == comment_id)
    return _comment_out(row)


@router.delete("/comments/{comment_id}", status_code=204, response_model=None)
async def delete_comment(comment_id: UUID, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> None:
    """The commenter deletes their own comment; the article's author deletes any comment under their article."""
    comment = await repo.get_comment(conn, comment_id)
    if comment is None or comment["deleted_at"] is not None:
        raise NotFoundError("Комментарий не найден.", code="comment_not_found")
    post = await repo.get_post(conn, comment["post_id"], user["id"])
    if comment["author_id"] != user["id"] and not (post and post["post_author_id"] == user["id"]):
        raise ForbiddenError("Удалить можно свой комментарий или комментарий под своей статьёй.")
    await repo.delete_comment(conn, comment_id, comment["post_id"])
