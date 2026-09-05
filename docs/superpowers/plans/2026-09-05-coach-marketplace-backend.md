# Coach Marketplace — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the backend data model and API for the coach marketplace (public coach listing, booking, reviews) described in the spec, as a strictly additive layer that changes nothing for existing coaches/athletes until a coach opts in.

**Architecture:** One new SQL patch (four schema changes: extend `coach_profiles`, three new tables). Three new repository modules (`coach_marketplace`, `bookings`, `coach_reviews`) using raw parameterized `asyncpg` queries, matching every existing repository in this codebase — no ORM. Two new route files (`api/routes/coaches.py`, `api/routes/bookings.py`) using the existing `Depends(get_current_user)` / `Depends(get_db)` pattern and the existing `APIError`/`ForbiddenError`/`NotFoundError` exception hierarchy. Open slots are **computed on read** from the coach's weekly availability template minus existing bookings — no materialized slot table, no background job. Booking creates a real `trainings` row (`type='personal'`) in the same transaction, so it appears in the athlete's existing calendar/dashboard for free.

**Tech Stack:** FastAPI, asyncpg (raw SQL, no ORM), Pydantic v2, pytest + `fastapi.testclient.TestClient` against **in-memory fake repositories** (this codebase's test suite never touches a real Postgres — see Global Constraints).

**Spec:** [docs/superpowers/specs/2026-09-05-coach-marketplace-design.md](../specs/2026-09-05-coach-marketplace-design.md)

## Global Constraints

- No in-app payments. `price_per_session` is informational only.
- No group sessions — a booking is always one athlete + one coach + one slot; `UNIQUE (coach_user_id, starts_at)` on `bookings` is the sole concurrency guard, no row locking needed.
- No geo-search — `location` is a plain `TEXT` column, filtered by case-insensitive substring match.
- No coach-side manual confirmation — a booking is confirmed immediately; "completed" is a **derived** value (`now() > starts_at + duration_minutes`), never a stored status. `bookings.status` only ever holds `confirmed` or `cancelled`.
- No review moderation — reviews publish immediately on creation.
- No cancellation flow in this plan (spec flags it as an open question for a later plan) — do not add a cancel endpoint.
- No badges/qualifications data model — convey that through the existing free-text `specialization`/`description` fields on `coach_profiles`. Not defined in the approved spec's data model either; noted here for transparency.
- No new photo-upload feature — coach avatar in the marketplace reuses the existing `users.photo_url` (the Telegram profile photo already on every user row), the same way team cards fall back to an initial letter when there's no photo.
- **Every new repository function MUST get a matching fake implementation in `backend/tests/conftest.py`'s `client` fixture.** This codebase's `client` fixture (`backend/tests/conftest.py`) overrides `get_db` to yield `None` and monkeypatches every repository function actually exercised by tests to an in-memory dict-backed fake (see the `metrics_module`/`teams_module` fakes already in that file, ~1800 lines in). A route test calling a repository function that has no fake will crash with `AttributeError: 'NoneType' object has no attribute ...` — this is not a bug to debug, it means a fake is missing. Real `asyncpg` SQL in the repository modules is exercised only by Task 7's manual smoke test against the actually-running dev stack, never by pytest.
- Notification wiring (a `booking_confirmed` notification category) is explicitly deferred — the spec marks it non-blocking. Do not add it in this plan.
- Follow existing repository conventions exactly: parameterized queries only (`$1`, `$2`, ...), explicit field-list constants for `SELECT`/`RETURNING`, `dict(row)` return values, `result.endswith("1")` to detect a single-row `UPDATE`/`DELETE` affected.
- Migration files live in `database/patches/`, named `NNNN_description.sql`, next free number is `0019` (see `database/patches/0018_training_feedback.sql`). They apply automatically on backend startup (`app/database.py::run_migrations`, tracked in `schema_versions`) — no manual `psql` migration step in production.

---

### Task 1: Database migration

**Files:**
- Create: `database/patches/0019_coach_marketplace.sql`

**Interfaces:**
- Produces: columns `coach_profiles.is_listed`, `.price_per_session`, `.currency`, `.offers_online`, `.offers_offline`, `.location`, `.session_duration_minutes`; tables `coach_availability_templates`, `bookings`, `coach_reviews` (exact columns below) — every later task's SQL depends on these existing.

- [ ] **Step 1: Write the migration**

```sql
-- database/patches/0019_coach_marketplace.sql
-- Coach marketplace: public listing, weekly availability, bookings, reviews.
-- Purely additive — is_listed defaults FALSE, nothing changes for an
-- existing coach or athlete until a coach opts in.

ALTER TABLE coach_profiles
    ADD COLUMN is_listed                BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN price_per_session        NUMERIC(10, 2),
    ADD COLUMN currency                 TEXT NOT NULL DEFAULT 'RUB',
    ADD COLUMN offers_online            BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN offers_offline           BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN location                 TEXT,
    ADD COLUMN session_duration_minutes SMALLINT CHECK (session_duration_minutes > 0);

-- Recurring weekly windows a coach is bookable in. Overlap between two
-- windows on the same weekday for the same coach is rejected in the
-- repository layer (app/repositories/coach_marketplace.py), not here —
-- keeps this patch free of Postgres extension requirements.
CREATE TABLE coach_availability_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_user_id   UUID NOT NULL REFERENCES coach_profiles(user_id) ON DELETE CASCADE,
    weekday         SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=Monday .. 6=Sunday
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL CHECK (end_time > start_time),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX coach_availability_by_coach ON coach_availability_templates(coach_user_id);

-- A confirmed booking always has a linked personal Training (created in the
-- same transaction) — that's what makes it show up in the athlete's
-- existing calendar/dashboard for free. training_id is NOT NULL because
-- there is no valid state where a booking exists without one.
CREATE TABLE bookings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_user_id       UUID NOT NULL REFERENCES coach_profiles(user_id),
    athlete_user_id     UUID NOT NULL REFERENCES users(id),
    starts_at           TIMESTAMPTZ NOT NULL,
    duration_minutes    SMALLINT NOT NULL CHECK (duration_minutes > 0),
    format              TEXT NOT NULL CHECK (format IN ('online', 'offline')),
    price_per_session   NUMERIC(10, 2),  -- snapshot at booking time
    currency            TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
    training_id         UUID NOT NULL REFERENCES trainings(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT bookings_no_double_book UNIQUE (coach_user_id, starts_at)
);

CREATE INDEX bookings_athlete ON bookings(athlete_user_id, starts_at);
CREATE INDEX bookings_coach ON bookings(coach_user_id, starts_at);

-- One review per booking, only by the athlete who was on it, only once
-- that booking is (derived-)completed — enforced in the service/route
-- layer, not here.
CREATE TABLE coach_reviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id      UUID NOT NULL UNIQUE REFERENCES bookings(id),
    coach_user_id   UUID NOT NULL REFERENCES coach_profiles(user_id),
    athlete_user_id UUID NOT NULL REFERENCES users(id),
    rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    text            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX coach_reviews_by_coach ON coach_reviews(coach_user_id);
```

- [ ] **Step 2: Apply it against the running local dev database and verify**

The dev stack (`docker-compose.dev.yml`) is already running from earlier this session. Restarting the `backend` container re-runs `run_migrations`, which picks up any patch numbered higher than the current `schema_versions` max automatically:

```bash
docker compose -f docker-compose.dev.yml restart backend
docker compose -f docker-compose.dev.yml logs backend --tail 20
```

Expected in the logs: `Applying patch 0019_coach_marketplace.sql (version 19)` and no error/traceback. Then confirm the shapes landed:

```bash
docker compose -f docker-compose.dev.yml exec postgres psql -U teamflow -d teamflow_sandbox -c "\d coach_profiles" -c "\d bookings" -c "\d coach_availability_templates" -c "\d coach_reviews"
```

Expected: `coach_profiles` lists the 7 new columns; the three new tables exist with the columns/constraints above (`\d bookings` should show the `bookings_no_double_book` unique constraint).

- [ ] **Step 3: Commit**

```bash
git add database/patches/0019_coach_marketplace.sql
git commit -m "$(cat <<'EOF'
Add coach marketplace schema (listing, availability, bookings, reviews)

Purely additive: is_listed defaults false, nothing changes for existing
coaches/athletes until a coach opts in. See spec at
docs/superpowers/specs/2026-09-05-coach-marketplace-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Coach marketplace settings (opt in, price, formats, location)

**Files:**
- Create: `backend/app/schemas/coach_marketplace.py`
- Create: `backend/app/repositories/coach_marketplace.py`
- Create: `backend/app/api/routes/coaches.py`
- Modify: `backend/app/main.py` — register `coaches.router`
- Modify: `backend/tests/conftest.py` — fake `coach_marketplace_module` functions
- Create: `backend/tests/test_coach_marketplace_api.py`

**Interfaces:**
- Consumes: `get_current_user`, `get_db` (`app.api.deps`), `NotFoundError`/`APIError` (`app.core.exceptions`), `profiles_repo.get_coach_profile` (`app.repositories.profiles`, existing).
- Produces: `repositories.coach_marketplace.get_settings(conn, user_id) -> dict | None`, `repositories.coach_marketplace.upsert_settings(conn, user_id, **fields) -> dict` — used by Task 3 (availability) and Task 4 (public listing) to read the same settings row.

- [ ] **Step 1: Write the schema**

```python
# backend/app/schemas/coach_marketplace.py
from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class CoachMarketplaceSettingsIn(BaseModel):
    is_listed: bool
    price_per_session: float | None = Field(default=None, ge=0)
    currency: str = Field(default="RUB", min_length=3, max_length=3)
    offers_online: bool = False
    offers_offline: bool = False
    location: str | None = Field(default=None, max_length=200)
    session_duration_minutes: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _validate_listing_requirements(self) -> "CoachMarketplaceSettingsIn":
        if not self.is_listed:
            return self
        if not (self.offers_online or self.offers_offline):
            raise ValueError("choose at least one training format before listing")
        if self.price_per_session is None:
            raise ValueError("set a price before listing")
        if self.session_duration_minutes is None:
            raise ValueError("set a session duration before listing")
        return self


class CoachMarketplaceSettingsOut(BaseModel):
    user_id: UUID
    is_listed: bool
    price_per_session: float | None
    currency: str
    offers_online: bool
    offers_offline: bool
    location: str | None
    session_duration_minutes: int | None
```

- [ ] **Step 2: Write the failing test**

```python
# backend/tests/test_coach_marketplace_api.py
from __future__ import annotations

from tests.test_teams_api import _create_coach_profile


def _settings_payload(**overrides):
    payload = {
        "is_listed": True,
        "price_per_session": 2000,
        "currency": "RUB",
        "offers_online": True,
        "offers_offline": False,
        "location": "Москва",
        "session_duration_minutes": 60,
    }
    payload.update(overrides)
    return payload


def test_coach_can_set_and_read_marketplace_settings(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)

    put_resp = client.put("/api/coaches/me/marketplace-settings", headers=headers, json=_settings_payload())
    assert put_resp.status_code == 200, put_resp.text
    assert put_resp.json()["is_listed"] is True
    assert put_resp.json()["price_per_session"] == 2000

    get_resp = client.get("/api/coaches/me/marketplace-settings", headers=headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["location"] == "Москва"


def test_cannot_list_without_price_or_format(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)

    resp = client.put(
        "/api/coaches/me/marketplace-settings",
        headers=headers,
        json=_settings_payload(price_per_session=None),
    )
    assert resp.status_code == 422


def test_marketplace_settings_require_coach_profile_first(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.put("/api/coaches/me/marketplace-settings", headers=headers, json=_settings_payload())
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "coach_profile_required"
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd backend && python -m pytest tests/test_coach_marketplace_api.py -v`
Expected: FAIL — `404 Not Found` (no such route) or `ModuleNotFoundError`, since neither the route nor the repository module exist yet.

- [ ] **Step 4: Write the repository**

```python
# backend/app/repositories/coach_marketplace.py
"""Data access for coach marketplace settings, public discovery and
availability. All queries are parameterized."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

_SETTINGS_FIELDS = (
    "user_id, is_listed, price_per_session, currency, offers_online, "
    "offers_offline, location, session_duration_minutes"
)


async def get_settings(conn: asyncpg.Connection, user_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"SELECT {_SETTINGS_FIELDS} FROM coach_profiles WHERE user_id = $1", user_id
    )
    return dict(row) if row else None


async def upsert_settings(
    conn: asyncpg.Connection,
    user_id: UUID,
    *,
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
        UPDATE coach_profiles SET
            is_listed = $2,
            price_per_session = $3,
            currency = $4,
            offers_online = $5,
            offers_offline = $6,
            location = $7,
            session_duration_minutes = $8
        WHERE user_id = $1
        RETURNING {_SETTINGS_FIELDS}
        """,
        user_id,
        is_listed,
        price_per_session,
        currency,
        offers_online,
        offers_offline,
        location,
        session_duration_minutes,
    )
    return dict(row) if row else None
```

`upsert_settings` returns `None` when there's no `coach_profiles` row yet (the `UPDATE` matches zero rows) — the route below turns that into the same 409 `coach_profile_required` the team-creation flow already uses.

- [ ] **Step 5: Write the route**

```python
# backend/app/api/routes/coaches.py
from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db
from app.core.exceptions import APIError
from app.repositories import coach_marketplace as marketplace_repo
from app.repositories import profiles as profiles_repo
from app.schemas.coach_marketplace import CoachMarketplaceSettingsIn, CoachMarketplaceSettingsOut

router = APIRouter(prefix="/api/coaches", tags=["coach-marketplace"])


def _require_coach_profile_error() -> APIError:
    return APIError(
        "create a coach profile before configuring marketplace settings",
        code="coach_profile_required",
        status_code=409,
    )


@router.get("/me/marketplace-settings", response_model=CoachMarketplaceSettingsOut)
async def get_my_marketplace_settings(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> CoachMarketplaceSettingsOut:
    if await profiles_repo.get_coach_profile(conn, user["id"]) is None:
        raise _require_coach_profile_error()
    settings = await marketplace_repo.get_settings(conn, user["id"])
    return CoachMarketplaceSettingsOut(**settings)


@router.put("/me/marketplace-settings", response_model=CoachMarketplaceSettingsOut)
async def update_my_marketplace_settings(
    payload: CoachMarketplaceSettingsIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> CoachMarketplaceSettingsOut:
    if await profiles_repo.get_coach_profile(conn, user["id"]) is None:
        raise _require_coach_profile_error()
    updated = await marketplace_repo.upsert_settings(conn, user["id"], **payload.model_dump())
    if updated is None:
        raise _require_coach_profile_error()
    return CoachMarketplaceSettingsOut(**updated)
```

- [ ] **Step 6: Register the router**

In `backend/app/main.py`, add `coaches` to the `from app.api.routes import (...)` block (alphabetically, between `calendar` and `dev_auth`), and add near the other `include_router` calls:

```python
    app.include_router(coaches.router)
```

- [ ] **Step 7: Add fakes to `conftest.py`**

In `backend/tests/conftest.py`, inside the `client` fixture: add `import app.repositories.coach_marketplace as coach_marketplace_module` next to the other repository imports at the top of the fixture, and add a fake settings store plus these functions near the other `profiles_module`/`coach_store` fakes (`coach_store` already exists from the profile fakes — reuse it, since marketplace settings live on the same `coach_profiles` row):

```python
    async def fake_get_marketplace_settings(conn, user_id):
        profile = coach_store.get(user_id)
        if profile is None:
            return None
        return {
            "user_id": user_id,
            "is_listed": profile.get("is_listed", False),
            "price_per_session": profile.get("price_per_session"),
            "currency": profile.get("currency", "RUB"),
            "offers_online": profile.get("offers_online", False),
            "offers_offline": profile.get("offers_offline", False),
            "location": profile.get("location"),
            "session_duration_minutes": profile.get("session_duration_minutes"),
        }

    async def fake_upsert_marketplace_settings(conn, user_id, **fields):
        profile = coach_store.get(user_id)
        if profile is None:
            return None
        profile.update(fields)
        return await fake_get_marketplace_settings(conn, user_id)

    monkeypatch.setattr(coach_marketplace_module, "get_settings", fake_get_marketplace_settings)
    monkeypatch.setattr(coach_marketplace_module, "upsert_settings", fake_upsert_marketplace_settings)
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_coach_marketplace_api.py -v`
Expected: 3 passed.

- [ ] **Step 9: Run the full backend test suite to confirm no regressions**

Run: `cd backend && python -m pytest -q`
Expected: all tests pass (same count as before plus 3).

- [ ] **Step 10: Commit**

```bash
git add backend/app/schemas/coach_marketplace.py backend/app/repositories/coach_marketplace.py backend/app/api/routes/coaches.py backend/app/main.py backend/tests/conftest.py backend/tests/test_coach_marketplace_api.py
git commit -m "$(cat <<'EOF'
Add coach marketplace settings endpoint

GET/PUT /api/coaches/me/marketplace-settings — a coach opts into the
marketplace, sets price/formats/location. Requires an existing coach
profile (409 coach_profile_required otherwise), mirroring the existing
team-creation guard.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Weekly availability template

**Files:**
- Modify: `backend/app/schemas/coach_marketplace.py` — add `AvailabilityWindowIn`, `AvailabilityWindowOut`
- Modify: `backend/app/repositories/coach_marketplace.py` — add `list_availability`, `replace_availability`
- Modify: `backend/app/api/routes/coaches.py` — add GET/PUT `/me/availability`
- Modify: `backend/tests/conftest.py` — fakes for the two new repo functions
- Modify: `backend/tests/test_coach_marketplace_api.py` — new tests

**Interfaces:**
- Consumes: `_require_coach_profile_error`, `router` (from Task 2, same file).
- Produces: `repositories.coach_marketplace.list_availability(conn, coach_user_id) -> list[dict]` — consumed by Task 4's slot computation.

- [ ] **Step 1: Add the schema**

Append to `backend/app/schemas/coach_marketplace.py`:

```python
from datetime import time


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

(Move the `from datetime import time` import to the top of the file alongside the existing imports rather than leaving it inline — shown here separately only to make the diff clear.)

- [ ] **Step 2: Write the failing tests**

Append to `backend/tests/test_coach_marketplace_api.py`:

```python
def test_coach_can_replace_weekly_availability(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)

    resp = client.put(
        "/api/coaches/me/availability",
        headers=headers,
        json=[
            {"weekday": 0, "start_time": "10:00:00", "end_time": "12:00:00"},
            {"weekday": 2, "start_time": "14:00:00", "end_time": "16:00:00"},
        ],
    )
    assert resp.status_code == 200, resp.text
    assert len(resp.json()) == 2

    get_resp = client.get("/api/coaches/me/availability", headers=headers)
    assert get_resp.status_code == 200
    assert {w["weekday"] for w in get_resp.json()} == {0, 2}


def test_overlapping_availability_windows_rejected(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)

    resp = client.put(
        "/api/coaches/me/availability",
        headers=headers,
        json=[
            {"weekday": 0, "start_time": "10:00:00", "end_time": "12:00:00"},
            {"weekday": 0, "start_time": "11:00:00", "end_time": "13:00:00"},
        ],
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "overlapping_availability"
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_coach_marketplace_api.py -k availability -v`
Expected: FAIL (404, routes don't exist yet).

- [ ] **Step 4: Add the repository functions**

Append to `backend/app/repositories/coach_marketplace.py`:

```python
_AVAILABILITY_FIELDS = "id, weekday, start_time, end_time"


def _windows_overlap(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return a["weekday"] == b["weekday"] and a["start_time"] < b["end_time"] and b["start_time"] < a["end_time"]


def has_overlap(windows: list[dict[str, Any]]) -> bool:
    return any(_windows_overlap(a, b) for i, a in enumerate(windows) for b in windows[i + 1 :])


async def list_availability(conn: asyncpg.Connection, coach_user_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"SELECT {_AVAILABILITY_FIELDS} FROM coach_availability_templates "
        "WHERE coach_user_id = $1 ORDER BY weekday, start_time",
        coach_user_id,
    )
    return [dict(row) for row in rows]


async def replace_availability(
    conn: asyncpg.Connection, coach_user_id: UUID, windows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    async with conn.transaction():
        await conn.execute("DELETE FROM coach_availability_templates WHERE coach_user_id = $1", coach_user_id)
        inserted = []
        for window in windows:
            row = await conn.fetchrow(
                f"""
                INSERT INTO coach_availability_templates (coach_user_id, weekday, start_time, end_time)
                VALUES ($1, $2, $3, $4)
                RETURNING {_AVAILABILITY_FIELDS}
                """,
                coach_user_id,
                window["weekday"],
                window["start_time"],
                window["end_time"],
            )
            inserted.append(dict(row))
        return inserted
```

`has_overlap` is a plain function (no `conn`) so the route can validate before touching the database at all.

- [ ] **Step 5: Add the routes**

Append to `backend/app/api/routes/coaches.py` (add `AvailabilityWindowIn, AvailabilityWindowOut` to the existing schema import):

```python
@router.get("/me/availability", response_model=list[AvailabilityWindowOut])
async def get_my_availability(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[AvailabilityWindowOut]:
    if await profiles_repo.get_coach_profile(conn, user["id"]) is None:
        raise _require_coach_profile_error()
    windows = await marketplace_repo.list_availability(conn, user["id"])
    return [AvailabilityWindowOut(**w) for w in windows]


@router.put("/me/availability", response_model=list[AvailabilityWindowOut])
async def replace_my_availability(
    payload: list[AvailabilityWindowIn],
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[AvailabilityWindowOut]:
    if await profiles_repo.get_coach_profile(conn, user["id"]) is None:
        raise _require_coach_profile_error()
    windows = [w.model_dump() for w in payload]
    if marketplace_repo.has_overlap(windows):
        raise APIError("availability windows overlap", code="overlapping_availability", status_code=400)
    updated = await marketplace_repo.replace_availability(conn, user["id"], windows)
    return [AvailabilityWindowOut(**w) for w in updated]
```

- [ ] **Step 6: Add fakes to `conftest.py`**

```python
    availability_store: dict = {}

    async def fake_list_availability(conn, coach_user_id):
        return sorted(
            [dict(w) for w in availability_store.get(coach_user_id, [])],
            key=lambda w: (w["weekday"], w["start_time"]),
        )

    async def fake_replace_availability(conn, coach_user_id, windows):
        stored = [{"id": uuid4(), **w} for w in windows]
        availability_store[coach_user_id] = stored
        return stored

    monkeypatch.setattr(coach_marketplace_module, "list_availability", fake_list_availability)
    monkeypatch.setattr(coach_marketplace_module, "replace_availability", fake_replace_availability)
```

(`has_overlap` is a plain function with no DB access — it does **not** get a fake, the real implementation runs in tests too.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_coach_marketplace_api.py -v`
Expected: 5 passed.

- [ ] **Step 8: Full suite + commit**

```bash
cd backend && python -m pytest -q
git add backend/app/schemas/coach_marketplace.py backend/app/repositories/coach_marketplace.py backend/app/api/routes/coaches.py backend/tests/conftest.py backend/tests/test_coach_marketplace_api.py
git commit -m "$(cat <<'EOF'
Add coach weekly availability template endpoint

GET/PUT /api/coaches/me/availability — full-replace semantics (coach
resubmits the whole week on save). Overlap between windows on the same
weekday is rejected before touching the database.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Public coach discovery — list, profile, open slots

**Files:**
- Create: `backend/app/schemas/coach_search.py`
- Create: `backend/app/repositories/coach_reviews.py` (read-side only in this task; Task 6 adds writes)
- Modify: `backend/app/repositories/coach_marketplace.py` — add `list_coaches`, `get_public_profile`, `compute_open_slots`
- Modify: `backend/app/api/routes/coaches.py` — add `GET ""`, `GET "/{user_id}"`, `GET "/{user_id}/slots"`
- Modify: `backend/tests/conftest.py`
- Modify: `backend/tests/test_coach_marketplace_api.py`

**Interfaces:**
- Consumes: `list_availability` (Task 3), `get_settings` (Task 2), `users_repo` fields (`first_name`, `last_name`, `photo_url`) — already faked in `conftest.py`'s `users_store`.
- Produces: `repositories.coach_reviews.get_rating_summary(conn, coach_user_id) -> {"average": float | None, "count": int}` — consumed again by Task 6.

- [ ] **Step 1: Write the schemas**

```python
# backend/app/schemas/coach_search.py
from __future__ import annotations

from datetime import date, datetime, time
from uuid import UUID

from pydantic import BaseModel


class CoachCardOut(BaseModel):
    user_id: UUID
    full_name: str
    photo_url: str | None
    sport: str
    specialization: str | None
    description: str | None
    experience_years: int | None
    average_rating: float | None
    review_count: int
    price_per_session: float | None
    currency: str
    location: str | None
    offers_online: bool
    offers_offline: bool
    next_available_slot: datetime | None


class CoachPublicProfileOut(CoachCardOut):
    session_duration_minutes: int | None
    availability: list[dict]  # {weekday, start_time, end_time} — reuses AvailabilityWindowOut shape
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


CoachPublicProfileOut.model_rebuild()
```

- [ ] **Step 2: Write the failing tests**

Append to `backend/tests/test_coach_marketplace_api.py`:

```python
from datetime import date, timedelta


def _list_a_coach(client, token) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token, sport="Баскетбол")
    client.put("/api/coaches/me/marketplace-settings", headers=headers, json=_settings_payload())
    client.put(
        "/api/coaches/me/availability",
        headers=headers,
        json=[{"weekday": 0, "start_time": "10:00:00", "end_time": "12:00:00"}],
    )


def test_listed_coach_appears_in_public_list_and_profile(logged_in_client) -> None:
    client, token = logged_in_client
    _list_a_coach(client, token)
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).json()

    list_resp = client.get("/api/coaches")
    assert list_resp.status_code == 200
    assert any(c["user_id"] == me["id"] for c in list_resp.json())

    profile_resp = client.get(f"/api/coaches/{me['id']}")
    assert profile_resp.status_code == 200
    assert profile_resp.json()["sport"] == "Баскетбол"
    assert profile_resp.json()["average_rating"] is None
    assert profile_resp.json()["review_count"] == 0


def test_unlisted_coach_does_not_appear(logged_in_client) -> None:
    client, token = logged_in_client
    _create_coach_profile(client, token)

    resp = client.get("/api/coaches")
    assert resp.status_code == 200
    assert resp.json() == []


def test_coach_list_filters_by_sport_and_price(logged_in_client, login_as) -> None:
    client, token = logged_in_client
    _list_a_coach(client, token)

    other_token = login_as(880001, first_name="Other")
    other_headers = {"Authorization": f"Bearer {other_token}"}
    _create_coach_profile(client, other_token, sport="Плавание")
    client.put(
        "/api/coaches/me/marketplace-settings",
        headers=other_headers,
        json=_settings_payload(price_per_session=5000),
    )
    client.put(
        "/api/coaches/me/availability",
        headers=other_headers,
        json=[{"weekday": 1, "start_time": "09:00:00", "end_time": "11:00:00"}],
    )

    by_sport = client.get("/api/coaches", params={"sport": "Баскетбол"}).json()
    assert len(by_sport) == 1
    assert by_sport[0]["sport"] == "Баскетбол"

    by_price = client.get("/api/coaches", params={"max_price": 3000}).json()
    assert all(c["price_per_session"] is None or float(c["price_per_session"]) <= 3000 for c in by_price)


def test_open_slots_computed_from_availability(logged_in_client) -> None:
    client, token = logged_in_client
    _list_a_coach(client, token)
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).json()

    today = date.today()
    days_until_monday = (7 - today.weekday()) % 7  # weekday 0 == Monday
    next_monday = today + timedelta(days=days_until_monday or 7)

    resp = client.get(
        f"/api/coaches/{me['id']}/slots",
        params={"from_date": next_monday.isoformat(), "to_date": next_monday.isoformat()},
    )
    assert resp.status_code == 200
    assert resp.json() == [
        {"starts_at": f"{next_monday.isoformat()}T10:00:00", "duration_minutes": 60},
        {"starts_at": f"{next_monday.isoformat()}T11:00:00", "duration_minutes": 60},
    ]
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_coach_marketplace_api.py -k "list_ or profile or slots" -v`
Expected: FAIL (routes don't exist).

- [ ] **Step 4: Write `coach_reviews.py` (read side)**

```python
# backend/app/repositories/coach_reviews.py
"""Data access for coach reviews. All queries are parameterized."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg


async def get_rating_summary(conn: asyncpg.Connection, coach_user_id: UUID) -> dict[str, Any]:
    row = await conn.fetchrow(
        "SELECT AVG(rating)::float AS average, COUNT(*) AS count FROM coach_reviews WHERE coach_user_id = $1",
        coach_user_id,
    )
    return {"average": row["average"], "count": row["count"]}


async def list_recent_for_coach(conn: asyncpg.Connection, coach_user_id: UUID, limit: int = 10) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT r.id, u.first_name AS athlete_first_name, r.rating, r.text, r.created_at
        FROM coach_reviews r
        JOIN users u ON u.id = r.athlete_user_id
        WHERE r.coach_user_id = $1
        ORDER BY r.created_at DESC
        LIMIT $2
        """,
        coach_user_id,
        limit,
    )
    return [dict(row) for row in rows]
```

- [ ] **Step 5: Add discovery functions to `coach_marketplace.py`**

Add these two imports to the top of `backend/app/repositories/coach_marketplace.py` (alongside the existing `import asyncpg`):

```python
from datetime import date, datetime, time, timedelta

from app.repositories import coach_reviews as coach_reviews_repo
```

Then append:

```python


def _card_row_to_dict(row: dict[str, Any], rating: dict[str, Any], next_slot: datetime | None) -> dict[str, Any]:
    return {
        "user_id": row["user_id"],
        "full_name": row["full_name"],
        "photo_url": row["photo_url"],
        "sport": row["sport"],
        "specialization": row["specialization"],
        "description": row["description"],
        "experience_years": row["experience_years"],
        "average_rating": rating["average"],
        "review_count": rating["count"],
        "price_per_session": row["price_per_session"],
        "currency": row["currency"],
        "location": row["location"],
        "offers_online": row["offers_online"],
        "offers_offline": row["offers_offline"],
        "next_available_slot": next_slot,
    }


async def list_listed_coaches(
    conn: asyncpg.Connection,
    *,
    sport: str | None = None,
    location: str | None = None,
    max_price=None,
    min_rating: float | None = None,
    training_format: str | None = None,
    min_experience_years: int | None = None,
) -> list[dict[str, Any]]:
    conditions = ["cp.is_listed = TRUE"]
    params: list[Any] = []

    def add(condition: str, value: Any) -> None:
        params.append(value)
        conditions.append(condition.format(len(params)))

    if sport:
        add("cp.sport ILIKE '%' || ${} || '%'", sport)
    if location:
        add("cp.location ILIKE '%' || ${} || '%'", location)
    if max_price is not None:
        add("cp.price_per_session <= ${}", max_price)
    if min_experience_years is not None:
        add("cp.experience_years >= ${}", min_experience_years)
    if training_format == "online":
        conditions.append("cp.offers_online = TRUE")
    elif training_format == "offline":
        conditions.append("cp.offers_offline = TRUE")

    rows = await conn.fetch(
        f"""
        SELECT cp.user_id, cp.full_name, u.photo_url, cp.sport, cp.specialization, cp.description,
               cp.experience_years, cp.price_per_session, cp.currency, cp.location,
               cp.offers_online, cp.offers_offline
        FROM coach_profiles cp
        JOIN users u ON u.id = cp.user_id
        WHERE {" AND ".join(conditions)}
        ORDER BY cp.full_name
        """,
        *params,
    )

    cards = []
    for row in rows:
        row = dict(row)
        rating = await coach_reviews_repo.get_rating_summary(conn, row["user_id"])
        if min_rating is not None and (rating["average"] or 0) < min_rating:
            continue
        next_slot = await _next_available_slot(conn, row["user_id"])
        cards.append(_card_row_to_dict(row, rating, next_slot))
    return cards


async def get_public_profile(conn: asyncpg.Connection, coach_user_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        """
        SELECT cp.user_id, cp.full_name, u.photo_url, cp.sport, cp.specialization, cp.description,
               cp.experience_years, cp.price_per_session, cp.currency, cp.location,
               cp.offers_online, cp.offers_offline, cp.session_duration_minutes
        FROM coach_profiles cp
        JOIN users u ON u.id = cp.user_id
        WHERE cp.user_id = $1 AND cp.is_listed = TRUE
        """,
        coach_user_id,
    )
    if row is None:
        return None
    row = dict(row)
    rating = await coach_reviews_repo.get_rating_summary(conn, coach_user_id)
    next_slot = await _next_available_slot(conn, coach_user_id)
    card = _card_row_to_dict(row, rating, next_slot)
    card["session_duration_minutes"] = row["session_duration_minutes"]
    card["availability"] = await list_availability(conn, coach_user_id)
    card["recent_reviews"] = await coach_reviews_repo.list_recent_for_coach(conn, coach_user_id)
    return card


async def compute_open_slots(
    conn: asyncpg.Connection, coach_user_id: UUID, from_date: date, to_date: date
) -> list[dict[str, Any]]:
    settings = await get_settings(conn, coach_user_id)
    duration = (settings or {}).get("session_duration_minutes")
    if not duration:
        return []
    windows = await list_availability(conn, coach_user_id)
    booked_rows = await conn.fetch(
        "SELECT starts_at FROM bookings WHERE coach_user_id = $1 AND status = 'confirmed' "
        "AND starts_at >= $2 AND starts_at < $3",
        coach_user_id,
        datetime.combine(from_date, time.min),
        datetime.combine(to_date + timedelta(days=1), time.min),
    )
    booked = {row["starts_at"] for row in booked_rows}

    slots: list[dict[str, Any]] = []
    day = from_date
    while day <= to_date:
        for window in windows:
            if window["weekday"] != day.weekday():
                continue
            cursor = datetime.combine(day, window["start_time"])
            window_end = datetime.combine(day, window["end_time"])
            while cursor + timedelta(minutes=duration) <= window_end:
                if cursor not in booked and cursor > datetime.now():
                    slots.append({"starts_at": cursor, "duration_minutes": duration})
                cursor += timedelta(minutes=duration)
        day += timedelta(days=1)
    return sorted(slots, key=lambda s: s["starts_at"])


async def _next_available_slot(conn: asyncpg.Connection, coach_user_id: UUID) -> datetime | None:
    today = date.today()
    slots = await compute_open_slots(conn, coach_user_id, today, today + timedelta(days=28))
    return slots[0]["starts_at"] if slots else None
```

- [ ] **Step 6: Add the routes**

Append to `backend/app/api/routes/coaches.py` (extend imports: `from datetime import date`, `from app.schemas.coach_search import CoachCardOut, CoachPublicProfileOut, OpenSlotOut`, `from app.core.exceptions import NotFoundError`):

```python
@router.get("", response_model=list[CoachCardOut])
async def list_coaches(
    sport: str | None = None,
    location: str | None = None,
    max_price=None,
    min_rating: float | None = None,
    format: str | None = None,
    min_experience_years: int | None = None,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[CoachCardOut]:
    cards = await marketplace_repo.list_listed_coaches(
        conn,
        sport=sport,
        location=location,
        max_price=max_price,
        min_rating=min_rating,
        training_format=format,
        min_experience_years=min_experience_years,
    )
    return [CoachCardOut(**c) for c in cards]


@router.get("/{coach_user_id}", response_model=CoachPublicProfileOut)
async def get_coach_public_profile(
    coach_user_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> CoachPublicProfileOut:
    profile = await marketplace_repo.get_public_profile(conn, coach_user_id)
    if profile is None:
        raise NotFoundError("coach not found or not listed")
    return CoachPublicProfileOut(**profile)


@router.get("/{coach_user_id}/slots", response_model=list[OpenSlotOut])
async def get_coach_open_slots(
    coach_user_id: UUID,
    from_date: date,
    to_date: date,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[OpenSlotOut]:
    slots = await marketplace_repo.compute_open_slots(conn, coach_user_id, from_date, to_date)
    return [OpenSlotOut(**s) for s in slots]
```

(Add `from uuid import UUID` to the file's imports if not already present from Task 2/3 — it is, via the schema imports' `UUID` usage is separate; the route file itself needs its own `from uuid import UUID` for the `coach_user_id: UUID` path param type.)

- [ ] **Step 7: Add fakes to `conftest.py`**

```python
    import app.repositories.coach_reviews as coach_reviews_module

    reviews_store: dict = {}

    async def fake_get_rating_summary(conn, coach_user_id):
        ratings = [r["rating"] for r in reviews_store.values() if r["coach_user_id"] == coach_user_id]
        return {"average": (sum(ratings) / len(ratings)) if ratings else None, "count": len(ratings)}

    async def fake_list_recent_for_coach(conn, coach_user_id, limit=10):
        items = [r for r in reviews_store.values() if r["coach_user_id"] == coach_user_id]
        items.sort(key=lambda r: r["created_at"], reverse=True)
        result = []
        for r in items[:limit]:
            author = _find_user_by_id(r["athlete_user_id"])
            result.append(
                {
                    "id": r["id"],
                    "athlete_first_name": author["first_name"] if author else "",
                    "rating": r["rating"],
                    "text": r["text"],
                    "created_at": r["created_at"],
                }
            )
        return result

    monkeypatch.setattr(coach_reviews_module, "get_rating_summary", fake_get_rating_summary)
    monkeypatch.setattr(coach_reviews_module, "list_recent_for_coach", fake_list_recent_for_coach)

    bookings_store: dict = {}

    async def fake_list_listed_coaches(conn, *, sport=None, location=None, max_price=None, min_rating=None, training_format=None, min_experience_years=None):
        cards = []
        for user_id, profile in coach_store.items():
            if not profile.get("is_listed"):
                continue
            if sport and sport.lower() not in profile["sport"].lower():
                continue
            if location and (not profile.get("location") or location.lower() not in profile["location"].lower()):
                continue
            if max_price is not None and profile.get("price_per_session") is not None and float(profile["price_per_session"]) > float(max_price):
                continue
            if min_experience_years is not None and (profile.get("experience_years") or 0) < min_experience_years:
                continue
            if training_format == "online" and not profile.get("offers_online"):
                continue
            if training_format == "offline" and not profile.get("offers_offline"):
                continue
            rating = await fake_get_rating_summary(conn, user_id)
            if min_rating is not None and (rating["average"] or 0) < min_rating:
                continue
            user_row = _find_user_by_id(user_id)
            next_slot = await fake_compute_open_slots(conn, user_id, date.today(), date.today() + timedelta(days=28))
            cards.append(
                {
                    "user_id": user_id,
                    "full_name": profile["full_name"],
                    "photo_url": user_row["photo_url"] if user_row else None,
                    "sport": profile["sport"],
                    "specialization": profile.get("specialization"),
                    "description": profile.get("description"),
                    "experience_years": profile.get("experience_years"),
                    "average_rating": rating["average"],
                    "review_count": rating["count"],
                    "price_per_session": profile.get("price_per_session"),
                    "currency": profile.get("currency", "RUB"),
                    "location": profile.get("location"),
                    "offers_online": profile.get("offers_online", False),
                    "offers_offline": profile.get("offers_offline", False),
                    "next_available_slot": next_slot[0]["starts_at"] if next_slot else None,
                }
            )
        return cards

    async def fake_get_public_profile(conn, coach_user_id):
        profile = coach_store.get(coach_user_id)
        if profile is None or not profile.get("is_listed"):
            return None
        cards = await fake_list_listed_coaches(conn)
        card = next((c for c in cards if c["user_id"] == coach_user_id), None)
        if card is None:
            return None
        card = dict(card)
        card["session_duration_minutes"] = profile.get("session_duration_minutes")
        card["availability"] = await fake_list_availability(conn, coach_user_id)
        card["recent_reviews"] = await fake_list_recent_for_coach(conn, coach_user_id)
        return card

    async def fake_compute_open_slots(conn, coach_user_id, from_date, to_date):
        profile = coach_store.get(coach_user_id) or {}
        duration = profile.get("session_duration_minutes")
        if not duration:
            return []
        windows = await fake_list_availability(conn, coach_user_id)
        booked = {b["starts_at"] for b in bookings_store.values() if b["coach_user_id"] == coach_user_id and b["status"] == "confirmed"}
        slots = []
        day = from_date
        while day <= to_date:
            for window in windows:
                if window["weekday"] != day.weekday():
                    continue
                cursor = datetime.combine(day, window["start_time"])
                window_end = datetime.combine(day, window["end_time"])
                while cursor + timedelta(minutes=duration) <= window_end:
                    if cursor not in booked and cursor > datetime.now():
                        slots.append({"starts_at": cursor, "duration_minutes": duration})
                    cursor += timedelta(minutes=duration)
            day += timedelta(days=1)
        return sorted(slots, key=lambda s: s["starts_at"])

    monkeypatch.setattr(coach_marketplace_module, "list_listed_coaches", fake_list_listed_coaches)
    monkeypatch.setattr(coach_marketplace_module, "get_public_profile", fake_get_public_profile)
    monkeypatch.setattr(coach_marketplace_module, "compute_open_slots", fake_compute_open_slots)
```

Add `from datetime import date, datetime, timedelta` to `conftest.py`'s existing top-of-file datetime import line if any of those three names aren't already imported there (`datetime, timedelta, timezone` already are per the top of the file — just add `date`).

- [ ] **Step 8: Run tests, then the full suite**

Run: `cd backend && python -m pytest tests/test_coach_marketplace_api.py -v && python -m pytest -q`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add backend/app/schemas/coach_search.py backend/app/repositories/coach_reviews.py backend/app/repositories/coach_marketplace.py backend/app/api/routes/coaches.py backend/tests/conftest.py backend/tests/test_coach_marketplace_api.py
git commit -m "$(cat <<'EOF'
Add public coach discovery: list, profile, open slots

GET /api/coaches (filtered), GET /api/coaches/{id}, GET
/api/coaches/{id}/slots. Open slots are computed on read from the weekly
availability template minus confirmed bookings — no materialized slot
table.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Booking creation and listing

**Files:**
- Create: `backend/app/schemas/booking.py`
- Create: `backend/app/repositories/bookings.py`
- Modify: `backend/app/repositories/coach_reviews.py` — add a temporary `get_by_booking` stub (Task 4 created this file; Task 6 replaces the stub's body with a real query)
- Create: `backend/app/api/routes/bookings.py`
- Modify: `backend/app/main.py` — register `bookings.router`
- Modify: `backend/tests/conftest.py`
- Create: `backend/tests/test_bookings_api.py`

**Interfaces:**
- Consumes: `coach_marketplace_repo.get_settings`, `.compute_open_slots` (Task 2/4); `trainings_repo.create_training` (existing generic dynamic-kwargs function, no changes needed).
- Produces: `repositories.bookings.create_booking(...)`, `.list_for_athlete(...)`, `.get_booking(...)` — consumed by Task 6.

- [ ] **Step 1: Write the schema**

```python
# backend/app/schemas/booking.py
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class BookingIn(BaseModel):
    coach_user_id: UUID
    starts_at: datetime
    format: str  # "online" | "offline"


class BookingOut(BaseModel):
    id: UUID
    coach_user_id: UUID
    coach_full_name: str
    athlete_user_id: UUID
    starts_at: datetime
    duration_minutes: int
    format: str
    price_per_session: float | None
    currency: str
    status: str
    is_completed: bool
    training_id: UUID
    has_review: bool
```

- [ ] **Step 2: Write the failing tests**

```python
# backend/tests/test_bookings_api.py
from __future__ import annotations

from datetime import date, timedelta

from tests.test_teams_api import _create_coach_profile
from tests.test_coach_marketplace_api import _settings_payload


def _list_coach_with_slot(client, coach_token) -> tuple[str, str]:
    """Returns (coach_user_id, iso datetime of the first open slot)."""
    coach_headers = {"Authorization": f"Bearer {coach_token}"}
    _create_coach_profile(client, coach_token, sport="Теннис")
    client.put("/api/coaches/me/marketplace-settings", headers=coach_headers, json=_settings_payload())
    client.put(
        "/api/coaches/me/availability",
        headers=coach_headers,
        json=[{"weekday": 0, "start_time": "10:00:00", "end_time": "12:00:00"}],
    )
    coach_id = client.get("/api/auth/me", headers=coach_headers).json()["id"]

    today = date.today()
    days_until_monday = (7 - today.weekday()) % 7
    next_monday = today + timedelta(days=days_until_monday or 7)
    slots = client.get(
        f"/api/coaches/{coach_id}/slots",
        params={"from_date": next_monday.isoformat(), "to_date": next_monday.isoformat()},
        headers=coach_headers,
    ).json()
    return coach_id, slots[0]["starts_at"]


def test_athlete_can_book_open_slot_and_it_appears_in_calendar(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_id, slot = _list_coach_with_slot(client, coach_token)

    athlete_token = login_as(890001, first_name="Athlete")
    athlete_headers = {"Authorization": f"Bearer {athlete_token}"}

    resp = client.post(
        "/api/bookings",
        headers=athlete_headers,
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "online"},
    )
    assert resp.status_code == 200, resp.text
    booking = resp.json()
    assert booking["status"] == "confirmed"
    assert booking["is_completed"] is False

    training_resp = client.get(f"/api/trainings/{booking['training_id']}", headers=athlete_headers)
    assert training_resp.status_code == 200
    assert training_resp.json()["type"] == "personal"

    mine = client.get("/api/bookings/me", headers=athlete_headers).json()
    assert len(mine) == 1
    assert mine[0]["id"] == booking["id"]


def test_double_booking_same_slot_rejected(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_id, slot = _list_coach_with_slot(client, coach_token)

    first_token = login_as(890002, first_name="First")
    second_token = login_as(890003, first_name="Second")

    ok = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {first_token}"},
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "online"},
    )
    assert ok.status_code == 200

    conflict = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {second_token}"},
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "online"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "slot_unavailable"


def test_cannot_book_format_coach_does_not_offer(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_id, slot = _list_coach_with_slot(client, coach_token)  # offers_online only, per _settings_payload default

    athlete_token = login_as(890004, first_name="Athlete")
    resp = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {athlete_token}"},
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "offline"},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "format_not_offered"


def test_coach_cannot_book_themselves(logged_in_client) -> None:
    client, coach_token = logged_in_client
    coach_id, slot = _list_coach_with_slot(client, coach_token)

    resp = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {coach_token}"},
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "online"},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "self_booking"
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_bookings_api.py -v`
Expected: FAIL (no such route/module).

- [ ] **Step 4: Write the bookings repository**

`backend/app/repositories/trainings.py` already has a fully generic `create_training(conn, created_by, **fields)` (same dynamic-kwargs shape as `metrics.create_metric`) — it inserts whatever columns are passed as `fields`, so a personal training needs no new repository function at all; call it directly with `type="personal"` and no `team_id`.

```python
# backend/app/repositories/bookings.py
"""Data access for coach-marketplace bookings. All queries are parameterized."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

import asyncpg

from app.repositories import trainings as trainings_repo

_BOOKING_FIELDS = (
    "b.id, b.coach_user_id, cp.full_name AS coach_full_name, b.athlete_user_id, b.starts_at, "
    "b.duration_minutes, b.format, b.price_per_session, b.currency, b.status, b.training_id"
)


async def create_booking(
    conn: asyncpg.Connection,
    *,
    coach_user_id: UUID,
    athlete_user_id: UUID,
    starts_at: datetime,
    duration_minutes: int,
    format: str,
    price_per_session: float | None,
    currency: str,
    location: str | None,
) -> dict[str, Any] | None:
    """Returns None if the slot was already taken (unique-constraint race)."""
    async with conn.transaction():
        training = await trainings_repo.create_training(
            conn,
            athlete_user_id,
            type="personal",
            training_date=starts_at.date(),
            start_time=starts_at.time(),
            duration_minutes=duration_minutes,
            location=location if format == "offline" else "Онлайн",
            description="Бронирование тренера через маркетплейс",
        )
        try:
            row = await conn.fetchrow(
                f"""
                INSERT INTO bookings (
                    coach_user_id, athlete_user_id, starts_at, duration_minutes, format,
                    price_per_session, currency, training_id
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING {_BOOKING_FIELDS.replace("cp.full_name AS coach_full_name, ", "")}
                """,
                coach_user_id,
                athlete_user_id,
                starts_at,
                duration_minutes,
                format,
                price_per_session,
                currency,
                training["id"],
            )
        except asyncpg.UniqueViolationError:
            return None
        result = dict(row)
        result["coach_full_name"] = (
            await conn.fetchrow("SELECT full_name FROM coach_profiles WHERE user_id = $1", coach_user_id)
        )["full_name"]
        return result


async def get_booking(conn: asyncpg.Connection, booking_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"""
        SELECT {_BOOKING_FIELDS} FROM bookings b
        JOIN coach_profiles cp ON cp.user_id = b.coach_user_id
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
        WHERE b.athlete_user_id = $1
        ORDER BY b.starts_at DESC
        """,
        athlete_user_id,
    )
    return [dict(row) for row in rows]


def is_completed(booking: dict[str, Any]) -> bool:
    ends_at = booking["starts_at"] + timedelta(minutes=booking["duration_minutes"])
    return booking["status"] == "confirmed" and datetime.now(ends_at.tzinfo) > ends_at
```

- [ ] **Step 5: Write the route**

```python
# backend/app/api/routes/bookings.py
from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db
from app.core.exceptions import APIError, ForbiddenError, NotFoundError
from app.repositories import bookings as bookings_repo
from app.repositories import coach_marketplace as marketplace_repo
from app.repositories import coach_reviews as coach_reviews_repo
from app.schemas.booking import BookingIn, BookingOut

router = APIRouter(prefix="/api/bookings", tags=["bookings"])


async def _to_out(conn: asyncpg.Connection, booking: dict) -> BookingOut:
    review = await coach_reviews_repo.get_by_booking(conn, booking["id"])
    return BookingOut(
        **booking,
        is_completed=bookings_repo.is_completed(booking),
        has_review=review is not None,
    )


@router.post("", response_model=BookingOut)
async def create_booking(
    payload: BookingIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> BookingOut:
    if payload.coach_user_id == user["id"]:
        raise APIError("cannot book yourself", code="self_booking", status_code=400)

    settings = await marketplace_repo.get_settings(conn, payload.coach_user_id)
    if settings is None or not settings["is_listed"]:
        raise NotFoundError("coach not found or not listed")
    if payload.format == "online" and not settings["offers_online"]:
        raise APIError("coach does not offer this format", code="format_not_offered", status_code=400)
    if payload.format == "offline" and not settings["offers_offline"]:
        raise APIError("coach does not offer this format", code="format_not_offered", status_code=400)

    open_slots = await marketplace_repo.compute_open_slots(
        conn, payload.coach_user_id, payload.starts_at.date(), payload.starts_at.date()
    )
    if not any(s["starts_at"] == payload.starts_at.replace(tzinfo=None) for s in open_slots):
        raise APIError("slot is not open", code="slot_unavailable", status_code=409)

    booking = await bookings_repo.create_booking(
        conn,
        coach_user_id=payload.coach_user_id,
        athlete_user_id=user["id"],
        starts_at=payload.starts_at,
        duration_minutes=settings["session_duration_minutes"],
        format=payload.format,
        price_per_session=settings["price_per_session"],
        currency=settings["currency"],
        location=settings["location"],
    )
    if booking is None:
        raise APIError("slot was just booked by someone else", code="slot_unavailable", status_code=409)
    return await _to_out(conn, booking)


@router.get("/me", response_model=list[BookingOut])
async def list_my_bookings(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[BookingOut]:
    bookings = await bookings_repo.list_for_athlete(conn, user["id"])
    return [await _to_out(conn, b) for b in bookings]
```

`coach_reviews_repo.get_by_booking` is added in Task 6 — for this task, temporarily stub it in `coach_reviews.py` so `bookings.py` imports cleanly:

```python
# add to backend/app/repositories/coach_reviews.py in this task
async def get_by_booking(conn: asyncpg.Connection, booking_id) -> dict[str, Any] | None:
    return None  # replaced with a real query in Task 6
```

- [ ] **Step 6: Register the router**

In `backend/app/main.py`: add `bookings` to the routes import block, and `app.include_router(bookings.router)` near the others.

- [ ] **Step 7: Add fakes to `conftest.py`**

```python
    import app.repositories.bookings as bookings_module

    async def fake_create_booking(conn, *, coach_user_id, athlete_user_id, starts_at, duration_minutes, format, price_per_session, currency, location):
        if any(b["coach_user_id"] == coach_user_id and b["starts_at"] == starts_at and b["status"] == "confirmed" for b in bookings_store.values()):
            return None
        # trainings_module.create_training is already faked above (Task 5's
        # own client-fixture code, present from before this feature existed)
        # — calling it here goes through that same fake_create_training,
        # keyed into the same trainings_store, exactly like the real
        # repository calls the real create_training.
        training = await trainings_module.create_training(
            conn,
            athlete_user_id,
            type="personal",
            training_date=starts_at.date(),
            start_time=starts_at.time(),
            duration_minutes=duration_minutes,
            location=location if format == "offline" else "Онлайн",
            description="Бронирование тренера через маркетплейс",
        )
        booking_id = uuid4()
        record = {
            "id": booking_id,
            "coach_user_id": coach_user_id,
            "coach_full_name": coach_store[coach_user_id]["full_name"],
            "athlete_user_id": athlete_user_id,
            "starts_at": starts_at,
            "duration_minutes": duration_minutes,
            "format": format,
            "price_per_session": price_per_session,
            "currency": currency,
            "status": "confirmed",
            "training_id": training["id"],
        }
        bookings_store[booking_id] = record
        return dict(record)

    async def fake_get_booking(conn, booking_id):
        record = bookings_store.get(booking_id)
        return dict(record) if record else None

    async def fake_list_for_athlete(conn, athlete_user_id):
        items = [dict(b) for b in bookings_store.values() if b["athlete_user_id"] == athlete_user_id]
        return sorted(items, key=lambda b: b["starts_at"], reverse=True)

    monkeypatch.setattr(bookings_module, "create_booking", fake_create_booking)
    monkeypatch.setattr(bookings_module, "get_booking", fake_get_booking)
    monkeypatch.setattr(bookings_module, "list_for_athlete", fake_list_for_athlete)
    # bookings_module.is_completed is a plain function — not faked, runs for real in tests.

    async def fake_get_by_booking(conn, booking_id):
        return next((dict(r) for r in reviews_store.values() if r["booking_id"] == booking_id), None)

    monkeypatch.setattr(coach_reviews_module, "get_by_booking", fake_get_by_booking)
```

- [ ] **Step 8: Run tests, then full suite**

Run: `cd backend && python -m pytest tests/test_bookings_api.py -v && python -m pytest -q`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add backend/app/schemas/booking.py backend/app/repositories/bookings.py backend/app/repositories/coach_reviews.py backend/app/api/routes/bookings.py backend/app/main.py backend/tests/conftest.py backend/tests/test_bookings_api.py
git commit -m "$(cat <<'EOF'
Add booking creation and listing

POST /api/bookings, GET /api/bookings/me. A confirmed booking always
creates a linked personal Training in the same transaction, so it shows
up in the athlete's existing calendar with no new UI. Double-booking,
wrong format, and self-booking are all rejected before hitting the
unique-constraint backstop.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Reviews

**Files:**
- Modify: `backend/app/schemas/booking.py` — add `ReviewIn`, `ReviewOut`
- Modify: `backend/app/repositories/coach_reviews.py` — replace the Task 5 stub `get_by_booking` with a real query, add `create_review`
- Modify: `backend/app/api/routes/bookings.py` — add `POST /{booking_id}/reviews`
- Modify: `backend/tests/conftest.py`
- Create: `backend/tests/test_reviews_api.py`

**Interfaces:**
- Consumes: `bookings_repo.get_booking`, `bookings_repo.is_completed` (Task 5).

- [ ] **Step 1: Add the schema**

Add `Field` to `booking.py`'s existing `from pydantic import BaseModel` import line (`from pydantic import BaseModel, Field`), then append:

```python
# append to backend/app/schemas/booking.py
class ReviewIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    text: str | None = Field(default=None, max_length=2000)


class ReviewOut(BaseModel):
    id: UUID
    booking_id: UUID
    rating: int
    text: str | None
```

- [ ] **Step 2: Write the failing tests**

```python
# backend/tests/test_reviews_api.py
from __future__ import annotations

from datetime import date, timedelta

from tests.test_bookings_api import _list_coach_with_slot


def _book_in_the_past(client, coach_token, athlete_token, coach_id) -> dict:
    """Books the coach's very next slot, then reaches into the booking
    record via the API to confirm it — since we can't travel through time,
    tests that need a *completed* booking instead assert against a slot in
    the near future and monkeypatch aren't available at the route-test
    level, so this helper is intentionally unused; see the note in Step 3."""
    raise NotImplementedError


def test_athlete_can_review_completed_booking(logged_in_client, login_as, monkeypatch) -> None:
    client, coach_token = logged_in_client
    coach_id, slot = _list_coach_with_slot(client, coach_token)

    athlete_token = login_as(891001, first_name="Athlete")
    athlete_headers = {"Authorization": f"Bearer {athlete_token}"}
    booking = client.post(
        "/api/bookings",
        headers=athlete_headers,
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "online"},
    ).json()

    import app.repositories.bookings as bookings_module

    monkeypatch.setattr(bookings_module, "is_completed", lambda booking: True)

    resp = client.post(
        f"/api/bookings/{booking['id']}/reviews",
        headers=athlete_headers,
        json={"rating": 5, "text": "Отличная тренировка"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["rating"] == 5

    profile = client.get(f"/api/coaches/{coach_id}", headers=athlete_headers).json()
    assert profile["average_rating"] == 5.0
    assert profile["review_count"] == 1


def test_cannot_review_before_completion(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_id, slot = _list_coach_with_slot(client, coach_token)

    athlete_token = login_as(891002, first_name="Athlete")
    athlete_headers = {"Authorization": f"Bearer {athlete_token}"}
    booking = client.post(
        "/api/bookings",
        headers=athlete_headers,
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "online"},
    ).json()

    resp = client.post(
        f"/api/bookings/{booking['id']}/reviews", headers=athlete_headers, json={"rating": 5, "text": None}
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "booking_not_completed"


def test_only_the_booking_athlete_can_review_it(logged_in_client, login_as, monkeypatch) -> None:
    client, coach_token = logged_in_client
    coach_id, slot = _list_coach_with_slot(client, coach_token)

    athlete_token = login_as(891003, first_name="Athlete")
    outsider_token = login_as(891004, first_name="Outsider")
    booking = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {athlete_token}"},
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "online"},
    ).json()

    import app.repositories.bookings as bookings_module

    monkeypatch.setattr(bookings_module, "is_completed", lambda booking: True)

    resp = client.post(
        f"/api/bookings/{booking['id']}/reviews",
        headers={"Authorization": f"Bearer {outsider_token}"},
        json={"rating": 1, "text": None},
    )
    assert resp.status_code == 403


def test_cannot_review_the_same_booking_twice(logged_in_client, login_as, monkeypatch) -> None:
    client, coach_token = logged_in_client
    coach_id, slot = _list_coach_with_slot(client, coach_token)

    athlete_token = login_as(891005, first_name="Athlete")
    athlete_headers = {"Authorization": f"Bearer {athlete_token}"}
    booking = client.post(
        "/api/bookings",
        headers=athlete_headers,
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "online"},
    ).json()

    import app.repositories.bookings as bookings_module

    monkeypatch.setattr(bookings_module, "is_completed", lambda booking: True)

    first = client.post(f"/api/bookings/{booking['id']}/reviews", headers=athlete_headers, json={"rating": 4, "text": None})
    assert first.status_code == 200

    second = client.post(f"/api/bookings/{booking['id']}/reviews", headers=athlete_headers, json={"rating": 2, "text": None})
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "already_reviewed"
```

Delete the unused `_book_in_the_past` helper before committing — it's left in this plan only to explain why `monkeypatch.setattr(bookings_module, "is_completed", ...)` is the chosen way to simulate a completed booking in a route test (there is no clock-travel primitive in this test harness, and `is_completed` is a plain, unfaked function per Task 5 — monkeypatching it directly for the duration of one test is the smallest correct way to force the "completed" branch).

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_reviews_api.py -v`
Expected: FAIL (404 — route doesn't exist yet).

- [ ] **Step 4: Implement the repository additions**

Replace the Task 5 stub in `backend/app/repositories/coach_reviews.py`:

```python
async def get_by_booking(conn: asyncpg.Connection, booking_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow("SELECT id, booking_id, rating, text FROM coach_reviews WHERE booking_id = $1", booking_id)
    return dict(row) if row else None


async def create_review(
    conn: asyncpg.Connection, *, booking_id: UUID, coach_user_id: UUID, athlete_user_id: UUID, rating: int, text: str | None
) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        INSERT INTO coach_reviews (booking_id, coach_user_id, athlete_user_id, rating, text)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, booking_id, rating, text
        """,
        booking_id,
        coach_user_id,
        athlete_user_id,
        rating,
        text,
    )
    return dict(row)
```

- [ ] **Step 5: Add the route**

Append to `backend/app/api/routes/bookings.py` (add `ReviewIn, ReviewOut` to the schema import):

```python
@router.post("/{booking_id}/reviews", response_model=ReviewOut)
async def review_booking(
    booking_id: UUID,
    payload: ReviewIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> ReviewOut:
    booking = await bookings_repo.get_booking(conn, booking_id)
    if booking is None:
        raise NotFoundError("booking not found")
    if booking["athlete_user_id"] != user["id"]:
        raise ForbiddenError("you can only review your own bookings")
    if not bookings_repo.is_completed(booking):
        raise APIError("booking is not completed yet", code="booking_not_completed", status_code=409)
    if await coach_reviews_repo.get_by_booking(conn, booking_id) is not None:
        raise APIError("this booking already has a review", code="already_reviewed", status_code=409)

    review = await coach_reviews_repo.create_review(
        conn,
        booking_id=booking_id,
        coach_user_id=booking["coach_user_id"],
        athlete_user_id=user["id"],
        rating=payload.rating,
        text=payload.text,
    )
    return ReviewOut(**review)
```

- [ ] **Step 6: Add fakes to `conftest.py`**

```python
    async def fake_create_review(conn, *, booking_id, coach_user_id, athlete_user_id, rating, text):
        review_id = uuid4()
        record = {
            "id": review_id,
            "booking_id": booking_id,
            "coach_user_id": coach_user_id,
            "athlete_user_id": athlete_user_id,
            "rating": rating,
            "text": text,
            "created_at": datetime.now(timezone.utc),
        }
        reviews_store[review_id] = record
        return {"id": review_id, "booking_id": booking_id, "rating": rating, "text": text}

    monkeypatch.setattr(coach_reviews_module, "create_review", fake_create_review)
```

(`fake_get_by_booking` was already added in Task 5 Step 8 — no change needed there.)

- [ ] **Step 7: Run tests, then full suite**

Run: `cd backend && python -m pytest tests/test_reviews_api.py -v && python -m pytest -q`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add backend/app/schemas/booking.py backend/app/repositories/coach_reviews.py backend/app/api/routes/bookings.py backend/tests/conftest.py backend/tests/test_reviews_api.py
git commit -m "$(cat <<'EOF'
Add coach reviews

POST /api/bookings/{id}/reviews — one review per booking, only by that
booking's athlete, only once it's completed (derived from start time +
duration, no manual confirmation step).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: End-to-end smoke test against the real database

Every prior task's tests run against in-memory fakes (Global Constraints) — nothing so far has exercised the actual SQL in `coach_marketplace.py`, `bookings.py`, or `coach_reviews.py` against real Postgres. This task is the one point that does.

**Files:** none (verification only).

- [ ] **Step 1: Restart the dev stack and confirm it's healthy**

```bash
cd /Users/alex/Documents/GitHub/SportHelper
docker compose -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.dev.yml ps
curl -s http://localhost:8002/api/health
```

Expected: all containers `healthy`/`Up`; health check returns `{"status":"ok","database":true}`.

- [ ] **Step 2: Log in as a dev user and exercise the full flow with curl**

`DEV_AUTH_ENABLED=true` locally (see `docs/dev-notes.md`) — use `/api/auth/dev-login` to get a token without a real Telegram client:

```bash
TOKEN=$(curl -s -X POST http://localhost:8002/api/auth/dev-login | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
echo "token: $TOKEN"

curl -s -X PUT http://localhost:8002/api/profile/coach \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"full_name":"Smoke Coach","sport":"Футбол","experience_years":5,"specialization":null,"description":null}'

curl -s -X PUT http://localhost:8002/api/coaches/me/marketplace-settings \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"is_listed":true,"price_per_session":1500,"currency":"RUB","offers_online":true,"offers_offline":false,"location":"Москва","session_duration_minutes":60}'

curl -s -X PUT http://localhost:8002/api/coaches/me/availability \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '[{"weekday":0,"start_time":"10:00:00","end_time":"12:00:00"}]'

curl -s http://localhost:8002/api/coaches -H "Authorization: Bearer $TOKEN"
```

Expected: each command returns `200` with the data just written, and the final `list` call includes the just-created coach with `average_rating: null`, `review_count: 0`. If any step 500s, read `docker compose -f docker-compose.dev.yml logs backend --tail 50` — this is real SQL against real Postgres, so a typo in a column name or a missing import will surface here for the first time.

- [ ] **Step 3: Book a slot as a second user and confirm the calendar link**

```bash
docker compose -f docker-compose.dev.yml exec postgres psql -U teamflow -d teamflow_sandbox -c \
  "SELECT id, starts_at, training_id FROM bookings;"
```

Run this after using a second dev-logged-in token (dev-login always returns the same fixed dev user per `docs/dev-notes.md` — for a genuinely distinct second user in this manual check, temporarily flip `active_mode`/use a second browser profile is unnecessary; simplest is to confirm via the pytest suite's coverage of the two-distinct-users case from Task 5 and use this manual pass only to confirm the *coach-side* write path against real SQL, which is the part pytest can't reach).

Expected: the `bookings` row exists with a non-null `training_id`, and:

```bash
docker compose -f docker-compose.dev.yml exec postgres psql -U teamflow -d teamflow_sandbox -c \
  "SELECT id, type, training_date, start_time FROM trainings WHERE id = (SELECT training_id FROM bookings LIMIT 1);"
```

returns a row with `type = 'personal'`.

- [ ] **Step 4: Clean up the smoke-test data**

```bash
docker compose -f docker-compose.dev.yml exec postgres psql -U teamflow -d teamflow_sandbox -c \
  "DELETE FROM bookings; DELETE FROM trainings WHERE description = 'Бронирование тренера через маркетплейс'; UPDATE coach_profiles SET is_listed = false;"
```

No commit for this task — it's verification only, nothing to add to git.

---

## Deferred (not in this plan)

- Booking cancellation — spec's open question, needs its own follow-up plan.
- `booking_confirmed` notification — needs widening the `notifications.category` CHECK constraint; spec marks it non-blocking.
- Coach photo gallery beyond the existing Telegram avatar.
- Frontend — see the companion plan, `docs/superpowers/plans/2026-09-05-coach-marketplace-frontend.md`.
