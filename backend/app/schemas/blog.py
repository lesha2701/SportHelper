"""Blog: articles, comments, authors' cards, and what the administrators see."""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.services import blog as svc

PostStatus = Literal["draft", "pending", "published", "rejected", "removed"]
FeedSort = Literal["new", "popular"]
BlockType = Literal["paragraph", "heading", "quote", "list"]


class BlockIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: BlockType
    text: str | None = Field(default=None, max_length=5000)
    items: list[str] | None = Field(default=None, max_length=svc.MAX_LIST_ITEMS)


class BlockOut(BaseModel):
    type: BlockType
    text: str | None = None
    items: list[str] | None = None


class PostIn(BaseModel):
    """An article as the author sends it. `submit` false keeps a draft; true sends it through the check (and to the administrators)."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(max_length=svc.TITLE_MAX * 2)
    sport: str = Field(max_length=60)
    blocks: list[BlockIn] = Field(max_length=svc.MAX_BLOCKS)
    image_ids: list[UUID] = Field(default_factory=list, max_length=svc.MAX_IMAGES)
    listing_id: UUID | None = None
    submit: bool = False

    @field_validator("title")
    @classmethod
    def _one_line(cls, value: str) -> str:
        return " ".join(value.split())


class AuthorOut(BaseModel):
    id: UUID
    name: str
    is_coach: bool
    is_pro: bool = False
    # Whether the author's profile can be opened: always for a trainer, for a player only if they allowed it.
    profile_open: bool
    avatar_file_id: UUID | None = None


class ListingCardOut(BaseModel):
    id: UUID
    title: str
    price_per_session: float | None = None
    currency: str = "RUB"
    photo_file_id: UUID | None = None
    coach_user_id: UUID


class PostCardOut(BaseModel):
    id: UUID
    title: str
    sport: str
    excerpt: str
    cover_file_id: UUID | None = None
    images_count: int
    author: AuthorOut
    likes_count: int
    comments_count: int
    views_count: int
    published_at: datetime | None
    liked_by_me: bool = False


class PostOut(PostCardOut):
    status: PostStatus
    blocks: list[BlockOut]
    image_ids: list[UUID]
    listing: ListingCardOut | None = None
    bookmarked_by_me: bool = False
    is_mine: bool = False
    reject_reason: str | None = None
    # The automatic check's notes, visible to the author only (and to the administrators).
    flags: list[str] = Field(default_factory=list)
    updated_at: datetime
    # For the author: this edit sent the article back to the administrators (it is not visible to others until they look at it).
    sent_for_review: bool = False


class PostPageOut(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[PostCardOut]


class MyPostOut(BaseModel):
    id: UUID
    title: str
    sport: str
    status: PostStatus
    reject_reason: str | None = None
    published_at: datetime | None
    updated_at: datetime
    likes_count: int
    comments_count: int
    views_count: int
    cover_file_id: UUID | None = None


class ImageOut(BaseModel):
    file_id: UUID


class CommentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=svc.COMMENT_MAX)

    @field_validator("body")
    @classmethod
    def _tidy(cls, value: str) -> str:
        lines = [" ".join(line.split()) for line in value.strip().splitlines()]
        text = "\n".join(lines)
        while "\n\n\n" in text:
            text = text.replace("\n\n\n", "\n\n")
        if not text.strip():
            raise ValueError("напишите комментарий")
        return text.strip()


class CommentOut(BaseModel):
    id: UUID
    post_id: UUID
    author: AuthorOut
    body: str
    contact_hidden: bool
    created_at: datetime
    is_mine: bool = False


class BlogSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    show_profile_in_posts: bool


class BlogSettingsOut(BaseModel):
    show_profile_in_posts: bool
    is_coach: bool


class LikeOut(BaseModel):
    liked: bool
    likes_count: int


class AuthorProfileOut(BaseModel):
    """What anyone may see of an author. A player who has not allowed it is just a first name (profile_open false, nothing else)."""

    id: UUID
    name: str
    is_coach: bool
    is_pro: bool = False
    profile_open: bool
    avatar_file_id: UUID | None = None
    sport: str | None = None
    specialization: str | None = None
    experience_years: int | None = None
    posts_count: int = 0
    muted_by_me: bool = False


# --- the administrators' side -----------------------------------------------------------------------------------------------

class AdminPostRowOut(BaseModel):
    id: UUID
    title: str
    sport: str
    status: PostStatus
    flags: list[str]
    author_id: UUID
    author_name: str
    author_email: str | None
    author_trusted: bool
    submitted_at: datetime | None
    published_at: datetime | None
    reviewed_by: str | None
    reject_reason: str | None
    open_complaints: int


class AdminPostOut(AdminPostRowOut):
    blocks: list[BlockOut]
    image_ids: list[UUID]
    listing: ListingCardOut | None = None
    likes_count: int
    comments_count: int


class AdminPostPageOut(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[AdminPostRowOut]


class ReasonIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=500)

    @field_validator("reason")
    @classmethod
    def _tidy(cls, value: str) -> str:
        text = " ".join(value.split())
        if not text:
            raise ValueError("укажите причину")
        return text


class TrustedIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    trusted: bool
