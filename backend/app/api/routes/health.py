from __future__ import annotations

from fastapi import APIRouter, Request

from app.database import check_connection

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
async def health(request: Request) -> dict:
    db_ok = await check_connection(request.app.state.db_pool)
    return {
        "status": "ok" if db_ok else "degraded",
        "database": db_ok,
    }
