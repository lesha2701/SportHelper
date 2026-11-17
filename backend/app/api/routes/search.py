from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.api.deps import get_current_user, get_db, get_settings_dep
from app.config import Settings
from app.repositories import search as search_repo
from app.schemas.search import SearchResultOut

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("", response_model=list[SearchResultOut])
async def search(
    q: str = Query(..., max_length=100),
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> list[SearchResultOut]:
    query = q.strip()
    if len(query) < 2:
        return []
    rows = await search_repo.search_all(conn, user["id"], query, settings.admin_emails_list)
    return [SearchResultOut(**row) for row in rows]
