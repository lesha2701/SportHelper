# Coach listings backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single coach-level marketplace settings (`coach_profiles.is_listed`/`price_per_session`/etc, one weekly schedule per coach) with a new `coach_listings` table: a coach can create multiple independent, individually-bookable listings, each with its own price/duration/format/schedule and an optional photo/video (reusing the app's existing Yandex.Disk upload infrastructure).

**Architecture:** New `coach_listings` + `coach_listing_availability` tables, added *alongside* the existing `coach_profiles` marketplace columns and `coach_availability_templates` table — the old tables/columns and the old `/api/coaches/*` routes are **not touched or removed by this plan**. A brand-new router at `/api/coach-listings` is built from scratch, and `bookings`/`POST /api/bookings` are rewired to reference `listing_id` instead of `coach_user_id` directly (the one genuinely breaking change in this plan — acceptable per this project's established practice of shipping backend-then-frontend plans back to back against a single dev environment with no external users). Retiring the old marketplace code entirely (dropping `coach_profiles` columns, dropping `coach_availability_templates`, deleting `coach_marketplace.py`/`coaches.py`) is the plan's last task, once nothing references them anymore.

**Tech Stack:** FastAPI + asyncpg (raw parameterized SQL), pytest against in-memory fakes (`backend/tests/conftest.py`), Yandex.Disk-backed file storage (`app/services/uploads.py`, `app/integrations/yandex_disk.py`).

**Spec:** [`docs/superpowers/specs/2026-09-10-coach-listings-design.md`](../specs/2026-09-10-coach-listings-design.md)

## Global Constraints

- Backend tests run **only** via `docker compose -f docker-compose.dev.yml exec backend python -m pytest ...` from the repo root — never a local venv.
- All SQL is raw, parameterized asyncpg — no ORM.
- The coach-wide double-booking guard is unchanged and must keep working across listings: `compute_open_slots` for one listing must still exclude every slot already booked via **any** of that coach's listings, by keying the booked-set query on `coach_user_id`, not `listing_id`.
- `bookings.listing_id` stays **nullable at the DB level, permanently** — historical bookings predating this feature have no listing to point at, and there is no synthetic-listing fallback. New bookings always provide one (enforced by `BookingIn.listing_id` being a required Pydantic field, not a DB constraint). Every query that joins `coach_listings` off `bookings.listing_id` must use `LEFT JOIN`, never `JOIN`.
- File uploads follow `backend/app/api/routes/exercises.py`'s `_upload_exercise_media` pattern exactly (mime/size validation via `app.services.uploads`, `build_user_file_path`), but replacing a listing's photo/video **soft-deletes the old file row** (team-logo style — see `files_repo.replace_team_logo`), not the exercise style of silently overwriting the pointer and orphaning the old row.
- Reviews stay coach-level (`coach_reviews.coach_user_id`) — no schema or repository change to reviews in this plan.
- Do not modify `backend/app/repositories/coach_marketplace.py`, `backend/app/schemas/coach_marketplace.py`, `backend/app/schemas/coach_search.py`, `backend/app/api/routes/coaches.py`, or `backend/tests/test_coach_marketplace_api.py` until the final cleanup task — they must keep working unchanged throughout every other task.

---

### Task 1: Additive migration — `coach_listings`, `coach_listing_availability`, `bookings.listing_id`, `files` PUBLIC access

**Files:**
- Create: `database/patches/0021_coach_listings.sql`

**Interfaces:**
- Produces: `coach_listings` table, `coach_listing_availability` table, `bookings.listing_id` (nullable FK), `files.access_level` accepting `'PUBLIC'`. One `coach_listings` row (+ matching availability rows) is backfilled for every currently `is_listed = TRUE` coach; existing `bookings` rows are backfilled with the matching listing's id where a match exists.

- [ ] **Step 1: Write the migration file**

```sql
-- database/patches/0021_coach_listings.sql
-- Coach listings: a coach's marketplace presence moves from single fields
-- on coach_profiles to one-or-more independently bookable listings, each
-- with its own price/duration/schedule/photo/video. Purely additive here —
-- old coach_profiles marketplace columns, coach_availability_templates,
-- and the old /api/coaches/* routes are untouched and keep working; they
-- are retired in a later task once the new coach-listings API fully
-- replaces them. See docs/superpowers/specs/2026-09-10-coach-listings-design.md.

CREATE TABLE coach_listings (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_user_id            UUID NOT NULL REFERENCES coach_profiles(user_id) ON DELETE CASCADE,
    title                    TEXT NOT NULL,
    description              TEXT,
    is_listed                BOOLEAN NOT NULL DEFAULT FALSE,
    price_per_session        NUMERIC(10, 2),
    currency                 TEXT NOT NULL DEFAULT 'RUB',
    offers_online            BOOLEAN NOT NULL DEFAULT FALSE,
    offers_offline           BOOLEAN NOT NULL DEFAULT FALSE,
    location                 TEXT,
    session_duration_minutes SMALLINT CHECK (session_duration_minutes > 0),
    photo_file_id            UUID REFERENCES files(id),
    video_file_id            UUID REFERENCES files(id),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at                TIMESTAMPTZ
);

CREATE INDEX coach_listings_by_coach ON coach_listings(coach_user_id) WHERE deleted_at IS NULL;

CREATE TABLE coach_listing_availability (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id  UUID NOT NULL REFERENCES coach_listings(id) ON DELETE CASCADE,
    weekday     SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_time  TIME NOT NULL,
    end_time    TIME NOT NULL CHECK (end_time > start_time),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX coach_listing_availability_by_listing ON coach_listing_availability(listing_id);

-- Nullable, permanently — see Global Constraints. Not backed by a
-- NOT NULL constraint; "a new booking always has one" is enforced at the
-- Pydantic/route layer (BookingIn.listing_id is a required field), not here.
ALTER TABLE bookings ADD COLUMN listing_id UUID REFERENCES coach_listings(id);

ALTER TABLE files DROP CONSTRAINT files_access_level_check;
ALTER TABLE files ADD CONSTRAINT files_access_level_check
    CHECK (access_level IN ('PRIVATE', 'TEAM', 'COACHES_ONLY', 'PUBLIC'));

-- One-time data migration: give every currently-listed coach a matching
-- listing + copy of their weekly schedule, so existing marketplace data
-- isn't orphaned once the new listing-centric API and frontend take over.
INSERT INTO coach_listings (
    coach_user_id, title, is_listed, price_per_session, currency,
    offers_online, offers_offline, location, session_duration_minutes
)
SELECT user_id, 'Тренировки', is_listed, price_per_session, currency,
       offers_online, offers_offline, location, session_duration_minutes
FROM coach_profiles
WHERE is_listed = TRUE;

INSERT INTO coach_listing_availability (listing_id, weekday, start_time, end_time)
SELECT cl.id, cat.weekday, cat.start_time, cat.end_time
FROM coach_availability_templates cat
JOIN coach_listings cl ON cl.coach_user_id = cat.coach_user_id;

-- Backfill listing_id on existing bookings by matching coach_user_id to
-- the listing just created for that coach (safe 1:1 — a coach had exactly
-- one bookable service before this feature, so every existing booking
-- maps unambiguously to the one listing created for its coach above). Any
-- booking whose coach has no coach_listings row (i.e. the coach was never
-- listed) is left with listing_id = NULL, same as any future gap — this
-- column is nullable exactly for this reason.
UPDATE bookings b
SET listing_id = cl.id
FROM coach_listings cl
WHERE cl.coach_user_id = b.coach_user_id AND b.listing_id IS NULL;
```

- [ ] **Step 2: Apply it against the running dev stack and verify**

```bash
docker compose -f docker-compose.dev.yml restart backend
docker compose -f docker-compose.dev.yml logs backend --tail=30
```

Expected: no migration errors, `Application startup complete.`. Then:

```bash
source .env
docker compose -f docker-compose.dev.yml exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\d coach_listings"
docker compose -f docker-compose.dev.yml exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\d coach_listing_availability"
docker compose -f docker-compose.dev.yml exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT id, coach_user_id, title, is_listed FROM coach_listings;"
docker compose -f docker-compose.dev.yml exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FILTER (WHERE listing_id IS NOT NULL) AS with_listing, count(*) FILTER (WHERE listing_id IS NULL) AS without FROM bookings;"
```

Expected: both new tables exist with the columns above; at least one `coach_listings` row exists (backfilled from whichever coach is currently listed in the dev DB — e.g. "Smoke Coach"); the bookings count query shows existing bookings now have `listing_id` set (all of them, if — as verified live in this dev DB before writing this plan — every existing booking's coach is currently listed).

- [ ] **Step 3: Run the full backend suite (must be unaffected — purely additive)**

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest -q
```

Expected: same pass count as before this task (193), no failures — nothing in Python code references the new tables/column yet.

- [ ] **Step 4: Commit**

```bash
git add database/patches/0021_coach_listings.sql
git commit -m "feat: add coach_listings schema (additive — old marketplace tables untouched)"
```

---

### Task 2: Listing management — create/list/update/delete + per-listing availability

**Files:**
- Create: `backend/app/repositories/coach_listings.py`
- Create: `backend/app/schemas/coach_listing.py`
- Create: `backend/app/api/routes/coach_listings.py`
- Modify: `backend/app/main.py` (register the new router)
- Modify: `backend/tests/conftest.py` (new `coach_listings_module` fakes)
- Create: `backend/tests/test_coach_listings_api.py`

**Interfaces:**
- Produces: `coach_listings_repo.create_listing(conn, coach_user_id, *, title) -> dict`, `get_listing(conn, listing_id) -> dict | None`, `list_for_coach(conn, coach_user_id) -> list[dict]`, `update_listing(conn, listing_id, coach_user_id, **fields) -> dict | None`, `soft_delete_listing(conn, listing_id, coach_user_id) -> bool`, `has_active_booking(conn, listing_id) -> bool`, `list_availability(conn, listing_id) -> list[dict]`, `replace_availability(conn, listing_id, windows) -> list[dict]`, `has_overlap(windows) -> bool`. Routes: `POST /api/coach-listings`, `GET /api/coach-listings/me`, `PUT /api/coach-listings/{id}`, `DELETE /api/coach-listings/{id}`, `GET/PUT /api/coach-listings/{id}/availability`. Later tasks (3, 4, 5) consume `get_listing`, `list_availability`, and the router's `_get_owned_listing_or_404` pattern.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_coach_listings_api.py`:

```python
from __future__ import annotations

from tests.test_teams_api import _create_coach_profile


def _listing_payload(**overrides):
    payload = {
        "title": "Индивидуальные тренировки",
        "description": "Работаем над техникой и физикой",
        "is_listed": False,
        "price_per_session": 2000,
        "currency": "RUB",
        "offers_online": True,
        "offers_offline": False,
        "location": None,
        "session_duration_minutes": 60,
    }
    payload.update(overrides)
    return payload


def test_coach_can_create_and_list_own_listings(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)

    create_resp = client.post("/api/coach-listings", headers=headers, json=_listing_payload())
    assert create_resp.status_code == 200, create_resp.text
    listing = create_resp.json()
    assert listing["title"] == "Индивидуальные тренировки"
    assert listing["is_listed"] is False

    mine = client.get("/api/coach-listings/me", headers=headers).json()
    assert len(mine) == 1
    assert mine[0]["id"] == listing["id"]


def test_creating_a_listing_requires_coach_profile(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.post("/api/coach-listings", headers=headers, json=_listing_payload())
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "coach_profile_required"


def test_new_listing_cannot_be_created_already_listed(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)

    resp = client.post("/api/coach-listings", headers=headers, json=_listing_payload(is_listed=True))
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "availability_required"


def test_coach_can_have_multiple_independent_listings(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)

    first = client.post("/api/coach-listings", headers=headers, json=_listing_payload(title="Индивидуальные")).json()
    second = client.post(
        "/api/coach-listings", headers=headers, json=_listing_payload(title="Групповые", session_duration_minutes=90)
    ).json()

    mine = client.get("/api/coach-listings/me", headers=headers).json()
    assert {l["id"] for l in mine} == {first["id"], second["id"]}
    titles = {l["title"] for l in mine}
    assert titles == {"Индивидуальные", "Групповые"}


def test_update_listing_requires_availability_before_listing(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)
    listing = client.post("/api/coach-listings", headers=headers, json=_listing_payload()).json()

    resp = client.put(
        f"/api/coach-listings/{listing['id']}", headers=headers, json=_listing_payload(is_listed=True)
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "availability_required"

    client.put(
        f"/api/coach-listings/{listing['id']}/availability",
        headers=headers,
        json=[{"weekday": 0, "start_time": "10:00:00", "end_time": "12:00:00"}],
    )
    resp2 = client.put(
        f"/api/coach-listings/{listing['id']}", headers=headers, json=_listing_payload(is_listed=True)
    )
    assert resp2.status_code == 200, resp2.text
    assert resp2.json()["is_listed"] is True


def test_two_listings_have_independent_availability(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)
    first = client.post("/api/coach-listings", headers=headers, json=_listing_payload(title="A")).json()
    second = client.post("/api/coach-listings", headers=headers, json=_listing_payload(title="B")).json()

    client.put(
        f"/api/coach-listings/{first['id']}/availability",
        headers=headers,
        json=[{"weekday": 0, "start_time": "10:00:00", "end_time": "12:00:00"}],
    )
    client.put(
        f"/api/coach-listings/{second['id']}/availability",
        headers=headers,
        json=[{"weekday": 3, "start_time": "14:00:00", "end_time": "16:00:00"}],
    )

    first_avail = client.get(f"/api/coach-listings/{first['id']}/availability", headers=headers).json()
    second_avail = client.get(f"/api/coach-listings/{second['id']}/availability", headers=headers).json()
    assert {w["weekday"] for w in first_avail} == {0}
    assert {w["weekday"] for w in second_avail} == {3}


def test_overlapping_availability_windows_rejected(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)
    listing = client.post("/api/coach-listings", headers=headers, json=_listing_payload()).json()

    resp = client.put(
        f"/api/coach-listings/{listing['id']}/availability",
        headers=headers,
        json=[
            {"weekday": 0, "start_time": "10:00:00", "end_time": "12:00:00"},
            {"weekday": 0, "start_time": "11:00:00", "end_time": "13:00:00"},
        ],
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "overlapping_availability"


def test_other_coach_cannot_see_or_edit_a_listing_they_do_not_own(logged_in_client, login_as) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)
    listing = client.post("/api/coach-listings", headers=headers, json=_listing_payload()).json()

    other_token = login_as(870001, first_name="OtherCoach")
    other_headers = {"Authorization": f"Bearer {other_token}"}
    _create_coach_profile(client, other_token)

    resp = client.put(f"/api/coach-listings/{listing['id']}", headers=other_headers, json=_listing_payload())
    assert resp.status_code == 404


def test_delete_listing(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)
    listing = client.post("/api/coach-listings", headers=headers, json=_listing_payload()).json()

    resp = client.delete(f"/api/coach-listings/{listing['id']}", headers=headers)
    assert resp.status_code == 204

    mine = client.get("/api/coach-listings/me", headers=headers).json()
    assert mine == []
```

- [ ] **Step 2: Run it to verify it fails**

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest tests/test_coach_listings_api.py -v
```

Expected: FAIL — `404 Not Found` for every route (nothing exists yet).

- [ ] **Step 3: Write the repository**

Create `backend/app/repositories/coach_listings.py`:

```python
"""Data access for coach listings — one or more independently bookable
services per coach, each with its own price/duration/schedule/photo/
video. All queries are parameterized."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

_LISTING_FIELDS = (
    "id, coach_user_id, title, description, is_listed, price_per_session, currency, "
    "offers_online, offers_offline, location, session_duration_minutes, photo_file_id, video_file_id"
)


async def create_listing(conn: asyncpg.Connection, coach_user_id: UUID, *, title: str) -> dict[str, Any]:
    row = await conn.fetchrow(
        f"INSERT INTO coach_listings (coach_user_id, title) VALUES ($1, $2) RETURNING {_LISTING_FIELDS}",
        coach_user_id,
        title,
    )
    return dict(row)


async def get_listing(conn: asyncpg.Connection, listing_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"SELECT {_LISTING_FIELDS} FROM coach_listings WHERE id = $1 AND deleted_at IS NULL", listing_id
    )
    return dict(row) if row else None


async def list_for_coach(conn: asyncpg.Connection, coach_user_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"SELECT {_LISTING_FIELDS} FROM coach_listings WHERE coach_user_id = $1 AND deleted_at IS NULL ORDER BY created_at",
        coach_user_id,
    )
    return [dict(row) for row in rows]


async def update_listing(
    conn: asyncpg.Connection,
    listing_id: UUID,
    coach_user_id: UUID,
    *,
    title: str,
    description: str | None,
    is_listed: bool,
    price_per_session,
    currency: str,
    offers_online: bool,
    offers_offline: bool,
    location: str | None,
    session_duration_minutes: int | None,
) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"""
        UPDATE coach_listings SET
            title = $3, description = $4, is_listed = $5, price_per_session = $6, currency = $7,
            offers_online = $8, offers_offline = $9, location = $10, session_duration_minutes = $11,
            updated_at = now()
        WHERE id = $1 AND coach_user_id = $2 AND deleted_at IS NULL
        RETURNING {_LISTING_FIELDS}
        """,
        listing_id,
        coach_user_id,
        title,
        description,
        is_listed,
        price_per_session,
        currency,
        offers_online,
        offers_offline,
        location,
        session_duration_minutes,
    )
    return dict(row) if row else None


async def has_active_booking(conn: asyncpg.Connection, listing_id: UUID) -> bool:
    """True if this listing has a request awaiting the coach's response, or
    a confirmed booking whose session hasn't happened yet — either should
    block deleting the listing out from under it. A confirmed-and-already-
    completed booking does NOT block deletion."""
    return await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM bookings WHERE listing_id = $1 AND ("
        "status = 'pending' OR "
        "(status = 'confirmed' AND starts_at + (duration_minutes || ' minutes')::interval > now())"
        "))",
        listing_id,
    )


async def soft_delete_listing(conn: asyncpg.Connection, listing_id: UUID, coach_user_id: UUID) -> bool:
    result = await conn.execute(
        "UPDATE coach_listings SET deleted_at = now() WHERE id = $1 AND coach_user_id = $2 AND deleted_at IS NULL",
        listing_id,
        coach_user_id,
    )
    return result.endswith("1")


_AVAILABILITY_FIELDS = "id, weekday, start_time, end_time"


def _windows_overlap(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return a["weekday"] == b["weekday"] and a["start_time"] < b["end_time"] and b["start_time"] < a["end_time"]


def has_overlap(windows: list[dict[str, Any]]) -> bool:
    return any(_windows_overlap(a, b) for i, a in enumerate(windows) for b in windows[i + 1 :])


async def list_availability(conn: asyncpg.Connection, listing_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"SELECT {_AVAILABILITY_FIELDS} FROM coach_listing_availability "
        "WHERE listing_id = $1 ORDER BY weekday, start_time",
        listing_id,
    )
    return [dict(row) for row in rows]


async def replace_availability(
    conn: asyncpg.Connection, listing_id: UUID, windows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    async with conn.transaction():
        await conn.execute("DELETE FROM coach_listing_availability WHERE listing_id = $1", listing_id)
        inserted = []
        for window in windows:
            row = await conn.fetchrow(
                f"""
                INSERT INTO coach_listing_availability (listing_id, weekday, start_time, end_time)
                VALUES ($1, $2, $3, $4)
                RETURNING {_AVAILABILITY_FIELDS}
                """,
                listing_id,
                window["weekday"],
                window["start_time"],
                window["end_time"],
            )
            inserted.append(dict(row))
        return inserted
```

- [ ] **Step 4: Write the schemas**

Create `backend/app/schemas/coach_listing.py`:

```python
from __future__ import annotations

from datetime import time
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class CoachListingIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    is_listed: bool
    price_per_session: float | None = Field(default=None, ge=0)
    currency: str = Field(default="RUB", min_length=3, max_length=3)
    offers_online: bool = False
    offers_offline: bool = False
    location: str | None = Field(default=None, max_length=200)
    session_duration_minutes: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _validate_listing_requirements(self) -> "CoachListingIn":
        if not self.is_listed:
            return self
        if not (self.offers_online or self.offers_offline):
            raise ValueError("choose at least one training format before listing")
        if self.price_per_session is None:
            raise ValueError("set a price before listing")
        if self.session_duration_minutes is None:
            raise ValueError("set a session duration before listing")
        return self


class CoachListingOut(BaseModel):
    id: UUID
    coach_user_id: UUID
    title: str
    description: str | None
    is_listed: bool
    price_per_session: float | None
    currency: str
    offers_online: bool
    offers_offline: bool
    location: str | None
    session_duration_minutes: int | None
    photo_file_id: UUID | None
    video_file_id: UUID | None


class AvailabilityWindowIn(BaseModel):
    weekday: int = Field(ge=0, le=6)
    start_time: time
    end_time: time

    @model_validator(mode="after")
    def _validate_range(self) -> "AvailabilityWindowIn":
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self


class AvailabilityWindowOut(BaseModel):
    id: UUID
    weekday: int
    start_time: time
    end_time: time
```

- [ ] **Step 5: Write the routes**

Create `backend/app/api/routes/coach_listings.py`:

```python
from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db
from app.core.exceptions import APIError, NotFoundError
from app.repositories import coach_listings as listings_repo
from app.repositories import profiles as profiles_repo
from app.schemas.coach_listing import (
    AvailabilityWindowIn,
    AvailabilityWindowOut,
    CoachListingIn,
    CoachListingOut,
)

router = APIRouter(prefix="/api/coach-listings", tags=["coach-listings"])


def _require_coach_profile_error() -> APIError:
    return APIError(
        "create a coach profile before managing listings", code="coach_profile_required", status_code=409
    )


async def _get_owned_listing_or_404(conn: asyncpg.Connection, listing_id: UUID, coach_user_id: UUID) -> dict:
    listing = await listings_repo.get_listing(conn, listing_id)
    if listing is None or listing["coach_user_id"] != coach_user_id:
        raise NotFoundError("listing not found")
    return listing


@router.post("", response_model=CoachListingOut)
async def create_listing(
    payload: CoachListingIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> CoachListingOut:
    if await profiles_repo.get_coach_profile(conn, user["id"]) is None:
        raise _require_coach_profile_error()
    if payload.is_listed:
        # A brand-new listing has no availability windows yet (they can
        # only be added after it exists), so is_listed=true is never valid
        # on creation — same rule PUT enforces once windows can exist.
        raise APIError(
            "set availability before publishing a brand-new listing",
            code="availability_required",
            status_code=409,
        )
    listing = await listings_repo.create_listing(conn, user["id"], title=payload.title)
    updated = await listings_repo.update_listing(conn, listing["id"], user["id"], **payload.model_dump())
    assert updated is not None
    return CoachListingOut(**updated)


@router.get("/me", response_model=list[CoachListingOut])
async def list_my_listings(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[CoachListingOut]:
    listings = await listings_repo.list_for_coach(conn, user["id"])
    return [CoachListingOut(**listing) for listing in listings]


@router.put("/{listing_id}", response_model=CoachListingOut)
async def update_listing(
    listing_id: UUID,
    payload: CoachListingIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> CoachListingOut:
    await _get_owned_listing_or_404(conn, listing_id, user["id"])
    if payload.is_listed:
        availability = await listings_repo.list_availability(conn, listing_id)
        if not availability:
            raise APIError(
                "set at least one availability window before listing",
                code="availability_required",
                status_code=409,
            )
    updated = await listings_repo.update_listing(conn, listing_id, user["id"], **payload.model_dump())
    assert updated is not None
    return CoachListingOut(**updated)


@router.delete("/{listing_id}", status_code=204, response_model=None)
async def delete_listing(
    listing_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    await _get_owned_listing_or_404(conn, listing_id, user["id"])
    if await listings_repo.has_active_booking(conn, listing_id):
        raise APIError(
            "cannot delete a listing with a pending request or an upcoming confirmed booking",
            code="listing_has_active_booking",
            status_code=409,
        )
    deleted = await listings_repo.soft_delete_listing(conn, listing_id, user["id"])
    if not deleted:
        raise NotFoundError("listing not found")


@router.get("/{listing_id}/availability", response_model=list[AvailabilityWindowOut])
async def get_listing_availability(
    listing_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[AvailabilityWindowOut]:
    await _get_owned_listing_or_404(conn, listing_id, user["id"])
    windows = await listings_repo.list_availability(conn, listing_id)
    return [AvailabilityWindowOut(**w) for w in windows]


@router.put("/{listing_id}/availability", response_model=list[AvailabilityWindowOut])
async def replace_listing_availability(
    listing_id: UUID,
    payload: list[AvailabilityWindowIn],
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[AvailabilityWindowOut]:
    await _get_owned_listing_or_404(conn, listing_id, user["id"])
    windows = [w.model_dump() for w in payload]
    if listings_repo.has_overlap(windows):
        raise APIError("availability windows overlap", code="overlapping_availability", status_code=400)
    updated = await listings_repo.replace_availability(conn, listing_id, windows)
    return [AvailabilityWindowOut(**w) for w in updated]
```

- [ ] **Step 6: Register the router**

In `backend/app/main.py`, add `coach_listings` to the `from app.api.routes import (...)` block (alphabetically, near `coaches`), and add `app.include_router(coach_listings.router)` near the existing `app.include_router(coaches.router)` line (leave that old line in place — both routers coexist).

- [ ] **Step 7: Add the conftest fakes**

In `backend/tests/conftest.py`, add near the existing `coach_marketplace_module` fakes block (after it, not replacing it — that block stays untouched for the old tests):

```python
    import app.repositories.coach_listings as coach_listings_module

    listings_store: dict = {}
    listing_availability_store: dict = {}  # listing_id -> list[window dict]

    async def fake_create_listing(conn, coach_user_id, *, title):
        listing_id = uuid4()
        record = {
            "id": listing_id,
            "coach_user_id": coach_user_id,
            "title": title,
            "description": None,
            "is_listed": False,
            "price_per_session": None,
            "currency": "RUB",
            "offers_online": False,
            "offers_offline": False,
            "location": None,
            "session_duration_minutes": None,
            "photo_file_id": None,
            "video_file_id": None,
        }
        listings_store[listing_id] = record
        return dict(record)

    async def fake_get_listing(conn, listing_id):
        record = listings_store.get(listing_id)
        return dict(record) if record else None

    async def fake_list_for_coach(conn, coach_user_id):
        return [dict(r) for r in listings_store.values() if r["coach_user_id"] == coach_user_id]

    async def fake_update_listing(conn, listing_id, coach_user_id, **fields):
        record = listings_store.get(listing_id)
        if record is None or record["coach_user_id"] != coach_user_id:
            return None
        record.update(fields)
        return dict(record)

    async def fake_has_active_booking(conn, listing_id):
        now = datetime.now(timezone.utc)
        for b in bookings_store.values():
            if b.get("listing_id") != listing_id:
                continue
            if b["status"] == "pending":
                return True
            if b["status"] == "confirmed" and b["starts_at"] + timedelta(minutes=b["duration_minutes"]) > now:
                return True
        return False

    async def fake_soft_delete_listing(conn, listing_id, coach_user_id):
        record = listings_store.get(listing_id)
        if record is None or record["coach_user_id"] != coach_user_id:
            return False
        del listings_store[listing_id]
        return True

    async def fake_list_listing_availability(conn, listing_id):
        return sorted(
            [dict(w) for w in listing_availability_store.get(listing_id, [])],
            key=lambda w: (w["weekday"], w["start_time"]),
        )

    async def fake_replace_listing_availability(conn, listing_id, windows):
        stored = [{"id": uuid4(), **w} for w in windows]
        listing_availability_store[listing_id] = stored
        return stored

    monkeypatch.setattr(coach_listings_module, "create_listing", fake_create_listing)
    monkeypatch.setattr(coach_listings_module, "get_listing", fake_get_listing)
    monkeypatch.setattr(coach_listings_module, "list_for_coach", fake_list_for_coach)
    monkeypatch.setattr(coach_listings_module, "update_listing", fake_update_listing)
    monkeypatch.setattr(coach_listings_module, "has_active_booking", fake_has_active_booking)
    monkeypatch.setattr(coach_listings_module, "soft_delete_listing", fake_soft_delete_listing)
    monkeypatch.setattr(coach_listings_module, "list_availability", fake_list_listing_availability)
    monkeypatch.setattr(coach_listings_module, "replace_availability", fake_replace_listing_availability)
    # coach_listings_module.has_overlap is a plain function — not faked, runs for real in tests.
```

Place this block after the existing `bookings_store: dict = {}` declaration (it's needed by `fake_has_active_booking`) and after `from datetime import ... timedelta ...` is already imported at module level (it is, per the file's existing imports).

- [ ] **Step 8: Run the tests**

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest tests/test_coach_listings_api.py -v
```

Expected: all PASS.

- [ ] **Step 9: Run the full suite**

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest -q
```

Expected: 193 + the new tests, all passing — `test_coach_marketplace_api.py` untouched and still green.

- [ ] **Step 10: Commit**

```bash
git add backend/app/repositories/coach_listings.py backend/app/schemas/coach_listing.py backend/app/api/routes/coach_listings.py backend/app/main.py backend/tests/conftest.py backend/tests/test_coach_listings_api.py
git commit -m "feat: add coach-listing management CRUD and per-listing availability"
```

---

### Task 3: Listing photo/video upload

**Files:**
- Modify: `backend/app/repositories/files.py` (add `replace_listing_photo`, `replace_listing_video`)
- Modify: `backend/app/api/routes/files.py` (harden the `access_level` branch with an explicit `PUBLIC` case + a defensive `else`)
- Modify: `backend/app/api/routes/coach_listings.py` (add upload routes)
- Modify: `backend/tests/conftest.py` (extend `files_module` fakes)
- Modify: `backend/tests/test_coach_listings_api.py`

**Interfaces:**
- Consumes: `listings_repo.get_listing` (Task 2), `app.services.uploads.{IMAGE_MIME_EXTENSIONS, VIDEO_MIME_EXTENSIONS, FileTooLarge, upload_to_disk}` (existing), `app.integrations.paths.build_user_file_path` (existing), `files_repo.create_file` (existing).
- Produces: `files_repo.replace_listing_photo(conn, listing_id, new_file_id) -> UUID | None`, `replace_listing_video(conn, listing_id, new_file_id) -> UUID | None`. Routes: `POST /api/coach-listings/{id}/photo`, `POST /api/coach-listings/{id}/video`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_coach_listings_api.py`:

```python
import io


def test_upload_and_replace_listing_photo(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)
    listing = client.post("/api/coach-listings", headers=headers, json=_listing_payload()).json()

    first = client.post(
        f"/api/coach-listings/{listing['id']}/photo",
        headers=headers,
        files={"file": ("photo.jpg", io.BytesIO(b"fake-jpeg-bytes"), "image/jpeg")},
    )
    assert first.status_code == 200, first.text
    first_file_id = first.json()["photo_file_id"]
    assert first_file_id is not None

    second = client.post(
        f"/api/coach-listings/{listing['id']}/photo",
        headers=headers,
        files={"file": ("photo2.jpg", io.BytesIO(b"other-fake-jpeg-bytes"), "image/jpeg")},
    )
    assert second.status_code == 200, second.text
    second_file_id = second.json()["photo_file_id"]
    assert second_file_id != first_file_id

    # Old file is gone (soft-deleted), new one is servable.
    old_get = client.get(f"/api/files/{first_file_id}", headers=headers)
    assert old_get.status_code == 404
    new_get = client.get(f"/api/files/{second_file_id}", headers=headers)
    assert new_get.status_code == 200


def test_upload_listing_video_wrong_type_rejected(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)
    listing = client.post("/api/coach-listings", headers=headers, json=_listing_payload()).json()

    resp = client.post(
        f"/api/coach-listings/{listing['id']}/video",
        headers=headers,
        files={"file": ("clip.txt", io.BytesIO(b"not a video"), "text/plain")},
    )
    assert resp.status_code == 415
    assert resp.json()["error"]["code"] == "unsupported_media_type"


def test_cannot_upload_photo_to_another_coachs_listing(logged_in_client, login_as) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)
    listing = client.post("/api/coach-listings", headers=headers, json=_listing_payload()).json()

    other_token = login_as(870002, first_name="OtherCoach")
    other_headers = {"Authorization": f"Bearer {other_token}"}

    resp = client.post(
        f"/api/coach-listings/{listing['id']}/photo",
        headers=other_headers,
        files={"file": ("photo.jpg", io.BytesIO(b"bytes"), "image/jpeg")},
    )
    assert resp.status_code == 404
```

- [ ] **Step 2: Run it to verify it fails**

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest tests/test_coach_listings_api.py -k photo -v
```

Expected: FAIL — `404 Not Found` for the upload routes (don't exist yet).

- [ ] **Step 3: Add the repository functions**

In `backend/app/repositories/files.py`, add (mirroring `replace_team_logo`'s exact soft-delete-old-then-repoint pattern):

```python
async def replace_listing_photo(conn: asyncpg.Connection, listing_id: UUID, new_file_id: UUID) -> UUID | None:
    """Point the listing at the new photo file and soft-delete the previous
    one (if any) — same pattern as replace_team_logo."""
    async with conn.transaction():
        old_file_id = await conn.fetchval(
            "SELECT photo_file_id FROM coach_listings WHERE id = $1 FOR UPDATE", listing_id
        )
        await conn.execute(
            "UPDATE coach_listings SET photo_file_id = $2, updated_at = now() WHERE id = $1",
            listing_id,
            new_file_id,
        )
        if old_file_id is not None:
            await conn.execute("UPDATE files SET deleted_at = now() WHERE id = $1", old_file_id)
    return old_file_id


async def replace_listing_video(conn: asyncpg.Connection, listing_id: UUID, new_file_id: UUID) -> UUID | None:
    async with conn.transaction():
        old_file_id = await conn.fetchval(
            "SELECT video_file_id FROM coach_listings WHERE id = $1 FOR UPDATE", listing_id
        )
        await conn.execute(
            "UPDATE coach_listings SET video_file_id = $2, updated_at = now() WHERE id = $1",
            listing_id,
            new_file_id,
        )
        if old_file_id is not None:
            await conn.execute("UPDATE files SET deleted_at = now() WHERE id = $1", old_file_id)
    return old_file_id
```

- [ ] **Step 4: Harden the download route's access-control branch**

In `backend/app/api/routes/files.py`'s `download_file`, the current `if/elif` (no `else`) means any access_level other than `PRIVATE`/`TEAM`/`COACHES_ONLY` already falls through unrestricted. Make that explicit and add a safety net for any *future* unhandled value, changing:

```python
    elif access_level in ("TEAM", "COACHES_ONLY"):
        member = None
        if file_record["team_id"] is not None:
            member = await teams_repo.get_member(conn, file_record["team_id"], user["id"])
        if member is None:
            raise ForbiddenError("you do not have access to this file")
        if access_level == "COACHES_ONLY" and member["role"] not in ("head_coach", "assistant_coach"):
            raise ForbiddenError("you do not have access to this file")
```

to:

```python
    elif access_level in ("TEAM", "COACHES_ONLY"):
        member = None
        if file_record["team_id"] is not None:
            member = await teams_repo.get_member(conn, file_record["team_id"], user["id"])
        if member is None:
            raise ForbiddenError("you do not have access to this file")
        if access_level == "COACHES_ONLY" and member["role"] not in ("head_coach", "assistant_coach"):
            raise ForbiddenError("you do not have access to this file")
    elif access_level == "PUBLIC":
        pass  # any authenticated user may view a public coach-listing photo/video
    else:
        raise ForbiddenError("you do not have access to this file")
```

- [ ] **Step 5: Add the upload routes**

In `backend/app/api/routes/coach_listings.py`, add the imports:

```python
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, UploadFile

from app.config import Settings
from app.api.deps import get_current_user, get_db, get_settings_dep
from app.integrations.paths import build_user_file_path
from app.integrations.yandex_disk import YandexDiskError
from app.repositories import files as files_repo
from app.services.uploads import IMAGE_MIME_EXTENSIONS, VIDEO_MIME_EXTENSIONS, FileTooLarge, upload_to_disk
```

(merge with the existing import lines — `UUID`/`APIRouter`/`Depends`/`get_current_user`/`get_db` are already imported; add `uuid4`, `UploadFile`, `Settings`, `get_settings_dep`, and the four new modules.)

Then add, at the end of the file:

```python
async def _upload_listing_media(
    listing_id: UUID,
    file: UploadFile,
    user: dict,
    conn: asyncpg.Connection,
    settings: Settings,
    *,
    category: str,
    allowed_types: dict[str, str],
    max_size_mb: int,
) -> CoachListingOut:
    await _get_owned_listing_or_404(conn, listing_id, user["id"])

    if file.content_type not in allowed_types:
        kind = "image" if category == "photo" else "video"
        raise APIError(
            f"file must be a {kind} ({', '.join(allowed_types)})", code="unsupported_media_type", status_code=415
        )

    max_bytes = max_size_mb * 1024 * 1024
    chunk_size = settings.upload_chunk_size_kb * 1024
    file_id = uuid4()
    extension = allowed_types[file.content_type]
    disk_path = build_user_file_path(
        settings.yandex_disk_root_folder,
        settings.app_mode,
        user["id"],
        f"listings/{listing_id}/{category}",
        file_id,
        extension,
    )

    try:
        size_bytes = await upload_to_disk(settings, disk_path, file, max_bytes, chunk_size)
    except RuntimeError as exc:
        raise APIError(str(exc), code="yandex_disk_not_configured", status_code=503) from exc
    except FileTooLarge as exc:
        raise APIError(f"file must be smaller than {max_size_mb} MB", code="file_too_large", status_code=413) from exc
    except YandexDiskError as exc:
        raise APIError("failed to store the file", code="storage_error", status_code=502) from exc

    file_record = await files_repo.create_file(
        conn,
        owner_id=user["id"],
        team_id=None,
        entity_type=f"coach_listing_{category}",
        entity_id=listing_id,
        disk_path=disk_path,
        filename=file.filename or f"{file_id}.{extension}",
        mime_type=file.content_type,
        size_bytes=size_bytes,
        access_level="PUBLIC",
    )
    if category == "photo":
        await files_repo.replace_listing_photo(conn, listing_id, file_record["id"])
    else:
        await files_repo.replace_listing_video(conn, listing_id, file_record["id"])
    updated = await listings_repo.get_listing(conn, listing_id)
    assert updated is not None
    return CoachListingOut(**updated)


@router.post("/{listing_id}/photo", response_model=CoachListingOut)
async def upload_listing_photo(
    listing_id: UUID,
    file: UploadFile,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> CoachListingOut:
    return await _upload_listing_media(
        listing_id,
        file,
        user,
        conn,
        settings,
        category="photo",
        allowed_types=IMAGE_MIME_EXTENSIONS,
        max_size_mb=settings.max_image_size_mb,
    )


@router.post("/{listing_id}/video", response_model=CoachListingOut)
async def upload_listing_video(
    listing_id: UUID,
    file: UploadFile,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> CoachListingOut:
    return await _upload_listing_media(
        listing_id,
        file,
        user,
        conn,
        settings,
        category="video",
        allowed_types=VIDEO_MIME_EXTENSIONS,
        max_size_mb=settings.max_video_size_mb,
    )
```

- [ ] **Step 6: Extend the conftest fakes**

In `backend/tests/conftest.py`, add near the existing `fake_replace_team_logo`:

```python
    async def fake_replace_listing_photo(conn, listing_id, new_file_id):
        old_file_id = listings_store[listing_id].get("photo_file_id")
        listings_store[listing_id]["photo_file_id"] = new_file_id
        if old_file_id is not None and old_file_id in files_store:
            files_store[old_file_id]["deleted_at"] = datetime.now(timezone.utc)
        return old_file_id

    async def fake_replace_listing_video(conn, listing_id, new_file_id):
        old_file_id = listings_store[listing_id].get("video_file_id")
        listings_store[listing_id]["video_file_id"] = new_file_id
        if old_file_id is not None and old_file_id in files_store:
            files_store[old_file_id]["deleted_at"] = datetime.now(timezone.utc)
        return old_file_id

    monkeypatch.setattr(files_module, "replace_listing_photo", fake_replace_listing_photo)
    monkeypatch.setattr(files_module, "replace_listing_video", fake_replace_listing_video)
```

Place this immediately after the existing `monkeypatch.setattr(files_module, "replace_team_logo", fake_replace_team_logo)` line — `listings_store` and `files_store` are both already in scope by this point (Task 2 added the former, `files_store` already existed).

- [ ] **Step 7: Run the tests**

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest tests/test_coach_listings_api.py -v
```

Expected: all PASS.

- [ ] **Step 8: Run the full suite**

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest -q
```

Expected: all PASS, no regressions (the `download_file` hardening only adds a branch for a value — `PUBLIC` — nothing in the existing suite ever sets, so no existing test's behavior changes).

- [ ] **Step 9: Commit**

```bash
git add backend/app/repositories/files.py backend/app/api/routes/files.py backend/app/api/routes/coach_listings.py backend/tests/conftest.py backend/tests/test_coach_listings_api.py
git commit -m "feat: add coach-listing photo/video upload"
```

---

### Task 4: Public browsing — listing list, listing detail, open slots

**Files:**
- Modify: `backend/app/repositories/coach_listings.py` (add `list_listed`, `get_public_listing`, `compute_open_slots`, `_next_available_slot`)
- Modify: `backend/app/schemas/coach_listing.py` (add `CoachListingCardOut`, `CoachListingProfileOut`, `CoachReviewOut`, `OpenSlotOut`)
- Modify: `backend/app/api/routes/coach_listings.py` (add browsing routes)
- Modify: `backend/tests/conftest.py` (extend `coach_listings_module` fakes)
- Modify: `backend/tests/test_coach_listings_api.py`

**Interfaces:**
- Consumes: `coach_reviews_repo.get_rating_summary`, `list_recent_for_coach` (existing, unchanged).
- Produces: `listings_repo.list_listed(conn, *, sport=None, location=None, max_price=None, min_rating=None, training_format=None, min_experience_years=None) -> list[dict]`, `get_public_listing(conn, listing_id) -> dict | None`, `compute_open_slots(conn, listing_id, from_date, to_date) -> list[dict]`. Task 5 consumes `get_listing` (Task 2) and `compute_open_slots` from the booking-creation route.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_coach_listings_api.py`:

```python
from datetime import date, timedelta


def _list_a_listing(client, token, *, sport="Баскетбол") -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token, sport=sport)
    listing = client.post("/api/coach-listings", headers=headers, json=_listing_payload()).json()
    client.put(
        f"/api/coach-listings/{listing['id']}/availability",
        headers=headers,
        json=[{"weekday": 0, "start_time": "10:00:00", "end_time": "12:00:00"}],
    )
    resp = client.put(f"/api/coach-listings/{listing['id']}", headers=headers, json=_listing_payload(is_listed=True))
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_listed_listing_appears_in_public_list_and_profile(logged_in_client) -> None:
    client, token = logged_in_client
    listing = _list_a_listing(client, token)

    list_resp = client.get("/api/coach-listings", headers={"Authorization": f"Bearer {token}"})
    assert list_resp.status_code == 200
    assert any(c["id"] == listing["id"] for c in list_resp.json())

    profile_resp = client.get(f"/api/coach-listings/{listing['id']}", headers={"Authorization": f"Bearer {token}"})
    assert profile_resp.status_code == 200
    assert profile_resp.json()["sport"] == "Баскетбол"
    assert profile_resp.json()["average_rating"] is None
    assert profile_resp.json()["review_count"] == 0


def test_unlisted_listing_does_not_appear(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)
    client.post("/api/coach-listings", headers=headers, json=_listing_payload())

    resp = client.get("/api/coach-listings", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == []


def test_coach_with_two_listings_shows_two_cards(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)
    for title in ("Индивидуальные", "Групповые"):
        listing = client.post("/api/coach-listings", headers=headers, json=_listing_payload(title=title)).json()
        client.put(
            f"/api/coach-listings/{listing['id']}/availability",
            headers=headers,
            json=[{"weekday": 1, "start_time": "09:00:00", "end_time": "11:00:00"}],
        )
        client.put(f"/api/coach-listings/{listing['id']}", headers=headers, json=_listing_payload(title=title, is_listed=True))

    cards = client.get("/api/coach-listings", headers=headers).json()
    assert {c["title"] for c in cards} == {"Индивидуальные", "Групповые"}


def test_open_slots_computed_from_listing_availability(logged_in_client) -> None:
    client, token = logged_in_client
    listing = _list_a_listing(client, token)
    headers = {"Authorization": f"Bearer {token}"}

    today = date.today()
    days_until_monday = (7 - today.weekday()) % 7
    next_monday = today + timedelta(days=days_until_monday or 7)

    resp = client.get(
        f"/api/coach-listings/{listing['id']}/slots",
        params={"from_date": next_monday.isoformat(), "to_date": next_monday.isoformat()},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json() == [
        {"starts_at": f"{next_monday.isoformat()}T10:00:00Z", "duration_minutes": 60},
        {"starts_at": f"{next_monday.isoformat()}T11:00:00Z", "duration_minutes": 60},
    ]


def test_slots_not_found_for_unlisted_listing(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)
    listing = client.post("/api/coach-listings", headers=headers, json=_listing_payload()).json()

    resp = client.get(
        f"/api/coach-listings/{listing['id']}/slots",
        params={"from_date": date.today().isoformat(), "to_date": date.today().isoformat()},
        headers=headers,
    )
    assert resp.status_code == 404
```

- [ ] **Step 2: Run it to verify it fails**

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest tests/test_coach_listings_api.py -k "listing or slots" -v
```

Expected: FAIL — `404 Not Found` for `GET /api/coach-listings` and the slots route.

- [ ] **Step 3: Add the repository functions**

In `backend/app/repositories/coach_listings.py`, add the imports `from datetime import date, datetime, time, timedelta, timezone` (extend the existing `from typing import Any` line's neighboring imports) and `from app.repositories import coach_reviews as coach_reviews_repo`, then add:

```python
def _card_row_to_dict(row: dict[str, Any], coach_rating: dict[str, Any], next_slot: datetime | None) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"],
        "coach_user_id": row["coach_user_id"],
        "coach_full_name": row["coach_full_name"],
        "coach_photo_url": row["coach_photo_url"],
        "sport": row["sport"],
        "specialization": row["specialization"],
        "experience_years": row["experience_years"],
        "average_rating": coach_rating["average"],
        "review_count": coach_rating["count"],
        "price_per_session": row["price_per_session"],
        "currency": row["currency"],
        "location": row["location"],
        "offers_online": row["offers_online"],
        "offers_offline": row["offers_offline"],
        "photo_file_id": row["photo_file_id"],
        "next_available_slot": next_slot,
    }


async def list_listed(
    conn: asyncpg.Connection,
    *,
    sport: str | None = None,
    location: str | None = None,
    max_price: float | None = None,
    min_rating: float | None = None,
    training_format: str | None = None,
    min_experience_years: int | None = None,
) -> list[dict[str, Any]]:
    conditions = ["cl.is_listed = TRUE", "cl.deleted_at IS NULL"]
    params: list[Any] = []

    def add(condition: str, value: Any) -> None:
        params.append(value)
        conditions.append(condition.format(len(params)))

    if sport:
        add("cp.sport ILIKE '%' || ${} || '%'", sport)
    if location:
        add("cl.location ILIKE '%' || ${} || '%'", location)
    if max_price is not None:
        add("cl.price_per_session <= ${}", max_price)
    if min_experience_years is not None:
        add("cp.experience_years >= ${}", min_experience_years)
    if training_format == "online":
        conditions.append("cl.offers_online = TRUE")
    elif training_format == "offline":
        conditions.append("cl.offers_offline = TRUE")

    rows = await conn.fetch(
        f"""
        SELECT cl.id, cl.title, cl.description, cl.coach_user_id, cp.full_name AS coach_full_name,
               u.photo_url AS coach_photo_url, cp.sport, cp.specialization, cp.experience_years,
               cl.price_per_session, cl.currency, cl.location, cl.offers_online, cl.offers_offline,
               cl.photo_file_id
        FROM coach_listings cl
        JOIN coach_profiles cp ON cp.user_id = cl.coach_user_id
        JOIN users u ON u.id = cl.coach_user_id
        WHERE {" AND ".join(conditions)}
        ORDER BY cl.created_at
        """,
        *params,
    )

    cards = []
    for row in rows:
        row = dict(row)
        rating = await coach_reviews_repo.get_rating_summary(conn, row["coach_user_id"])
        if min_rating is not None and (rating["average"] or 0) < min_rating:
            continue
        next_slot = await _next_available_slot(conn, row["id"])
        cards.append(_card_row_to_dict(row, rating, next_slot))
    return cards


async def get_public_listing(conn: asyncpg.Connection, listing_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        """
        SELECT cl.id, cl.title, cl.description, cl.coach_user_id, cp.full_name AS coach_full_name,
               u.photo_url AS coach_photo_url, cp.sport, cp.specialization, cp.description AS coach_description,
               cp.experience_years, cl.price_per_session, cl.currency, cl.location, cl.offers_online,
               cl.offers_offline, cl.session_duration_minutes, cl.photo_file_id, cl.video_file_id
        FROM coach_listings cl
        JOIN coach_profiles cp ON cp.user_id = cl.coach_user_id
        JOIN users u ON u.id = cl.coach_user_id
        WHERE cl.id = $1 AND cl.is_listed = TRUE AND cl.deleted_at IS NULL
        """,
        listing_id,
    )
    if row is None:
        return None
    row = dict(row)
    rating = await coach_reviews_repo.get_rating_summary(conn, row["coach_user_id"])
    next_slot = await _next_available_slot(conn, listing_id)
    card = _card_row_to_dict(row, rating, next_slot)
    card["coach_description"] = row["coach_description"]
    card["session_duration_minutes"] = row["session_duration_minutes"]
    card["video_file_id"] = row["video_file_id"]
    card["availability"] = await list_availability(conn, listing_id)
    card["recent_reviews"] = await coach_reviews_repo.list_recent_for_coach(conn, row["coach_user_id"])
    return card


async def compute_open_slots(
    conn: asyncpg.Connection, listing_id: UUID, from_date: date, to_date: date
) -> list[dict[str, Any]]:
    listing = await get_listing(conn, listing_id)
    duration = (listing or {}).get("session_duration_minutes")
    if not duration:
        return []
    windows = await list_availability(conn, listing_id)
    # Booked-set is keyed on coach_user_id, not listing_id — a slot taken
    # via ANY of this coach's listings must disappear here too, since the
    # coach-wide double-booking guard spans every listing they own.
    booked_rows = await conn.fetch(
        "SELECT starts_at FROM bookings WHERE coach_user_id = $1 AND status IN ('pending', 'confirmed') "
        "AND starts_at >= $2 AND starts_at < $3",
        listing["coach_user_id"],
        datetime.combine(from_date, time.min, tzinfo=timezone.utc),
        datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=timezone.utc),
    )
    booked = {row["starts_at"] for row in booked_rows}

    slots: list[dict[str, Any]] = []
    day = from_date
    while day <= to_date:
        for window in windows:
            if window["weekday"] != day.weekday():
                continue
            cursor = datetime.combine(day, window["start_time"], tzinfo=timezone.utc)
            window_end = datetime.combine(day, window["end_time"], tzinfo=timezone.utc)
            while cursor + timedelta(minutes=duration) <= window_end:
                if cursor not in booked and cursor > datetime.now(timezone.utc):
                    slots.append({"starts_at": cursor, "duration_minutes": duration})
                cursor += timedelta(minutes=duration)
        day += timedelta(days=1)
    return sorted(slots, key=lambda s: s["starts_at"])


async def _next_available_slot(conn: asyncpg.Connection, listing_id: UUID) -> datetime | None:
    today = date.today()
    slots = await compute_open_slots(conn, listing_id, today, today + timedelta(days=28))
    return slots[0]["starts_at"] if slots else None
```

- [ ] **Step 4: Add the schemas**

In `backend/app/schemas/coach_listing.py`, add the import `from datetime import datetime` (extend the existing `from datetime import time` line to `from datetime import time, datetime`), then add:

```python
class CoachListingCardOut(BaseModel):
    id: UUID
    title: str
    description: str | None
    coach_user_id: UUID
    coach_full_name: str
    coach_photo_url: str | None
    sport: str
    specialization: str | None
    experience_years: int | None
    average_rating: float | None
    review_count: int
    price_per_session: float | None
    currency: str
    location: str | None
    offers_online: bool
    offers_offline: bool
    photo_file_id: UUID | None
    next_available_slot: datetime | None


class CoachListingProfileOut(CoachListingCardOut):
    coach_description: str | None
    session_duration_minutes: int | None
    video_file_id: UUID | None
    availability: list[AvailabilityWindowOut]
    recent_reviews: list["CoachReviewOut"]


class CoachReviewOut(BaseModel):
    id: UUID
    athlete_first_name: str
    rating: int
    text: str | None
    created_at: datetime


class OpenSlotOut(BaseModel):
    starts_at: datetime
    duration_minutes: int


CoachListingProfileOut.model_rebuild()
```

- [ ] **Step 5: Add the routes**

In `backend/app/api/routes/coach_listings.py`, extend the schema import to also pull in
`CoachListingCardOut, CoachListingProfileOut, OpenSlotOut`, add `from datetime import date` at the top, then add at the end of the file:

```python
@router.get("", response_model=list[CoachListingCardOut])
async def list_listings(
    sport: str | None = None,
    location: str | None = None,
    max_price: float | None = None,
    min_rating: float | None = None,
    format: str | None = None,
    min_experience_years: int | None = None,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[CoachListingCardOut]:
    cards = await listings_repo.list_listed(
        conn,
        sport=sport,
        location=location,
        max_price=max_price,
        min_rating=min_rating,
        training_format=format,
        min_experience_years=min_experience_years,
    )
    return [CoachListingCardOut(**c) for c in cards]


@router.get("/{listing_id}", response_model=CoachListingProfileOut)
async def get_listing_profile(
    listing_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> CoachListingProfileOut:
    profile = await listings_repo.get_public_listing(conn, listing_id)
    if profile is None:
        raise NotFoundError("listing not found or not listed")
    return CoachListingProfileOut(**profile)


_MAX_SLOTS_RANGE_DAYS = 90


@router.get("/{listing_id}/slots", response_model=list[OpenSlotOut])
async def get_listing_open_slots(
    listing_id: UUID,
    from_date: date,
    to_date: date,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[OpenSlotOut]:
    if to_date < from_date:
        raise APIError("to_date must not be before from_date", code="invalid_date_range", status_code=400)
    if (to_date - from_date).days > _MAX_SLOTS_RANGE_DAYS:
        raise APIError(
            f"date range must not exceed {_MAX_SLOTS_RANGE_DAYS} days",
            code="date_range_too_wide",
            status_code=400,
        )
    listing = await listings_repo.get_listing(conn, listing_id)
    if listing is None or not listing["is_listed"]:
        raise NotFoundError("listing not found or not listed")
    slots = await listings_repo.compute_open_slots(conn, listing_id, from_date, to_date)
    return [OpenSlotOut(**s) for s in slots]
```

Note: `GET /{listing_id}` and `GET /{listing_id}/availability` (Task 2) both match the path `/api/coach-listings/{listing_id}` — but they're different HTTP methods on different sub-paths (`""` vs `"/availability"`), and FastAPI resolves by full path pattern, so there's no ambiguity; place the new `GET ""` (list) route wherever convenient, since it and `GET "/{listing_id}"` differ in path shape, not just method.

- [ ] **Step 6: Extend the conftest fakes**

In `backend/tests/conftest.py`, add near the Task 2 `coach_listings_module` block:

```python
    async def fake_list_listed(conn, *, sport=None, location=None, max_price=None, min_rating=None, training_format=None, min_experience_years=None):
        cards = []
        for listing in listings_store.values():
            if not listing.get("is_listed"):
                continue
            profile = coach_store.get(listing["coach_user_id"])
            if profile is None:
                continue
            if sport and sport.lower() not in profile["sport"].lower():
                continue
            if location and (not listing.get("location") or location.lower() not in listing["location"].lower()):
                continue
            if max_price is not None and listing.get("price_per_session") is not None and float(listing["price_per_session"]) > float(max_price):
                continue
            if min_experience_years is not None and (profile.get("experience_years") or 0) < min_experience_years:
                continue
            if training_format == "online" and not listing.get("offers_online"):
                continue
            if training_format == "offline" and not listing.get("offers_offline"):
                continue
            rating = await fake_get_rating_summary(conn, listing["coach_user_id"])
            if min_rating is not None and (rating["average"] or 0) < min_rating:
                continue
            user_row = _find_user_by_id(listing["coach_user_id"])
            next_slot = await fake_listing_compute_open_slots(conn, listing["id"], date.today(), date.today() + timedelta(days=28))
            cards.append(
                {
                    "id": listing["id"],
                    "title": listing["title"],
                    "description": listing["description"],
                    "coach_user_id": listing["coach_user_id"],
                    "coach_full_name": profile["full_name"],
                    "coach_photo_url": user_row["photo_url"] if user_row else None,
                    "sport": profile["sport"],
                    "specialization": profile.get("specialization"),
                    "experience_years": profile.get("experience_years"),
                    "average_rating": rating["average"],
                    "review_count": rating["count"],
                    "price_per_session": listing.get("price_per_session"),
                    "currency": listing.get("currency", "RUB"),
                    "location": listing.get("location"),
                    "offers_online": listing.get("offers_online", False),
                    "offers_offline": listing.get("offers_offline", False),
                    "photo_file_id": listing.get("photo_file_id"),
                    "next_available_slot": next_slot[0]["starts_at"] if next_slot else None,
                }
            )
        return cards

    async def fake_get_public_listing(conn, listing_id):
        cards = await fake_list_listed(conn)
        card = next((c for c in cards if c["id"] == listing_id), None)
        if card is None:
            return None
        card = dict(card)
        listing = listings_store[listing_id]
        profile = coach_store.get(listing["coach_user_id"], {})
        card["coach_description"] = profile.get("description")
        card["session_duration_minutes"] = listing.get("session_duration_minutes")
        card["video_file_id"] = listing.get("video_file_id")
        card["availability"] = await fake_list_listing_availability(conn, listing_id)
        card["recent_reviews"] = await fake_list_recent_for_coach(conn, listing["coach_user_id"])
        return card

    async def fake_listing_compute_open_slots(conn, listing_id, from_date, to_date):
        listing = listings_store.get(listing_id) or {}
        duration = listing.get("session_duration_minutes")
        if not duration:
            return []
        coach_user_id = listing.get("coach_user_id")
        windows = await fake_list_listing_availability(conn, listing_id)
        booked = {
            b["starts_at"]
            for b in bookings_store.values()
            if b["coach_user_id"] == coach_user_id and b["status"] in ("pending", "confirmed")
        }
        slots = []
        day = from_date
        while day <= to_date:
            for window in windows:
                if window["weekday"] != day.weekday():
                    continue
                cursor = datetime.combine(day, window["start_time"], tzinfo=timezone.utc)
                window_end = datetime.combine(day, window["end_time"], tzinfo=timezone.utc)
                while cursor + timedelta(minutes=duration) <= window_end:
                    if cursor not in booked and cursor > datetime.now(timezone.utc):
                        slots.append({"starts_at": cursor, "duration_minutes": duration})
                    cursor += timedelta(minutes=duration)
            day += timedelta(days=1)
        return sorted(slots, key=lambda s: s["starts_at"])

    monkeypatch.setattr(coach_listings_module, "list_listed", fake_list_listed)
    monkeypatch.setattr(coach_listings_module, "get_public_listing", fake_get_public_listing)
    monkeypatch.setattr(coach_listings_module, "compute_open_slots", fake_listing_compute_open_slots)
```

This block depends on `fake_get_rating_summary`/`fake_list_recent_for_coach` (already defined earlier in the fixture, for `coach_reviews_module`) and `bookings_store`/`coach_store`/`_find_user_by_id` (all already in scope) — place it after those, and after the Task 2 `coach_listings_module` block.

- [ ] **Step 7: Run the tests**

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest tests/test_coach_listings_api.py -v
```

Expected: all PASS.

- [ ] **Step 8: Run the full suite**

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest -q
```

Expected: all PASS, no regressions.

- [ ] **Step 9: Commit**

```bash
git add backend/app/repositories/coach_listings.py backend/app/schemas/coach_listing.py backend/app/api/routes/coach_listings.py backend/tests/conftest.py backend/tests/test_coach_listings_api.py
git commit -m "feat: add public browsing for coach listings (list, profile, open slots)"
```

---

### Task 5: Rewire bookings to reference `listing_id`

**Files:**
- Modify: `backend/app/schemas/booking.py` (`BookingIn.listing_id`, `BookingOut`/`PendingBookingOut` gain `listing_title`)
- Modify: `backend/app/repositories/bookings.py` (`create_booking`, `get_booking`, `list_for_athlete`, `confirm_booking`, `list_pending_for_coach` all gain/use `listing_id`)
- Modify: `backend/app/api/routes/bookings.py` (`create_booking` route looks up the listing instead of `marketplace_repo`)
- Modify: `backend/tests/conftest.py` (`fake_create_booking`, `fake_confirm_booking`, `fake_list_pending_for_coach`, `fake_get_booking`, `fake_list_for_athlete` all updated)
- Modify: `backend/tests/test_bookings_api.py` (`_list_coach_with_slot` helper rewritten to use listings)
- Modify: `backend/tests/test_booking_confirmation_api.py` (`_create_pending_booking` helper now returns `listing_id` instead of `coach_id`; every call site and the one test that needs the actual coach id updated to match)

**Interfaces:**
- Consumes: `listings_repo.get_listing`, `compute_open_slots` (Task 2, 4).
- Produces: `bookings_repo.create_booking(conn, *, listing_id, coach_user_id, athlete_user_id, starts_at, duration_minutes, format, price_per_session, currency) -> dict | None` (drops the `location` parameter — Training location is now resolved from the listing at confirm-time, not passed in at creation time). `BookingOut`/`PendingBookingOut` both gain `listing_title: str | None`.

- [ ] **Step 1: Replace `test_bookings_api.py` wholesale and run it to see the intended failures**

This file's helper and every test call site currently talk to the old
`coach_user_id`-keyed API. Replace the **entire file** with:

```python
from __future__ import annotations

from datetime import date, timedelta

from tests.test_teams_api import _create_coach_profile


def _listing_payload(**overrides):
    payload = {
        "title": "Тренировки",
        "description": None,
        "is_listed": True,
        "price_per_session": 2000,
        "currency": "RUB",
        "offers_online": True,
        "offers_offline": False,
        "location": None,
        "session_duration_minutes": 60,
    }
    payload.update(overrides)
    return payload


def _list_coach_with_slot(client, coach_token) -> tuple[str, str]:
    """Returns (listing_id, iso datetime of the first open slot)."""
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token, sport="Теннис")
    listing = client.post(
        "/api/coach-listings", headers=coach_headers, json=_listing_payload(is_listed=False)
    ).json()
    # Availability must be set before is_listed=True is accepted.
    client.put(
        f"/api/coach-listings/{listing['id']}/availability",
        headers=coach_headers,
        json=[{"weekday": 0, "start_time": "10:00:00", "end_time": "12:00:00"}],
    )
    client.put(f"/api/coach-listings/{listing['id']}", headers=coach_headers, json=_listing_payload())

    today = date.today()
    days_until_monday = (7 - today.weekday()) % 7
    next_monday = today + timedelta(days=days_until_monday or 7)
    slots = client.get(
        f"/api/coach-listings/{listing['id']}/slots",
        params={"from_date": next_monday.isoformat(), "to_date": next_monday.isoformat()},
        headers=coach_headers,
    ).json()
    return listing["id"], slots[0]["starts_at"]


def test_athlete_booking_creates_pending_request_with_no_training_yet(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    listing_id, slot = _list_coach_with_slot(client, coach_token)

    athlete_token = login_as(890001, first_name="Athlete")
    athlete_headers = {"Authorization": f"Bearer {athlete_token}"}

    resp = client.post(
        "/api/bookings",
        headers=athlete_headers,
        json={"listing_id": listing_id, "starts_at": slot, "format": "online"},
    )
    assert resp.status_code == 200, resp.text
    booking = resp.json()
    assert booking["status"] == "pending"
    assert booking["training_id"] is None
    assert booking["is_completed"] is False
    assert booking["listing_id"] == listing_id

    mine = client.get("/api/bookings/me", headers=athlete_headers).json()
    assert len(mine) == 1
    assert mine[0]["id"] == booking["id"]
    assert mine[0]["status"] == "pending"


def test_double_booking_same_slot_rejected(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    listing_id, slot = _list_coach_with_slot(client, coach_token)

    first_token = login_as(890002, first_name="First")
    second_token = login_as(890003, first_name="Second")

    ok = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {first_token}"},
        json={"listing_id": listing_id, "starts_at": slot, "format": "online"},
    )
    assert ok.status_code == 200

    conflict = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {second_token}"},
        json={"listing_id": listing_id, "starts_at": slot, "format": "online"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "slot_unavailable"


def test_cannot_book_format_coach_does_not_offer(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    listing_id, slot = _list_coach_with_slot(client, coach_token)  # offers_online only, per _listing_payload default

    athlete_token = login_as(890004, first_name="Athlete")
    resp = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {athlete_token}"},
        json={"listing_id": listing_id, "starts_at": slot, "format": "offline"},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "format_not_offered"


def test_coach_cannot_book_themselves(logged_in_client) -> None:
    client, coach_token = logged_in_client
    listing_id, slot = _list_coach_with_slot(client, coach_token)

    resp = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"listing_id": listing_id, "starts_at": slot, "format": "online"},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "self_booking"


def test_booked_slot_disappears_from_open_slots(logged_in_client, login_as) -> None:
    """Regression test for the naive/aware datetime bug: booking a slot must
    make it stop showing up in a subsequent open-slots lookup for the same
    date. Before starts_at was normalized to aware UTC end-to-end (schema
    validator in BookingIn) and compute_open_slots built its cursor/booked
    comparison consistently aware, a naive cursor would never equal an
    aware starts_at coming back from a real TIMESTAMPTZ column, so this
    slot would incorrectly still appear as open. Reverting either half of
    the fix (the schema normalization or the aware cursor in
    compute_open_slots / its test fake) reintroduces exactly that
    naive-vs-aware mismatch and makes this assertion fail."""
    client, coach_token = logged_in_client
    listing_id, slot = _list_coach_with_slot(client, coach_token)
    coach_headers = {"Authorization": f"Bearer {coach_token}"}

    athlete_token = login_as(890005, first_name="Athlete")
    booking_resp = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {athlete_token}"},
        json={"listing_id": listing_id, "starts_at": slot, "format": "online"},
    )
    assert booking_resp.status_code == 200, booking_resp.text

    today = date.today()
    days_until_monday = (7 - today.weekday()) % 7
    next_monday = today + timedelta(days=days_until_monday or 7)
    slots_after = client.get(
        f"/api/coach-listings/{listing_id}/slots",
        params={"from_date": next_monday.isoformat(), "to_date": next_monday.isoformat()},
        headers=coach_headers,
    ).json()
    assert slot not in {s["starts_at"] for s in slots_after}


def test_double_booking_rejected_across_different_utc_offsets(logged_in_client, login_as) -> None:
    """Direct reproduction of critical finding #1: the same instant
    expressed with two different UTC offsets must not defeat the
    double-booking guard. `slot` (as returned by the open-slots endpoint)
    is UTC; requesting it again with an explicit +00:00 offset is the same
    instant and must collide with the first booking."""
    client, coach_token = logged_in_client
    listing_id, slot = _list_coach_with_slot(client, coach_token)
    assert slot.endswith("Z")
    same_instant_with_explicit_offset = slot[:-1] + "+00:00"

    first_token = login_as(890006, first_name="First")
    second_token = login_as(890007, first_name="Second")

    ok = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {first_token}"},
        json={"listing_id": listing_id, "starts_at": slot, "format": "online"},
    )
    assert ok.status_code == 200, ok.text

    conflict = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {second_token}"},
        json={"listing_id": listing_id, "starts_at": same_instant_with_explicit_offset, "format": "online"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "slot_unavailable"
```

Note this drops the old `from tests.test_coach_marketplace_api import _settings_payload`
import entirely (replaced by this file's own `_listing_payload`) — that
import would otherwise break once Task 6 deletes
`test_coach_marketplace_api.py`.

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest tests/test_bookings_api.py tests/test_booking_confirmation_api.py -v
```

Expected: FAIL — `/api/coach-listings` routes exist (Tasks 2-4), but
`BookingIn` doesn't have `listing_id` yet, so every POST `/api/bookings`
call in these tests gets a 422.

- [ ] **Step 2: Update `BookingIn`/`BookingOut`/`PendingBookingOut`**

In `backend/app/schemas/booking.py`, change:

```python
class BookingIn(BaseModel):
    coach_user_id: UUID
    starts_at: datetime
    format: str  # "online" | "offline"
```

to:

```python
class BookingIn(BaseModel):
    listing_id: UUID
    starts_at: datetime
    format: str  # "online" | "offline"
```

Change `BookingOut` by adding `listing_title: str | None` right after `coach_full_name: str`, and adding `listing_id: UUID | None` right after that (both nullable — a booking made before this feature, or one whose listing was later deleted, may have neither):

```python
class BookingOut(BaseModel):
    id: UUID
    coach_user_id: UUID
    coach_full_name: str
    listing_id: UUID | None
    listing_title: str | None
    athlete_user_id: UUID
    starts_at: datetime
    duration_minutes: int
    format: str
    price_per_session: float | None
    currency: str
    status: str
    is_completed: bool
    training_id: UUID | None
    has_review: bool
```

Change `PendingBookingOut` by adding `listing_title: str | None` right after `id: UUID`:

```python
class PendingBookingOut(BaseModel):
    id: UUID
    listing_title: str | None
    athlete_user_id: UUID
    athlete_full_name: str
    starts_at: datetime
    duration_minutes: int
    format: str
    price_per_session: float | None
    currency: str
    created_at: datetime
```

- [ ] **Step 3: Rewire the booking repository**

In `backend/app/repositories/bookings.py`, replace `_BOOKING_FIELDS`/`_BOOKING_INSERT_FIELDS`:

```python
_BOOKING_FIELDS = (
    "b.id, b.coach_user_id, cp.full_name AS coach_full_name, b.listing_id, cl.title AS listing_title, "
    "b.athlete_user_id, b.starts_at, b.duration_minutes, b.format, b.price_per_session, b.currency, "
    "b.status, b.training_id"
)

_BOOKING_INSERT_FIELDS = (
    "id, coach_user_id, listing_id, athlete_user_id, starts_at, duration_minutes, format, "
    "price_per_session, currency, status, training_id"
)
```

Replace `create_booking`:

```python
async def create_booking(
    conn: asyncpg.Connection,
    *,
    listing_id: UUID,
    coach_user_id: UUID,
    athlete_user_id: UUID,
    starts_at: datetime,
    duration_minutes: int,
    format: str,
    price_per_session: float | None,
    currency: str,
) -> dict[str, Any] | None:
    """Creates a pending booking request against a specific listing — no
    Training is created here; that only happens once the coach confirms
    (see confirm_booking). Returns None if the slot was already taken."""
    try:
        row = await conn.fetchrow(
            f"""
            INSERT INTO bookings (
                coach_user_id, listing_id, athlete_user_id, starts_at, duration_minutes, format,
                price_per_session, currency, status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
            RETURNING {_BOOKING_INSERT_FIELDS}, created_at
            """,
            coach_user_id,
            listing_id,
            athlete_user_id,
            starts_at,
            duration_minutes,
            format,
            price_per_session,
            currency,
        )
    except asyncpg.UniqueViolationError:
        return None
    result = dict(row)
    coach_and_listing = await conn.fetchrow(
        "SELECT cp.full_name, cl.title FROM coach_profiles cp JOIN coach_listings cl ON cl.id = $2 "
        "WHERE cp.user_id = $1",
        coach_user_id,
        listing_id,
    )
    result["coach_full_name"] = coach_and_listing["full_name"]
    result["listing_title"] = coach_and_listing["title"]
    return result
```

Update `get_booking` and `list_for_athlete` to `LEFT JOIN coach_listings` (a historical booking may have `listing_id IS NULL`):

```python
async def get_booking(conn: asyncpg.Connection, booking_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"""
        SELECT {_BOOKING_FIELDS} FROM bookings b
        JOIN coach_profiles cp ON cp.user_id = b.coach_user_id
        LEFT JOIN coach_listings cl ON cl.id = b.listing_id
        WHERE b.id = $1
        """,
        booking_id,
    )
    return dict(row) if row else None


async def list_for_athlete(conn: asyncpg.Connection, athlete_user_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT {_BOOKING_FIELDS} FROM bookings b
        JOIN coach_profiles cp ON cp.user_id = b.coach_user_id
        LEFT JOIN coach_listings cl ON cl.id = b.listing_id
        WHERE b.athlete_user_id = $1
        ORDER BY b.starts_at DESC
        """,
        athlete_user_id,
    )
    return [dict(row) for row in rows]
```

Update `confirm_booking` to resolve `location` from the listing instead of `coach_profiles` (the coach-level `location` column still exists at this point in the plan, but is no longer the semantically right source — a booking's listing may have a different location than another listing from the same coach):

```python
async def confirm_booking(conn: asyncpg.Connection, *, booking_id: UUID, coach_user_id: UUID) -> dict[str, Any] | None:
    async with conn.transaction():
        booking = await conn.fetchrow(
            "SELECT * FROM bookings WHERE id = $1 AND coach_user_id = $2 AND status = 'pending' FOR UPDATE",
            booking_id,
            coach_user_id,
        )
        if booking is None:
            return None
        if booking["starts_at"] <= datetime.now(timezone.utc):
            return None
        listing = await conn.fetchrow("SELECT location FROM coach_listings WHERE id = $1", booking["listing_id"])
        training = await trainings_repo.create_training(
            conn,
            booking["athlete_user_id"],
            type="personal",
            training_date=booking["starts_at"].date(),
            start_time=booking["starts_at"].time(),
            duration_minutes=booking["duration_minutes"],
            location=(listing["location"] if listing else None) if booking["format"] == "offline" else "Онлайн",
            description="Бронирование тренера через маркетплейс",
        )
        await conn.execute(
            "UPDATE bookings SET status = 'confirmed', training_id = $1, responded_at = now() WHERE id = $2",
            training["id"],
            booking_id,
        )
    return await get_booking(conn, booking_id)
```

Update `list_pending_for_coach` to include `listing_title`:

```python
async def list_pending_for_coach(conn: asyncpg.Connection, coach_user_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT b.id, cl.title AS listing_title, b.athlete_user_id, b.starts_at, b.duration_minutes, b.format,
               b.price_per_session, b.currency, b.created_at,
               u.first_name || COALESCE(' ' || u.last_name, '') AS athlete_full_name
        FROM bookings b
        JOIN users u ON u.id = b.athlete_user_id
        LEFT JOIN coach_listings cl ON cl.id = b.listing_id
        WHERE b.coach_user_id = $1 AND b.status = 'pending'
        ORDER BY b.created_at ASC
        """,
        coach_user_id,
    )
    return [dict(row) for row in rows]
```

- [ ] **Step 4: Rewire the booking creation route**

In `backend/app/api/routes/bookings.py`, replace the import
`from app.repositories import coach_marketplace as marketplace_repo` with
`from app.repositories import coach_listings as listings_repo`, and replace
the whole `create_booking` route body:

```python
@router.post("", response_model=BookingOut)
async def create_booking(
    payload: BookingIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> BookingOut:
    listing = await listings_repo.get_listing(conn, payload.listing_id)
    if listing is None or not listing["is_listed"]:
        raise NotFoundError("listing not found or not listed")
    if listing["coach_user_id"] == user["id"]:
        raise APIError("cannot book yourself", code="self_booking", status_code=400)
    if payload.format == "online" and not listing["offers_online"]:
        raise APIError("coach does not offer this format", code="format_not_offered", status_code=400)
    if payload.format == "offline" and not listing["offers_offline"]:
        raise APIError("coach does not offer this format", code="format_not_offered", status_code=400)

    open_slots = await listings_repo.compute_open_slots(
        conn, payload.listing_id, payload.starts_at.date(), payload.starts_at.date()
    )
    if not any(s["starts_at"] == payload.starts_at for s in open_slots):
        raise APIError("slot is not open", code="slot_unavailable", status_code=409)

    booking = await bookings_repo.create_booking(
        conn,
        listing_id=payload.listing_id,
        coach_user_id=listing["coach_user_id"],
        athlete_user_id=user["id"],
        starts_at=payload.starts_at,
        duration_minutes=listing["session_duration_minutes"],
        format=payload.format,
        price_per_session=listing["price_per_session"],
        currency=listing["currency"],
    )
    if booking is None:
        raise APIError("slot was just booked by someone else", code="slot_unavailable", status_code=409)
    await notifications_service.schedule_booking_requested_notification(conn, booking)
    return await _to_out(conn, booking)
```

Nothing else in `routes/bookings.py` changes — `confirm_booking`, `decline_booking`, `list_pending_bookings`, `review_booking` all still operate purely on `booking_id`/`coach_user_id` and don't need to know about listings directly.

- [ ] **Step 5: Rewrite the conftest fakes**

In `backend/tests/conftest.py`, replace `fake_create_booking`:

```python
    async def fake_create_booking(conn, *, listing_id, coach_user_id, athlete_user_id, starts_at, duration_minutes, format, price_per_session, currency):
        if any(
            b["coach_user_id"] == coach_user_id and b["starts_at"] == starts_at and b["status"] in ("pending", "confirmed")
            for b in bookings_store.values()
        ):
            return None
        booking_id = uuid4()
        listing = listings_store.get(listing_id, {})
        record = {
            "id": booking_id,
            "coach_user_id": coach_user_id,
            "coach_full_name": coach_store[coach_user_id]["full_name"],
            "listing_id": listing_id,
            "listing_title": listing.get("title"),
            "athlete_user_id": athlete_user_id,
            "starts_at": starts_at,
            "duration_minutes": duration_minutes,
            "format": format,
            "price_per_session": price_per_session,
            "currency": currency,
            "status": "pending",
            "training_id": None,
            "created_at": datetime.now(timezone.utc),
            "responded_at": None,
        }
        bookings_store[booking_id] = record
        return dict(record)
```

Replace `fake_confirm_booking`'s location lookup (it currently reads `coach_store.get(coach_user_id, {})` for `location` — change it to read from the listing instead):

```python
    async def fake_confirm_booking(conn, *, booking_id, coach_user_id):
        record = bookings_store.get(booking_id)
        if record is None or record["coach_user_id"] != coach_user_id or record["status"] != "pending":
            return None
        if record["starts_at"] <= datetime.now(timezone.utc):
            return None
        listing = listings_store.get(record.get("listing_id"), {})
        training = await trainings_module.create_training(
            conn,
            record["athlete_user_id"],
            type="personal",
            training_date=record["starts_at"].date(),
            start_time=record["starts_at"].time(),
            duration_minutes=record["duration_minutes"],
            location=listing.get("location") if record["format"] == "offline" else "Онлайн",
            description="Бронирование тренера через маркетплейс",
        )
        record["status"] = "confirmed"
        record["training_id"] = training["id"]
        record["responded_at"] = datetime.now(timezone.utc)
        return dict(record)
```

Replace `fake_list_pending_for_coach` to include `listing_title`:

```python
    async def fake_list_pending_for_coach(conn, coach_user_id):
        items = sorted(
            (b for b in bookings_store.values() if b["coach_user_id"] == coach_user_id and b["status"] == "pending"),
            key=lambda b: b["created_at"],
        )
        result = []
        for b in items:
            athlete = _find_user_by_id(b["athlete_user_id"])
            full_name = (athlete["first_name"] if athlete else "") + (
                f" {athlete['last_name']}" if athlete and athlete.get("last_name") else ""
            )
            result.append(
                {
                    "id": b["id"],
                    "listing_title": b.get("listing_title"),
                    "athlete_user_id": b["athlete_user_id"],
                    "athlete_full_name": full_name,
                    "starts_at": b["starts_at"],
                    "duration_minutes": b["duration_minutes"],
                    "format": b["format"],
                    "price_per_session": b["price_per_session"],
                    "currency": b["currency"],
                    "created_at": b["created_at"],
                }
            )
        return result
```

`fake_get_booking`/`fake_list_for_athlete`/`fake_decline_booking`/`fake_sweep_expired` need no change — they already return/mutate whatever's in `bookings_store`, which now carries `listing_id`/`listing_title` naturally since `fake_create_booking` sets them.

- [ ] **Step 6: Update `test_booking_confirmation_api.py`**

`_create_pending_booking`'s first return value was the coach's user id
(`coach_id`); it must now be `listing_id`, since `POST /api/bookings`
needs `listing_id` in its body, not `coach_user_id`. Only two of this
file's test bodies actually *use* the destructured value afterward — one
needs a listing id (for a retry-booking POST body), the other needs the
real coach id (for a notification-recipient assertion), which is now read
off `booking["coach_user_id"]` instead (Task 5 Step 2 added that field to
`BookingOut`). Every other test destructures the tuple but never uses
that element, so renaming it is a no-op for them. Replace the **entire
file** with:

```python
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from app.services import background

from tests.test_bookings_api import _list_coach_with_slot


def _create_pending_booking(client, coach_token, login_as, telegram_id=890101):
    listing_id, slot = _list_coach_with_slot(client, coach_token)
    athlete_token = login_as(telegram_id, first_name="Athlete")
    resp = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {athlete_token}"},
        json={"listing_id": listing_id, "starts_at": slot, "format": "online"},
    )
    assert resp.status_code == 200, resp.text
    return listing_id, athlete_token, resp.json()


def test_coach_sees_pending_request_in_inbox(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    listing_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as)

    pending = client.get("/api/bookings/coach/pending", headers={"Authorization": f"Bearer {coach_token}"}).json()
    assert len(pending) == 1
    assert pending[0]["id"] == booking["id"]
    assert pending[0]["athlete_full_name"] == "Athlete"


def test_coach_confirms_booking_creates_training_and_notifies_athlete(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    listing_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as)

    resp = client.post(
        f"/api/bookings/{booking['id']}/confirm",
        headers={"Authorization": f"Bearer {coach_token}"},
    )
    assert resp.status_code == 200, resp.text
    confirmed = resp.json()
    assert confirmed["status"] == "confirmed"
    assert confirmed["training_id"] is not None

    training_resp = client.get(
        f"/api/trainings/{confirmed['training_id']}", headers={"Authorization": f"Bearer {athlete_token}"}
    )
    assert training_resp.status_code == 200
    assert training_resp.json()["type"] == "personal"

    # Confirming removes it from the coach's pending inbox.
    pending = client.get("/api/bookings/coach/pending", headers={"Authorization": f"Bearer {coach_token}"}).json()
    assert pending == []


def test_coach_declines_booking_frees_the_slot(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    listing_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as)

    resp = client.post(
        f"/api/bookings/{booking['id']}/decline",
        headers={"Authorization": f"Bearer {coach_token}"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "declined"

    # The slot is bookable again by someone else.
    other_athlete_token = login_as(890102, first_name="Other")
    retry = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {other_athlete_token}"},
        json={"listing_id": listing_id, "starts_at": booking["starts_at"], "format": "online"},
    )
    assert retry.status_code == 200, retry.text
    assert retry.json()["status"] == "pending"


def test_confirm_rejects_wrong_coach(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    listing_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as)

    other_coach_token = login_as(890103, first_name="OtherCoach")
    resp = client.post(
        f"/api/bookings/{booking['id']}/confirm",
        headers={"Authorization": f"Bearer {other_coach_token}"},
    )
    assert resp.status_code == 403


def test_confirm_twice_is_rejected(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    listing_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as)

    headers = {"Authorization": f"Bearer {coach_token}"}
    first = client.post(f"/api/bookings/{booking['id']}/confirm", headers=headers)
    assert first.status_code == 200

    second = client.post(f"/api/bookings/{booking['id']}/confirm", headers=headers)
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "booking_not_pending"


async def test_sweep_expires_pending_booking_after_24_hours(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    listing_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as)

    # Backdate the booking's created_at past the 24h cutoff by monkeypatching
    # is not available here (no direct store access from the test module),
    # so instead call the sweep with an `older_than` cutoff in the future —
    # equivalent to "24 hours have passed" from the sweep's point of view.
    from app.repositories import bookings as bookings_repo

    future_cutoff = datetime.now(timezone.utc) + timedelta(hours=1)
    expired = await bookings_repo.sweep_expired(None, older_than=future_cutoff)
    # sweep_expired returns raw UUID objects (matching what asyncpg returns
    # for a `uuid` column), while `booking["id"]` came through the JSON
    # response and is therefore a string — compare via str() rather than
    # relying on UUID.__eq__(str), which is always False.
    assert any(str(e["id"]) == booking["id"] for e in expired)

    pending = client.get("/api/bookings/coach/pending", headers={"Authorization": f"Bearer {coach_token}"}).json()
    assert pending == []

    mine = client.get("/api/bookings/me", headers={"Authorization": f"Bearer {athlete_token}"}).json()
    assert mine[0]["status"] == "expired"


def test_confirm_rejects_booking_whose_session_time_has_passed(logged_in_client, login_as) -> None:
    """A coach must not be able to confirm a booking after its session
    start time has already passed (e.g. sitting on a same-day request for
    hours) — that would create a back-dated Training that is_completed()
    immediately reports as completed, letting the athlete review a session
    that never happened. The normal booking flow only allows booking future
    slots, so to exercise the starts_at guard we create a pending booking
    normally via the API and then backdate its starts_at directly in the
    fake's in-memory store (exposed on the client as `bookings_store`, the
    same way `notifications_store` is exposed for other tests) — this
    reaches the real route and the fake's guard logic (which mirrors
    confirm_booking's real SQL-side check) rather than faking the clock."""
    client, coach_token = logged_in_client
    listing_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as, telegram_id=890401)

    record = client.bookings_store[UUID(booking["id"])]
    record["starts_at"] = datetime.now(timezone.utc) - timedelta(minutes=1)

    resp = client.post(
        f"/api/bookings/{booking['id']}/confirm",
        headers={"Authorization": f"Bearer {coach_token}"},
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "booking_not_pending"

    # It's still 'pending' (not flipped to anything) until the sweep catches
    # it on its next tick — confirm_booking itself must not mutate it.
    assert record["status"] == "pending"
    assert record["training_id"] is None


async def test_sweep_also_expires_pending_booking_whose_session_time_has_passed_within_24h(
    logged_in_client, login_as
) -> None:
    """sweep_expired's widened WHERE clause must catch a booking whose
    starts_at has passed even when it's well within the 24h creation-time
    cutoff (e.g. a same-day request the coach sat on) — not just old ones.
    Backdate starts_at the same way as the confirm-guard test above, then
    call sweep_expired with an `older_than` cutoff in the past so the
    created_at < $1 branch of the OR cannot be what matches."""
    client, coach_token = logged_in_client
    listing_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as, telegram_id=890402)

    record = client.bookings_store[UUID(booking["id"])]
    record["starts_at"] = datetime.now(timezone.utc) - timedelta(minutes=1)

    from app.repositories import bookings as bookings_repo

    past_cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    assert record["created_at"] > past_cutoff  # created_at < $1 branch does NOT match

    expired = await bookings_repo.sweep_expired(None, older_than=past_cutoff)
    assert any(str(e["id"]) == booking["id"] for e in expired)

    mine = client.get("/api/bookings/me", headers={"Authorization": f"Bearer {athlete_token}"}).json()
    assert mine[0]["status"] == "expired"


async def test_background_sweep_runs_via_service_function(logged_in_client, login_as, monkeypatch) -> None:
    """Exercises the real sweep_expired_bookings wiring — including its own
    cutoff computation — rather than calling bookings_repo.sweep_expired
    directly like the test above. Dropping BOOKING_EXPIRY_HOURS to 0 makes
    "24 hours ago" collapse to "now", so a booking created a moment earlier
    is already past the (now momentary) cutoff — no need to fake the clock
    or the booking's created_at."""
    client, coach_token = logged_in_client
    listing_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as, telegram_id=890201)

    monkeypatch.setattr(background, "BOOKING_EXPIRY_HOURS", 0)
    await background.sweep_expired_bookings(None)

    mine = client.get("/api/bookings/me", headers={"Authorization": f"Bearer {athlete_token}"}).json()
    assert mine[0]["status"] == "expired"


def test_booking_request_notifies_coach(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    listing_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as, telegram_id=890301)
    coach_id = booking["coach_user_id"]

    requested = [n for n in client.notifications_store.values() if n["category"] == "booking_requested"]
    assert len(requested) == 1
    # notifications_store holds the raw UUID object passed internally to
    # _notify_recipients; coach_id here is the JSON-serialized string form
    # from the API response — str() both sides to compare them correctly.
    assert str(requested[0]["user_id"]) == coach_id
    assert "Athlete" in requested[0]["body"]


def test_confirm_and_decline_notify_athlete(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_headers = {"Authorization": f"Bearer {coach_token}"}

    listing_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as, telegram_id=890302)
    athlete_id = client.get("/api/auth/me", headers={"Authorization": f"Bearer {athlete_token}"}).json()["id"]

    confirm_resp = client.post(f"/api/bookings/{booking['id']}/confirm", headers=coach_headers)
    assert confirm_resp.status_code == 200

    decided = [n for n in client.notifications_store.values() if n["category"] == "booking_decided"]
    assert len(decided) == 1
    assert str(decided[0]["user_id"]) == athlete_id
    assert "подтвердил" in decided[0]["body"]

    listing_id2, athlete_token2, booking2 = _create_pending_booking(client, coach_token, login_as, telegram_id=890303)
    decline_resp = client.post(f"/api/bookings/{booking2['id']}/decline", headers=coach_headers)
    assert decline_resp.status_code == 200

    decided_bodies = {n["body"] for n in client.notifications_store.values() if n["category"] == "booking_decided"}
    assert any("отклонена" in body for body in decided_bodies)
```

- [ ] **Step 7: Run the booking test suites**

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest tests/test_bookings_api.py tests/test_booking_confirmation_api.py -v
```

Expected: all PASS.

- [ ] **Step 8: Run the full suite**

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest -q
```

Expected: all PASS **except** `test_coach_marketplace_api.py` tests that create bookings through the old flow — there are none (that file only tests marketplace settings/availability/discovery, never booking creation, per its contents read during planning), so this should still be a full pass. If anything in `test_coach_marketplace_api.py` unexpectedly fails, that is a real regression to fix (that file's own routes/repo were not touched by this task) — do not silence it.

- [ ] **Step 9: Commit**

```bash
git add backend/app/schemas/booking.py backend/app/repositories/bookings.py backend/app/api/routes/bookings.py backend/tests/conftest.py backend/tests/test_bookings_api.py backend/tests/test_booking_confirmation_api.py
git commit -m "feat: rewire bookings to reference a specific coach listing"
```

---

### Task 6: Retire the old marketplace code

**Files:**
- Create: `database/patches/0022_drop_old_coach_marketplace_fields.sql`
- Delete: `backend/app/repositories/coach_marketplace.py`
- Delete: `backend/app/schemas/coach_marketplace.py`
- Delete: `backend/app/schemas/coach_search.py`
- Delete: `backend/app/api/routes/coaches.py`
- Delete: `backend/tests/test_coach_marketplace_api.py`
- Modify: `backend/app/main.py` (remove the `coaches` import and `app.include_router(coaches.router)`)
- Modify: `backend/tests/conftest.py` (remove the now-dead `coach_marketplace_module` fakes and its `import`)

**Interfaces:**
- Consumes: nothing new.
- Produces: a fully single-system backend — only `coach_listings`/`coach_listing_availability` exist for marketplace data; `coach_profiles` no longer carries any marketplace fields.

- [ ] **Step 1: Confirm nothing still references the old code**

```bash
grep -rn "coach_marketplace\|coach_search" backend/app backend/tests --include="*.py" | grep -v "coach_listings\|coach_listing_availability"
```

Expected output: only matches inside the four files being deleted in this task (`repositories/coach_marketplace.py`, `schemas/coach_marketplace.py`, `schemas/coach_search.py`, `api/routes/coaches.py`) and `tests/test_coach_marketplace_api.py`, plus the `import` lines for them in `main.py`/`conftest.py` (which this task also removes). If anything else shows up, stop and investigate before deleting — it means some other file still depends on the old module.

- [ ] **Step 2: Delete the old files**

```bash
git rm backend/app/repositories/coach_marketplace.py backend/app/schemas/coach_marketplace.py backend/app/schemas/coach_search.py backend/app/api/routes/coaches.py backend/tests/test_coach_marketplace_api.py
```

- [ ] **Step 3: Remove the router registration**

In `backend/app/main.py`, remove `coaches,` from the `from app.api.routes import (...)` block and remove the line `app.include_router(coaches.router)`.

- [ ] **Step 4: Remove the dead conftest fakes**

In `backend/tests/conftest.py`, remove the `import app.repositories.coach_marketplace as coach_marketplace_module` line and the entire block of `fake_get_marketplace_settings`/`fake_upsert_marketplace_settings`/`fake_list_availability`/`fake_replace_availability`/`fake_list_listed_coaches`/`fake_get_public_profile`/`fake_compute_open_slots` and their five `monkeypatch.setattr(coach_marketplace_module, ...)` calls (the ones keyed to `coach_marketplace_module`, **not** the `coach_listings_module` ones added in Tasks 2-4, which stay).

- [ ] **Step 5: Write and apply the cleanup migration**

Create `database/patches/0022_drop_old_coach_marketplace_fields.sql`:

```sql
-- database/patches/0022_drop_old_coach_marketplace_fields.sql
-- Retires the pre-coach_listings marketplace model now that
-- backend/app/api/routes/coaches.py and backend/app/repositories/
-- coach_marketplace.py are deleted and nothing reads these anymore.

ALTER TABLE coach_profiles
    DROP COLUMN is_listed,
    DROP COLUMN price_per_session,
    DROP COLUMN currency,
    DROP COLUMN offers_online,
    DROP COLUMN offers_offline,
    DROP COLUMN location,
    DROP COLUMN session_duration_minutes;

DROP TABLE coach_availability_templates;
```

Apply and verify:

```bash
docker compose -f docker-compose.dev.yml restart backend
docker compose -f docker-compose.dev.yml logs backend --tail=30
```

Expected: clean startup, no errors.

```bash
source .env
docker compose -f docker-compose.dev.yml exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\d coach_profiles" | grep -i "listed\|price_per_session\|offers_\|session_duration"
```

Expected: no output (columns gone).

- [ ] **Step 6: Run the full backend suite**

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest -q
```

Expected: all PASS — the deleted test file's tests are simply gone from the count; every other test (including the full `test_coach_listings_api.py`, `test_bookings_api.py`, `test_booking_confirmation_api.py`) is unaffected since none of them ever exercised the old marketplace code.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: retire the old single-listing marketplace model"
```

---

## Self-Review Notes

- **Spec coverage:** `coach_listings` table + multi-listing support → Task 2; per-listing availability → Task 2; photo/video upload reusing existing infra + soft-delete-on-replace → Task 3; `files` `PUBLIC` access level → Tasks 1 (schema) + 3 (route branch); listing-centric browsing (list/profile/slots) → Task 4; coach-wide double-booking guard preserved across listings → Task 4's `compute_open_slots` (keyed on `coach_user_id`) and unchanged in Task 5; `POST /api/bookings` moving to `listing_id` → Task 5; reviews staying coach-level → untouched throughout (no task modifies `coach_reviews`); old `coach_profiles` fields fully removed, data migrated not discarded → Task 1 (migrate) + Task 6 (drop). All spec sections have a task.
- **Placeholder scan:** no TBD/TODO; every step has literal code.
- **Type consistency:** `listings_repo.get_listing`/`list_for_coach`/`update_listing`/`has_active_booking`/`soft_delete_listing`/`list_availability`/`replace_availability`/`has_overlap` (Task 2) and `list_listed`/`get_public_listing`/`compute_open_slots`/`_next_available_slot` (Task 4) match their call sites in `routes/coach_listings.py` and, for `get_listing`/`compute_open_slots`, in `routes/bookings.py` (Task 5) exactly. `bookings_repo.create_booking`'s signature (Task 5, drops `location`, adds `listing_id`) matches its one call site in `routes/bookings.py`'s `create_booking` route and its conftest fake identically. `BookingOut`/`PendingBookingOut`'s new `listing_id`/`listing_title` fields are produced by every repo function that returns a booking dict (`create_booking`, `get_booking`, `list_for_athlete`, `confirm_booking` via `get_booking`, `decline_booking` via `get_booking`, `list_pending_for_coach`) and consumed identically by both the real SQL and the fakes.
- **Sequencing safety:** Tasks 1-4 are purely additive — the old `/api/coaches/*` routes, `coach_marketplace.py`, and `coach_profiles` marketplace columns keep working completely unchanged throughout, verified by never modifying those files before Task 6 (Global Constraints call this out explicitly) and by Task 1's migration adding only new tables/columns, never touching or renaming anything old. Task 5 is the one deliberate breaking change (`POST /api/bookings`'s body shape), accepted per this project's established single-environment, backend-then-frontend-plan workflow with no external users. Task 6 only runs after Tasks 2-5 have fully proven out the replacement (full green suite at every step).
