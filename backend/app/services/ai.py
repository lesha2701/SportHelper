"""Orchestrates the AI features: gathers context from existing repositories
(and, for the two summary/analysis features, reuses the exact same
aggregation the stats endpoints already compute), renders prompts, calls
Yandex AI Studio, and — for the three "draft" features — parses the JSON
response into a typed schema.

Permission checks (coach staff / profile ownership / team membership) live
in app/api/routes/ai.py, not here — this module only builds context and
talks to the AI, mirroring how repositories stay permission-agnostic
elsewhere in the project.

Every AI-generated value only ever lands in a draft response returned to
the client; nothing here writes to the database. Publishing only happens
when the coach/player takes the (possibly edited) draft through the normal,
already-validated creation endpoints — see the iteration 14 README section.
"""
from __future__ import annotations

import json
import re
from typing import Any
from uuid import UUID

import asyncpg

from app.ai.prompts import load_system_prompt, render_user_prompt
from app.api.routes.stats import get_player_stats, get_team_stats
from app.config import Settings
from app.core.exceptions import AIServiceError
from app.integrations.yandex_ai import YandexAIClient, YandexAIError
from app.repositories import exercises as exercises_repo
from app.repositories import plans as plans_repo
from app.repositories import reports as reports_repo
from app.repositories import teams as teams_repo
from app.repositories import trainings as trainings_repo
from app.schemas.ai import (
    PersonalTrainingDraftIn,
    PersonalTrainingDraftOut,
    PersonalTrainingExerciseDraft,
    TaskDraftIn,
    TaskDraftOut,
    TrainingPlanDraftIn,
    TrainingPlanDraftOut,
)

_DASH = "—"
_VALID_TASK_TARGET_TYPES = {"team", "players", "position", "absentees"}


def _or_dash(value: Any) -> str:
    return _DASH if value is None or value == "" else str(value)


def _coerce_int(value: Any) -> int | None:
    try:
        return int(round(float(value))) if value is not None else None
    except (TypeError, ValueError):
        return None


def _coerce_float(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"true", "1", "yes", "да"}


def _coerce_text(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


async def _call_ai(settings: Settings, prompt_name: str, **user_values: str) -> str:
    try:
        client = YandexAIClient(settings)
    except RuntimeError as exc:
        raise AIServiceError(
            "ИИ не настроен на сервере (нет YANDEX_AI_API_KEY/YANDEX_AI_FOLDER_ID)"
        ) from exc
    system_prompt = load_system_prompt(prompt_name)
    user_prompt = render_user_prompt(prompt_name, **user_values)
    try:
        return await client.complete(system_prompt=system_prompt, user_prompt=user_prompt)
    except YandexAIError as exc:
        raise AIServiceError("ИИ временно недоступен, попробуйте ещё раз позже") from exc


def _parse_json_object(text: str) -> dict[str, Any]:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match is None:
        raise AIServiceError("ИИ вернул ответ в неожиданном формате, попробуйте ещё раз")
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise AIServiceError("ИИ вернул ответ в неожиданном формате, попробуйте ещё раз") from exc
    if not isinstance(parsed, dict):
        raise AIServiceError("ИИ вернул ответ в неожиданном формате, попробуйте ещё раз")
    return parsed


def _format_team_stats(stats: Any) -> str:
    lines = [
        f"Игроков в составе: {stats.members_count}",
        f"Посещаемость: {_format_rate(stats.attendance_rate)}",
        f"Тренировок проведено: {stats.trainings_completed} (из них самостоятельных: "
        f"{stats.independent_trainings}), предстоит: {stats.trainings_upcoming}",
        f"Задания: выполнено {stats.tasks_completed} из {stats.tasks_total}, просрочено {stats.tasks_overdue}",
    ]
    if stats.avg_difficulty is not None:
        lines.append(f"Средняя сложность заданий: {stats.avg_difficulty} из 10")
    if stats.avg_wellbeing is not None:
        lines.append(f"Среднее самочувствие по заданиям: {stats.avg_wellbeing} из 5")
    lines.append(
        f"Матчи: сыграно {stats.matches_played}, победы {stats.matches_won}, "
        f"ничьи {stats.matches_drawn}, поражения {stats.matches_lost}"
    )
    if stats.low_activity_players:
        names = ", ".join(f"{p.first_name} {p.last_name or ''}".strip() for p in stats.low_activity_players)
        lines.append(f"Игроки с низкой посещаемостью: {names}")
    if stats.frequent_absence_players:
        names = ", ".join(f"{p.first_name} {p.last_name or ''}".strip() for p in stats.frequent_absence_players)
        lines.append(f"Игроки с частыми пропусками: {names}")
    return "\n".join(lines)


def _format_rate(rate: float | None) -> str:
    return _DASH if rate is None else f"{round(rate * 100)}%"


def _format_player_stats(stats: Any) -> str:
    lines = [
        f"Тренировок посещено: {stats.trainings_attended} из {stats.trainings_total} "
        f"(посещаемость {_format_rate(stats.attendance_rate)})",
        f"Командных тренировок: {stats.team_trainings_count}, личных: {stats.personal_trainings_count}",
        f"Суммарное время тренировок: {stats.training_minutes} мин",
        f"Серия посещений подряд: {stats.activity_streak}",
        f"Задания: выполнено {stats.tasks_completed} из {stats.tasks_total}, просрочено {stats.tasks_overdue}",
    ]
    recent_matches = [m for m in stats.matches_history[:5] if m.our_score is not None]
    if recent_matches:
        match_lines = "; ".join(f"{m.opponent_name} {m.our_score}:{m.opponent_score}" for m in recent_matches)
        lines.append(f"Последние матчи команды: {match_lines}")
    if stats.personal_records:
        rec_lines = "; ".join(f"{r.name}: {r.value}{r.unit or ''}" for r in stats.personal_records[:8])
        lines.append(f"Личные рекорды: {rec_lines}")
    comment_lines = "; ".join(c.comment for c in stats.coach_comments[:5] if c.comment)
    if comment_lines:
        lines.append(f"Недавние комментарии тренера: {comment_lines}")
    return "\n".join(lines)


async def build_training_plan_draft(
    conn: asyncpg.Connection,
    settings: Settings,
    *,
    coach_id: UUID,
    team: dict | None,
    payload: TrainingPlanDraftIn,
) -> TrainingPlanDraftOut:
    sport = payload.sport or (team["sport"] if team else None) or "универсальный"
    age_category = payload.age_category or (team["age_category"] if team else None)
    level = payload.level or (team["level"] if team else None)
    player_count = payload.player_count
    if player_count is None and team is not None:
        player_count = await teams_repo.count_members(conn, team["id"])
    duration_minutes = payload.duration_minutes or 60

    owned_exercises = await exercises_repo.list_owned(conn, coach_id)
    matching_names = [e["name"] for e in owned_exercises if e["sport"].lower() == sport.lower()][:8]
    exercise_examples = ", ".join(matching_names) if matching_names else _DASH

    text = await _call_ai(
        settings,
        "training_plan",
        sport=sport,
        age_category=_or_dash(age_category),
        level=_or_dash(level),
        player_count=_or_dash(player_count),
        duration_minutes=str(duration_minutes),
        equipment=_or_dash(payload.equipment),
        goals=payload.goals,
        exercise_examples=exercise_examples,
    )
    data = _parse_json_object(text)

    sections = []
    for key, header in (
        ("warmup", "Разминка"),
        ("main_part", "Основная часть"),
        ("game_part", "Игровая часть"),
        ("cooldown", "Заминка"),
    ):
        section_text = _coerce_text(data.get(key))
        if section_text:
            sections.append(f"{header}:\n{section_text}")
    description = "\n\n".join(sections) or "Не удалось сформировать план, попробуйте ещё раз."

    return TrainingPlanDraftOut(
        name=(_coerce_text(data.get("name")) or "План от ИИ")[:150],
        sport=sport,
        description=description,
        duration_minutes=duration_minutes,
        equipment=_coerce_text(data.get("equipment")) or payload.equipment,
        comment=_coerce_text(data.get("comment")),
    )


async def build_task_draft(
    conn: asyncpg.Connection, settings: Settings, *, team: dict, payload: TaskDraftIn
) -> TaskDraftOut:
    members = await teams_repo.list_members(conn, team["id"])
    positions = sorted({m["position"] for m in members if m.get("position")})
    positions_text = ", ".join(positions) if positions else _DASH

    text = await _call_ai(
        settings,
        "task",
        sport=team["sport"],
        level=_or_dash(team.get("level")),
        positions=positions_text,
        goal=payload.goal,
        target_type_hint=_or_dash(payload.target_type_hint),
    )
    data = _parse_json_object(text)

    target_type = str(data.get("target_type") or "team").strip()
    if target_type not in _VALID_TASK_TARGET_TYPES:
        target_type = "team"
    target_position = _coerce_text(data.get("target_position")) if target_type == "position" else None

    return TaskDraftOut(
        title=(_coerce_text(data.get("title")) or "Задание от ИИ")[:150],
        description=_coerce_text(data.get("description")) or "",
        metric_name=_coerce_text(data.get("metric_name")),
        metric_unit=_coerce_text(data.get("metric_unit")),
        metric_target=_coerce_float(data.get("metric_target")),
        require_comment=_coerce_bool(data.get("require_comment")),
        require_photo=_coerce_bool(data.get("require_photo")),
        require_video=_coerce_bool(data.get("require_video")),
        require_sets_reps=_coerce_bool(data.get("require_sets_reps")),
        require_duration=_coerce_bool(data.get("require_duration")),
        require_metric_value=_coerce_bool(data.get("require_metric_value")),
        require_difficulty=_coerce_bool(data.get("require_difficulty")),
        require_wellbeing=_coerce_bool(data.get("require_wellbeing")),
        target_type=target_type,  # type: ignore[arg-type]
        target_position=target_position,
    )


async def build_personal_training_draft(
    conn: asyncpg.Connection, settings: Settings, *, player_profile: dict, payload: PersonalTrainingDraftIn
) -> PersonalTrainingDraftOut:
    attendance = await trainings_repo.player_attendance_summary(conn, player_profile["user_id"])
    counts = await trainings_repo.player_training_counts(conn, player_profile["user_id"])
    recent_activity = (
        f"командных тренировок посещено {attendance['present_count']} из {attendance['total_count']}, "
        f"личных тренировок: {counts['personal_count']} (суммарно {counts['personal_minutes']} мин)"
    )
    duration_minutes = payload.duration_minutes or 45

    text = await _call_ai(
        settings,
        "personal_training",
        sport=_or_dash(player_profile.get("sport")),
        age=_or_dash(player_profile.get("age")),
        level=_or_dash(player_profile.get("level")),
        position=_or_dash(player_profile.get("position")),
        goals=_or_dash(player_profile.get("goals")),
        load_restrictions=_or_dash(player_profile.get("load_restrictions")),
        recent_activity=recent_activity,
        style=payload.style,
        duration_minutes=str(duration_minutes),
        extra_goals=_or_dash(payload.goals),
    )
    data = _parse_json_object(text)

    exercises = []
    for raw in data.get("exercises") or []:
        if not isinstance(raw, dict):
            continue
        name = _coerce_text(raw.get("exercise"))
        if not name:
            continue
        exercises.append(
            PersonalTrainingExerciseDraft(
                exercise=name,
                reps=_coerce_int(raw.get("reps")),
                sets=_coerce_int(raw.get("sets")),
                duration_seconds=_coerce_int(raw.get("duration_seconds")),
            )
        )
    if not exercises:
        raise AIServiceError("ИИ вернул ответ в неожиданном формате, попробуйте ещё раз")

    return PersonalTrainingDraftOut(
        style=payload.style,
        exercises=exercises,
        notes=_coerce_text(data.get("notes")),
        duration_minutes=_coerce_int(data.get("duration_minutes")) or duration_minutes,
    )


def _format_attendance_status(training: dict, attendance_row: dict | None) -> str:
    if training["type"] == "personal":
        return "не отслеживается (личная тренировка)"
    # Unmarked players count as present (see app/services/background.py's
    # domain rule: the coach only marks absentees) — reflect that here
    # instead of reporting a misleading "not marked" status to the AI.
    if attendance_row is None:
        return "присутствовал (не был отмечен как отсутствующий)"
    return "присутствовал" if attendance_row["status"] == "present" else "отсутствовал"


async def build_training_evaluation(
    conn: asyncpg.Connection,
    settings: Settings,
    *,
    player_profile: dict,
    training: dict,
    attendance_row: dict | None,
    report: dict | None,
    feedback: dict | None,
) -> str:
    plan_info = _DASH
    if training["plan_id"]:
        plan = await plans_repo.get_plan(conn, training["plan_id"])
        if plan:
            plan_info = f"{plan['name']}: {plan['description'] or ''}".strip()

    training_info = (
        f"Дата: {training['training_date']}, тип: {training['type']}, "
        f"длительность: {training['duration_minutes']} мин, статус: {training['status']}, "
        f"посещаемость игрока: {_format_attendance_status(training, attendance_row)}"
    )
    report_text = report["text_report"] if report else _DASH

    if feedback and not feedback["skipped"]:
        parts = []
        if feedback["wellbeing"] is not None:
            parts.append(f"самочувствие {feedback['wellbeing']}/5")
        if feedback["difficulty"] is not None:
            parts.append(f"нагрузка {feedback['difficulty']}/10")
        if feedback["comment"]:
            parts.append(f"комментарий игрока: {feedback['comment']}")
        feedback_text = ", ".join(parts) if parts else _DASH
    else:
        feedback_text = "игрок не оставил отзыв о тренировке"

    text = await _call_ai(
        settings,
        "training_evaluation",
        sport=_or_dash(player_profile.get("sport")),
        age=_or_dash(player_profile.get("age")),
        level=_or_dash(player_profile.get("level")),
        position=_or_dash(player_profile.get("position")),
        goals=_or_dash(player_profile.get("goals")),
        feedback_text=feedback_text,
        training_info=training_info,
        plan_info=plan_info,
        report_text=report_text,
    )
    return text.strip()


async def build_report_analysis(conn: asyncpg.Connection, settings: Settings, *, team: dict) -> str:
    reports = await reports_repo.list_recent_team_reports(conn, team["id"], limit=10)
    reports_text = (
        "\n".join(f"{r['training_date']}: {r['text_report']}" for r in reports) if reports else "Отчётов пока нет."
    )
    text = await _call_ai(
        settings,
        "report_analysis",
        team_name=team["name"],
        sport=team["sport"],
        level=_or_dash(team.get("level")),
        reports_text=reports_text,
    )
    return text.strip()


async def build_attendance_analysis(conn: asyncpg.Connection, settings: Settings, *, team: dict) -> str:
    rows = await trainings_repo.team_player_attendance(conn, team["id"])
    members_count = await teams_repo.count_members(conn, team["id"])
    if rows:
        attendance_table = "\n".join(
            f"{(row['first_name'] + ' ' + (row['last_name'] or '')).strip()} — "
            f"{row['present_count']}/{row['present_count'] + row['absent_count']}"
            for row in rows
        )
    else:
        attendance_table = "Данных о посещаемости пока нет."
    text = await _call_ai(
        settings,
        "attendance_analysis",
        team_name=team["name"],
        sport=team["sport"],
        level=_or_dash(team.get("level")),
        members_count=str(members_count),
        attendance_table=attendance_table,
    )
    return text.strip()


async def build_team_summary(conn: asyncpg.Connection, settings: Settings, *, team: dict, coach_id: UUID) -> str:
    stats = await get_team_stats(team["id"], {"id": coach_id}, conn)
    text = await _call_ai(
        settings,
        "team_summary",
        team_name=team["name"],
        sport=team["sport"],
        level=_or_dash(team.get("level")),
        stats_summary=_format_team_stats(stats),
    )
    return text.strip()


async def build_progress_analysis(conn: asyncpg.Connection, settings: Settings, *, player_profile: dict) -> str:
    user_id = player_profile["user_id"]
    stats = await get_player_stats(user_id, {"id": user_id}, conn)
    text = await _call_ai(
        settings,
        "progress_analysis",
        sport=_or_dash(player_profile.get("sport")),
        age=_or_dash(player_profile.get("age")),
        level=_or_dash(player_profile.get("level")),
        position=_or_dash(player_profile.get("position")),
        goals=_or_dash(player_profile.get("goals")),
        load_restrictions=_or_dash(player_profile.get("load_restrictions")),
        stats_summary=_format_player_stats(stats),
    )
    return text.strip()
