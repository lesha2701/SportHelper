from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db
from app.core.exceptions import ForbiddenError, NotFoundError
from app.repositories import metrics as metrics_repo
from app.repositories import teams as teams_repo
from app.schemas.metric import MetricIn, MetricOut

router = APIRouter(prefix="/api/players", tags=["metrics"])
metric_router = APIRouter(prefix="/api/metrics", tags=["metrics"])


async def _check_access(conn: asyncpg.Connection, actor_id: UUID, player_id: UUID) -> None:
    if actor_id == player_id:
        return
    if await teams_repo.shares_team_as_coach(conn, actor_id, player_id):
        return
    raise ForbiddenError("you do not have access to this player's metrics")


@router.post("/{user_id}/metrics", response_model=MetricOut)
async def create_metric(
    user_id: UUID,
    payload: MetricIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> MetricOut:
    await _check_access(conn, user["id"], user_id)
    metric = await metrics_repo.create_metric(conn, user_id, user["id"], **payload.model_dump())
    return MetricOut(**metric)


@router.get("/{user_id}/metrics", response_model=list[MetricOut])
async def list_metrics(
    user_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[MetricOut]:
    await _check_access(conn, user["id"], user_id)
    metrics = await metrics_repo.list_for_user(conn, user_id)
    return [MetricOut(**m) for m in metrics]


@metric_router.put("/{metric_id}", response_model=MetricOut)
async def update_metric(
    metric_id: UUID,
    payload: MetricIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> MetricOut:
    metric = await metrics_repo.get_metric(conn, metric_id)
    if metric is None or metric["recorded_by"] != user["id"]:
        raise NotFoundError("metric not found")
    updated = await metrics_repo.update_metric(conn, metric_id, **payload.model_dump())
    if updated is None:
        raise NotFoundError("metric not found")
    return MetricOut(**updated)


@metric_router.delete("/{metric_id}", status_code=204, response_model=None)
async def delete_metric(
    metric_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    metric = await metrics_repo.get_metric(conn, metric_id)
    if metric is None or metric["recorded_by"] != user["id"]:
        raise NotFoundError("metric not found")
    await metrics_repo.soft_delete(conn, metric_id)
