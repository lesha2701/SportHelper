"""Data access for player_profiles and coach_profiles. All queries are parameterized."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

_PLAYER_FIELDS = (
    "user_id, full_name, age, height_cm, weight_kg, sport, position, "
    "level, goals, load_restrictions, created_at, updated_at"
)
_COACH_FIELDS = (
    "user_id, full_name, sport, experience_years, specialization, "
    "description, created_at, updated_at"
)


async def get_player_profile(conn: asyncpg.Connection, user_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"SELECT {_PLAYER_FIELDS} FROM player_profiles WHERE user_id = $1", user_id
    )
    return dict(row) if row else None


async def get_coach_profile(conn: asyncpg.Connection, user_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"SELECT {_COACH_FIELDS} FROM coach_profiles WHERE user_id = $1", user_id
    )
    return dict(row) if row else None


async def upsert_player_profile(
    conn: asyncpg.Connection,
    user_id: UUID,
    *,
    full_name: str,
    age: int | None,
    height_cm: int | None,
    weight_kg: float | None,
    sport: str,
    position: str | None,
    level: str | None,
    goals: str | None,
    load_restrictions: str | None,
) -> dict[str, Any]:
    row = await conn.fetchrow(
        f"""
        INSERT INTO player_profiles (
            user_id, full_name, age, height_cm, weight_kg, sport, position,
            level, goals, load_restrictions
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (user_id) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            age = EXCLUDED.age,
            height_cm = EXCLUDED.height_cm,
            weight_kg = EXCLUDED.weight_kg,
            sport = EXCLUDED.sport,
            position = EXCLUDED.position,
            level = EXCLUDED.level,
            goals = EXCLUDED.goals,
            load_restrictions = EXCLUDED.load_restrictions
        RETURNING {_PLAYER_FIELDS}
        """,
        user_id,
        full_name,
        age,
        height_cm,
        weight_kg,
        sport,
        position,
        level,
        goals,
        load_restrictions,
    )
    return dict(row)


async def upsert_coach_profile(
    conn: asyncpg.Connection,
    user_id: UUID,
    *,
    full_name: str,
    sport: str,
    experience_years: int | None,
    specialization: str | None,
    description: str | None,
) -> dict[str, Any]:
    row = await conn.fetchrow(
        f"""
        INSERT INTO coach_profiles (
            user_id, full_name, sport, experience_years, specialization, description
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            sport = EXCLUDED.sport,
            experience_years = EXCLUDED.experience_years,
            specialization = EXCLUDED.specialization,
            description = EXCLUDED.description
        RETURNING {_COACH_FIELDS}
        """,
        user_id,
        full_name,
        sport,
        experience_years,
        specialization,
        description,
    )
    return dict(row)
