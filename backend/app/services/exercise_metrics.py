"""How an exercise of a personal workout is measured, and sensible numbers for each kind.

Three kinds: repetitions (with sets), time (a plank, a stretch) and distance (a run, a swim, a jump, optionally with a
target time). The AI draft of a training uses this to fix what the model returns: a run must never come back as
"3 sets of 10 repetitions". The same rules live on the client (frontend/src/lib/workout.ts) for descriptions that
carry no explicit unit."""
from __future__ import annotations

import re
from typing import Literal

Metric = Literal["reps", "time", "distance"]

_TIME = re.compile(r"скакалк|на месте|планк|растяжк|стойк|удержан|статик|(^|\s)вис($|\s)|йога|разминк|заминк|кардио|медитац|дыхани")
_DISTANCE = re.compile(r"(^|\s)(бег|пробеж|кросс|спринт|ходьб|плаван|заплыв|велосипед|велотрен|лыж|гребл|марафон)|в длину|в высоту|метани|толкани")


def infer_metric(name: str) -> Metric:
    lower = name.lower()
    if re.search(r"скакалк|на месте", lower) or _TIME.search(lower):
        return "time"
    if _DISTANCE.search(lower):
        return "distance"
    return "reps"


def _clamp(value: int | None, low: int, high: int) -> int | None:
    if value is None:
        return None
    return max(low, min(high, value))


def normalize_exercise(
    name: str,
    *,
    metric: str | None,
    sets: int | None,
    reps: int | None,
    seconds: int | None,
    meters: int | None,
) -> dict:
    """Returns {type, sets, reps, duration_seconds, distance_meters} with the kind settled and the numbers
    that kind needs filled in and kept in a believable range."""
    guessed = infer_metric(name)
    kind: Metric = metric if metric in ("reps", "time", "distance") else guessed  # type: ignore[assignment]
    # A run or a plank counted in repetitions is a model slip, not a choice: the name wins, and the repetition-style
    # sets that came with it mean nothing for the real kind.
    if kind == "reps" and guessed != "reps":
        kind = guessed
        sets = None
    # Zero or a negative count is "not given".
    sets, reps, seconds, meters = (v if v is not None and v > 0 else None for v in (sets, reps, seconds, meters))

    if kind == "time":
        return {
            "type": "time",
            "sets": _clamp(sets, 1, 10) or 3,
            "reps": None,
            "duration_seconds": _clamp(seconds, 5, 3600) or 30,
            "distance_meters": None,
        }
    if kind == "distance":
        return {
            "type": "distance",
            "sets": _clamp(sets, 1, 20) or 1,
            "reps": None,
            "duration_seconds": _clamp(seconds, 5, 86400),
            "distance_meters": _clamp(meters, 5, 100000) or 1000,
        }
    return {
        "type": "reps",
        "sets": _clamp(sets, 1, 10) or 3,
        "reps": _clamp(reps, 1, 100) or 10,
        "duration_seconds": None,
        "distance_meters": None,
    }
