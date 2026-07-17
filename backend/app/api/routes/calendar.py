from __future__ import annotations

from datetime import date, time

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.api.deps import get_current_user, get_db
from app.core.exceptions import APIError
from app.repositories import matches as matches_repo
from app.repositories import tasks as tasks_repo
from app.repositories import trainings as trainings_repo
from app.schemas.calendar import CalendarEventOut

router = APIRouter(prefix="/api/calendar", tags=["calendar"])

_MAX_RANGE_DAYS = 120

_TRAINING_TITLES = {
    "personal": "Личная тренировка",
    "team": "Тренировка команды",
    "independent": "Самостоятельная тренировка",
}


@router.get("", response_model=list[CalendarEventOut])
async def get_calendar(
    date_from: date = Query(...),
    date_to: date = Query(...),
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[CalendarEventOut]:
    if date_to < date_from:
        raise APIError("date_to must not be before date_from", code="invalid_range", status_code=400)
    if (date_to - date_from).days > _MAX_RANGE_DAYS:
        raise APIError(f"date range must not exceed {_MAX_RANGE_DAYS} days", code="range_too_large", status_code=400)

    trainings = await trainings_repo.list_calendar_trainings(conn, user["id"], date_from, date_to)
    matches = await matches_repo.list_calendar_matches(conn, user["id"], date_from, date_to)
    deadlines = await tasks_repo.list_calendar_task_deadlines(conn, user["id"], date_from, date_to)

    events: list[CalendarEventOut] = []
    for t in trainings:
        events.append(
            CalendarEventOut(
                id=t["id"],
                type="training",
                date=t["training_date"],
                time=t["start_time"],
                title=_TRAINING_TITLES[t["type"]],
                team_id=t["team_id"],
                team_name=t["team_name"],
                status=t["status"],
            )
        )
    for m in matches:
        events.append(
            CalendarEventOut(
                id=m["id"],
                type="match",
                date=m["match_date"],
                time=m["start_time"],
                title=f"Матч с «{m['opponent_name']}»",
                team_id=m["team_id"],
                team_name=m["team_name"],
                status=m["status"],
            )
        )
    for d in deadlines:
        events.append(
            CalendarEventOut(
                id=d["id"],
                type="task_deadline",
                date=d["deadline"].date(),
                time=d["deadline"].time(),
                title=f"Дедлайн: «{d['title']}»",
                team_id=d["team_id"],
                team_name=d["team_name"],
                status=d["status"],
            )
        )

    events.sort(key=lambda e: (e.date, e.time or time.min))
    return events
