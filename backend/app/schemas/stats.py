from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel

from app.schemas.metric import MetricOut, PersonalRecordOut


class PlayerActivityOut(BaseModel):
    user_id: UUID
    first_name: str
    last_name: str | None
    present_count: int
    absent_count: int
    attendance_rate: float | None


class TeamStatsOut(BaseModel):
    members_count: int
    trainings_completed: int
    trainings_upcoming: int
    independent_trainings: int
    attendance_rate: float | None
    tasks_total: int
    tasks_completed: int
    tasks_overdue: int
    avg_difficulty: float | None
    avg_wellbeing: float | None
    matches_played: int
    matches_won: int
    matches_lost: int
    matches_drawn: int
    low_activity_players: list[PlayerActivityOut]
    frequent_absence_players: list[PlayerActivityOut]


class CoachCommentOut(BaseModel):
    context: str
    comment: str
    commented_at: datetime | None


class MatchHistoryEntryOut(BaseModel):
    id: UUID
    opponent_name: str
    match_date: date
    our_score: int | None
    opponent_score: int | None
    status: str
    team_name: str | None


class PlayerStatsOut(BaseModel):
    trainings_attended: int
    trainings_total: int
    attendance_rate: float | None
    training_minutes: int
    team_trainings_count: int
    personal_trainings_count: int
    activity_streak: int
    tasks_total: int
    tasks_completed: int
    tasks_overdue: int
    matches_history: list[MatchHistoryEntryOut]
    coach_comments: list[CoachCommentOut]
    metrics: list[MetricOut]
    personal_records: list[PersonalRecordOut]
