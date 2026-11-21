"""Blocking people. A blocked person's chat messages disappear for the blocker (in team and personal-training chats), do not count as
unread and do not send him notifications; a personal-training chat between the two is closed for sending. Both sides see the same
neutral wording, so nobody is told who blocked whom. Unblocking brings everything back."""
from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db
from app.core.exceptions import APIError, NotFoundError
from app.repositories import blocks as blocks_repo
from app.schemas.blocks import BlockedUserOut

router = APIRouter(prefix="/api/blocks", tags=["blocks"])


@router.get("", response_model=list[BlockedUserOut])
async def my_blocks(user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> list[BlockedUserOut]:
    rows = await blocks_repo.list_blocked(conn, user["id"])
    return [
        BlockedUserOut(user_id=r["user_id"], full_name=" ".join(p for p in (r["first_name"], r["last_name"]) if p) or "Пользователь", blocked_at=r["created_at"])
        for r in rows
    ]


@router.put("/{user_id}", status_code=204, response_model=None)
async def block_user(user_id: UUID, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> None:
    """Blocks a person; blocking somebody already blocked changes nothing."""
    if user_id == user["id"]:
        raise APIError("Нельзя заблокировать самого себя.", code="cannot_block_self", status_code=422)
    exists = await conn.fetchval("SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL)", user_id)
    if not exists:
        raise NotFoundError("user not found")
    await blocks_repo.block(conn, user["id"], user_id)


@router.delete("/{user_id}", status_code=204, response_model=None)
async def unblock_user(user_id: UUID, user: dict = Depends(get_current_user), conn: asyncpg.Connection = Depends(get_db)) -> None:
    await blocks_repo.unblock(conn, user["id"], user_id)
