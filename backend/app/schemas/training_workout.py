from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class WorkoutSet(BaseModel):
    reps: int = Field(default=0, ge=0, le=10000)
    weight_kg: float | None = Field(default=None, ge=0, le=2000)
    # For exercises measured in time (a plank, a stretch) and in distance (a run, a jump).
    seconds: int | None = Field(default=None, ge=0, le=86400)
    meters: float | None = Field(default=None, ge=0, le=1_000_000)
    done: bool = False


class WorkoutExercise(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    # What one set of this exercise is measured in.
    metric: Literal["reps", "time", "distance"] = "reps"
    target_sets: int | None = Field(default=None, ge=1, le=100)
    target_reps: int | None = Field(default=None, ge=1, le=10000)
    # The plan of a timed exercise or of a distance one: seconds, and meters.
    target_seconds: int | None = Field(default=None, ge=1, le=86400)
    target_meters: float | None = Field(default=None, ge=0, le=1_000_000)
    sets: list[WorkoutSet] = Field(default_factory=list, max_length=60)


class TrainingWorkoutIn(BaseModel):
    exercises: list[WorkoutExercise] = Field(min_length=1, max_length=60)
    wellbeing: int | None = Field(default=None, ge=1, le=5)
    note: str | None = Field(default=None, max_length=1000)
    started_at: datetime | None = None
    finished_at: datetime | None = None


class TrainingWorkoutOut(TrainingWorkoutIn):
    training_id: UUID
    updated_at: datetime
