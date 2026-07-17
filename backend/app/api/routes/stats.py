from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db
from app.core.exceptions import ForbiddenError
from app.repositories import matches as matches_repo
from app.repositories import metrics as metrics_repo
from app.repositories import reports as reports_repo
from app.repositories import tasks as tasks_repo
from app.repositories import teams as teams_repo
from app.repositories import trainings as trainings_repo
from app.schemas.metric import MetricOut, PersonalRecordOut
from app.schemas.stats import (
    CoachCommentOut,
    MatchHistoryEntryOut,
    PlayerActivityOut,
    PlayerStatsOut,
    TeamStatsOut,
)

router = APIRouter(prefix="/api", tags=["stats"])

_COACH_STAFF = {"head_coach", "assistant_coach"}
_LOW_ACTIVITY_THRESHOLD = 0.6
_ACTIVITY_LIST_LIMIT = 5


def _attendance_rate(present: int, total: int) -> float | None:
    return round(present / total, 3) if total > 0 else None


@router.get("/teams/{team_id}/stats", response_model=TeamStatsOut)
async def get_team_stats(
    team_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> TeamStatsOut:
    member = await teams_repo.get_member(conn, team_id, user["id"])
    if member is None or member["role"] not in _COACH_STAFF:
        raise ForbiddenError("only the head coach or an assistant coach can view team statistics")

    members_count = await teams_repo.count_members(conn, team_id)
    training_summary = await trainings_repo.count_team_trainings_summary(conn, team_id)
    task_summary = await tasks_repo.team_task_summary(conn, team_id)
    match_summary = await matches_repo.team_match_summary(conn, team_id)
    attendance_rows = await trainings_repo.team_player_attendance(conn, team_id)

    activities: list[PlayerActivityOut] = []
    total_present = 0
    total_attendance = 0
    for row in attendance_rows:
        present = row["present_count"]
        absent = row["absent_count"]
        total = present + absent
        total_present += present
        total_attendance += total
        activities.append(
            PlayerActivityOut(
                user_id=row["user_id"],
                first_name=row["first_name"],
                last_name=row["last_name"],
                present_count=present,
                absent_count=absent,
                attendance_rate=_attendance_rate(present, total),
            )
        )

    low_activity = sorted(
        (a for a in activities if a.attendance_rate is not None and a.attendance_rate < _LOW_ACTIVITY_THRESHOLD),
        key=lambda a: a.attendance_rate,  # type: ignore[arg-type, return-value]
    )[:_ACTIVITY_LIST_LIMIT]
    frequent_absences = sorted(
        (a for a in activities if a.absent_count > 0), key=lambda a: a.absent_count, reverse=True
    )[:_ACTIVITY_LIST_LIMIT]

    avg_difficulty = task_summary["avg_difficulty"]
    avg_wellbeing = task_summary["avg_wellbeing"]

    return TeamStatsOut(
        members_count=members_count,
        trainings_completed=training_summary["completed"],
        trainings_upcoming=training_summary["upcoming"],
        independent_trainings=training_summary["independent"],
        attendance_rate=_attendance_rate(total_present, total_attendance),
        tasks_total=task_summary["total"],
        tasks_completed=task_summary["completed"],
        tasks_overdue=task_summary["overdue"],
        avg_difficulty=round(avg_difficulty, 2) if avg_difficulty is not None else None,
        avg_wellbeing=round(avg_wellbeing, 2) if avg_wellbeing is not None else None,
        matches_played=match_summary["played"],
        matches_won=match_summary["wins"],
        matches_lost=match_summary["losses"],
        matches_drawn=match_summary["draws"],
        low_activity_players=low_activity,
        frequent_absence_players=frequent_absences,
    )


def _compute_streak(attendance_rows: list[dict]) -> int:
    streak = 0
    for row in attendance_rows:
        if row["status"] == "present":
            streak += 1
        else:
            break
    return streak


def _personal_records(metrics: list[dict]) -> list[PersonalRecordOut]:
    best: dict[str, dict] = {}
    for m in metrics:
        current = best.get(m["name"])
        if current is None:
            best[m["name"]] = m
            continue
        if m["higher_is_better"] and m["value"] > current["value"]:
            best[m["name"]] = m
        elif not m["higher_is_better"] and m["value"] < current["value"]:
            best[m["name"]] = m
    return [
        PersonalRecordOut(
            name=m["name"],
            unit=m["unit"],
            value=m["value"],
            recorded_date=m["recorded_date"],
            higher_is_better=m["higher_is_better"],
        )
        for m in best.values()
    ]


@router.get("/players/{user_id}/stats", response_model=PlayerStatsOut)
async def get_player_stats(
    user_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> PlayerStatsOut:
    if user["id"] != user_id and not await teams_repo.shares_team_as_coach(conn, user["id"], user_id):
        raise ForbiddenError("you do not have access to this player's statistics")

    attendance = await trainings_repo.player_attendance_summary(conn, user_id)
    training_counts = await trainings_repo.player_training_counts(conn, user_id)
    task_summary = await tasks_repo.player_task_summary(conn, user_id)
    streak_rows = await trainings_repo.player_attendance_history(conn, user_id)
    match_history = await matches_repo.player_match_history(conn, user_id)
    task_comments = await tasks_repo.player_coach_comments(conn, user_id)
    report_comments = await reports_repo.player_coach_comments(conn, user_id)
    metrics = await metrics_repo.list_for_user(conn, user_id)

    comments = sorted(
        [*task_comments, *report_comments],
        key=lambda c: c["commented_at"] or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )[:20]

    team_trainings_present = attendance["present_count"]
    team_trainings_total = attendance["total_count"]

    return PlayerStatsOut(
        trainings_attended=team_trainings_present,
        trainings_total=team_trainings_total + training_counts["personal_count"],
        attendance_rate=_attendance_rate(team_trainings_present, team_trainings_total),
        training_minutes=attendance["minutes_present"] + training_counts["personal_minutes"],
        team_trainings_count=team_trainings_total,
        personal_trainings_count=training_counts["personal_count"],
        activity_streak=_compute_streak(streak_rows),
        tasks_total=task_summary["total"],
        tasks_completed=task_summary["completed"],
        tasks_overdue=task_summary["overdue"],
        matches_history=[MatchHistoryEntryOut(**m) for m in match_history],
        coach_comments=[CoachCommentOut(**c) for c in comments],
        metrics=[MetricOut(**m) for m in metrics],
        personal_records=_personal_records(metrics),
    )
