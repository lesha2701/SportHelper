from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db
from app.core.exceptions import NotFoundError
from app.repositories import users as users_repo
from app.schemas.user import CURRENT_ONBOARDING_VERSION, UserOut

router = APIRouter(prefix="/api/users/me", tags=["onboarding"])


@router.post("/onboarding/complete", response_model=UserOut)
async def complete_onboarding(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> UserOut:
    """Records that the caller finished (or skipped) the current welcome guide.
    Takes no body and no user id: it only ever updates the authenticated
    user, and always to the server's current version."""
    updated = await users_repo.complete_onboarding(conn, user["id"], CURRENT_ONBOARDING_VERSION)
    if updated is None:
        raise NotFoundError("user not found")
    return UserOut(**updated)
