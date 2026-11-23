"""Value sets shared by the «Подобрать тренера» schemas (the request and the offers to trainers)."""
from __future__ import annotations

from typing import Literal

MatchLevel = Literal["beginner", "amateur", "advanced", "pro"]
MatchFormat = Literal["online", "offline", "any"]
DayPart = Literal["morning", "day", "evening"]
# matched: the athlete chose one of the trainers who agreed. closed / canceled: ended by an administrator / by the athlete.
MatchStatus = Literal["new", "in_progress", "matched", "closed", "canceled"]

# What a trainer's offer is in. "expired" is never stored: it is a proposed / accepted offer whose time ran out.
MatchOfferStatus = Literal[
    "proposed", "coach_declined", "coach_accepted", "athlete_declined", "athlete_accepted", "withdrawn", "expired"
]
