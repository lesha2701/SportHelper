# Booking confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a coach-side accept/decline step to the coach-marketplace booking flow: a booking starts as a `pending` request instead of confirming instantly, the coach reviews it in a new "Входящие" screen, and the athlete is notified of the outcome (confirmed/declined/auto-expired after 24h).

**Architecture:** Extend the existing `bookings` table with new statuses and a nullable `training_id` (the linked personal `Training` now gets created on confirmation, not on request). Add three new routes (coach-pending-list, confirm, decline) following the exact ownership/race-guard pattern `POST /api/bookings/{id}/reviews` already uses. Reuse the existing notification queue/background-sender for the two new notification categories, and the existing `run_tick` background loop for the 24h auto-expiry sweep.

**Tech Stack:** FastAPI + asyncpg (raw parameterized SQL) backend, React + TypeScript + CSS Modules frontend, pytest against in-memory fake repositories (see `backend/tests/conftest.py`), Docker Compose dev stack (`docker-compose.dev.yml`: postgres on `127.0.0.1:5433`, backend on `127.0.0.1:8002`, frontend on `0.0.0.0:5175`).

**Spec:** [`docs/superpowers/specs/2026-09-10-booking-confirmation-design.md`](../specs/2026-09-10-booking-confirmation-design.md)

## Global Constraints

- Backend tests run **only** via `docker compose -f docker-compose.dev.yml exec backend python -m pytest ...` — never a local venv (local Python is incompatible with this project's pinned `pydantic-core`).
- All SQL is raw, parameterized asyncpg — no ORM, no string-interpolated values (only column/table names are ever f-string-interpolated, and only from fixed constants, never user input).
- `bookings.status` values: `pending`, `confirmed`, `declined`, `expired`, `cancelled` (the last is unused until a future cancellation feature — do not touch it).
- Auto-decline timeout is hardcoded at 24 hours (no settings field, no env var — the spec explicitly parks a configurable timeout as future work).
- No decline reason/comment field anywhere in this plan.
- Frontend has no automated test framework — verify UI tasks with `npx tsc --noEmit` (inside the frontend container) plus a live check in the Browser pane, not with new test files.
- Follow existing file conventions exactly: repositories return plain `dict`s from `asyncpg.Record`, routes raise `APIError`/`ForbiddenError`/`NotFoundError` from `app.core.exceptions`, frontend API modules map snake_case DTOs to camelCase app types via a `mapXDto` function (see `frontend/src/types/booking.ts`).

---

### Task 1: Database migration — booking statuses, nullable training_id, notification categories

**Files:**
- Create: `database/patches/0020_booking_confirmation.sql`

**Interfaces:**
- Produces: the `bookings` table accepts `status IN ('pending', 'confirmed', 'declined', 'expired', 'cancelled')`, `training_id` is nullable, a new `responded_at TIMESTAMPTZ` column exists, and the double-booking guard is a **partial** unique index (`bookings_no_double_book`) scoped to `status IN ('pending', 'confirmed')` instead of a plain table constraint. `notifications`/`notification_preferences` accept two new categories: `booking_requested`, `booking_decided`.

- [ ] **Step 1: Write the migration file**

```sql
-- database/patches/0020_booking_confirmation.sql
-- Adds a coach-confirmation step to bookings: a request now starts
-- 'pending' and only becomes 'confirmed' (and gets its linked Training)
-- once the coach acts. See docs/superpowers/specs/2026-09-10-booking-confirmation-design.md.

ALTER TABLE bookings DROP CONSTRAINT bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
    CHECK (status IN ('pending', 'confirmed', 'declined', 'expired', 'cancelled'));

ALTER TABLE bookings ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE bookings ALTER COLUMN training_id DROP NOT NULL;
ALTER TABLE bookings ADD COLUMN responded_at TIMESTAMPTZ;

-- The plain UNIQUE(coach_user_id, starts_at) constraint from 0019 blocks ANY
-- second row at that key regardless of status — harmless while every
-- booking stayed 'confirmed' forever, but a real bug now: a declined or
-- expired request would permanently lock its slot, since its row never
-- goes away. Replace it with a partial unique index that only guards the
-- statuses that actually occupy the slot.
ALTER TABLE bookings DROP CONSTRAINT bookings_no_double_book;
CREATE UNIQUE INDEX bookings_no_double_book
    ON bookings (coach_user_id, starts_at)
    WHERE status IN ('pending', 'confirmed');

ALTER TABLE notifications DROP CONSTRAINT notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check
    CHECK (category IN ('training_reminder', 'task_deadline', 'new_training', 'new_match', 'new_task', 'booking_requested', 'booking_decided'));

ALTER TABLE notification_preferences DROP CONSTRAINT notification_preferences_category_check;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_category_check
    CHECK (category IN ('training_reminder', 'task_deadline', 'new_training', 'new_match', 'new_task', 'booking_requested', 'booking_decided'));
```

- [ ] **Step 2: Apply it against the running dev stack and verify**

Run (from the repo root, dev stack already up per `docker-compose.dev.yml`):

```bash
docker compose -f docker-compose.dev.yml restart backend
docker compose -f docker-compose.dev.yml logs backend --tail=30
```

Expected: no migration errors in the log, and the app starts normally
(`Application startup complete.`). Then confirm the schema directly:

```bash
docker compose -f docker-compose.dev.yml exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\d bookings"
```

Expected: `status` has the widened CHECK, `training_id` has no `not null`,
`responded_at` exists, and `bookings_no_double_book` appears as a partial
unique index (`WHERE (status = ANY (...))`) rather than a plain constraint.

- [ ] **Step 3: Commit**

```bash
git add database/patches/0020_booking_confirmation.sql
git commit -m "feat: add booking-confirmation schema (pending status, nullable training_id, notification categories)"
```

---

### Task 2: Second dev-login endpoint for local two-user testing

**Files:**
- Modify: `backend/app/api/routes/dev_auth.py`

**Interfaces:**
- Produces: `POST /api/auth/dev-login-2`, registered on the same router as the existing `POST /api/auth/dev-login` (so it's included under the same `DEV_AUTH_ENABLED` gate in `app/main.py` — no change needed there).

- [ ] **Step 1: Add the second fixed dev user and route**

Edit `backend/app/api/routes/dev_auth.py`, adding after `_DEV_USER`:

```python
_DEV_USER_2 = TelegramUser(
    id=900000002,
    first_name="Dev2",
    last_name=None,
    username="dev_user_2",
    language_code="ru",
    photo_url=None,
)
```

And after the existing `dev_login` route function:

```python
@router.post("/dev-login-2", response_model=AuthResponse)
async def dev_login_2(
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> AuthResponse:
    """Second fixed dev identity, so the coach<->athlete booking-confirmation
    loop can be exercised locally with two distinct browser sessions — see
    docs/superpowers/specs/2026-09-10-booking-confirmation-design.md."""
    user = await users_repo.upsert_from_telegram(conn, _DEV_USER_2)
    token = create_access_token(user["id"], settings)
    return AuthResponse(access_token=token, user=UserOut(**user))
```

- [ ] **Step 2: Verify manually against the running dev stack**

```bash
docker compose -f docker-compose.dev.yml restart backend
curl -s -X POST http://localhost:8002/api/auth/dev-login | python3 -c "import sys,json; print(json.load(sys.stdin)['user']['id'])"
curl -s -X POST http://localhost:8002/api/auth/dev-login-2 | python3 -c "import sys,json; print(json.load(sys.stdin)['user']['id'])"
```

Expected: two different UUIDs printed. (No pytest coverage for this route —
the existing `dev-login` has none either, since `DEV_AUTH_ENABLED` is off
in the test environment and the router is never registered there; this is
a manual-testing convenience, not app logic.)

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/routes/dev_auth.py
git commit -m "feat: add second dev-login endpoint for local two-user testing"
```

---

### Task 3: Booking creation becomes a pending request (no auto-confirm, no auto-Training)

**Files:**
- Modify: `backend/app/repositories/bookings.py`
- Modify: `backend/app/repositories/coach_marketplace.py:203-237` (`compute_open_slots`)
- Modify: `backend/app/schemas/booking.py` (`BookingOut.training_id`)
- Modify: `backend/tests/conftest.py` (`fake_create_booking`, `fake_compute_open_slots`)
- Modify: `backend/tests/test_bookings_api.py` (existing happy-path test)

**Interfaces:**
- Produces: `bookings_repo.create_booking(...)` now returns a record with `status="pending"`, `training_id=None`, `created_at` set — no `Training` row is created. `coach_marketplace_repo.compute_open_slots` now excludes a slot when a booking exists with `status IN ('pending', 'confirmed')` (was: `= 'confirmed'`).
- Consumes: nothing new — this task only changes existing functions' internals and one schema field's type.

- [ ] **Step 1: Update the real `create_booking` repository function**

In `backend/app/repositories/bookings.py`, replace the whole function body
(it currently creates a `Training` unconditionally via `trainings_repo.create_training`
— see the file read during planning) with:

```python
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
    """Creates a pending booking request — no Training is created here
    anymore; that only happens once the coach confirms (see
    confirm_booking). Returns None if the slot was already taken (unique-
    constraint race, now scoped to pending+confirmed bookings only)."""
    try:
        row = await conn.fetchrow(
            f"""
            INSERT INTO bookings (
                coach_user_id, athlete_user_id, starts_at, duration_minutes, format,
                price_per_session, currency, status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
            RETURNING {_BOOKING_INSERT_FIELDS}, created_at
            """,
            coach_user_id,
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
    result["coach_full_name"] = (
        await conn.fetchrow("SELECT full_name FROM coach_profiles WHERE user_id = $1", coach_user_id)
    )["full_name"]
    return result
```

Note `location` is now unused by this function (it's only needed when the
`Training` is created, which now happens in `confirm_booking` — Task 4).
Keep the parameter in the signature since the route still passes it (Task 4
uses it there); an unused parameter here is not a lint error in this repo
(`ruff`/mypy config doesn't flag unused function args), and removing it now
would just mean re-adding it in Task 4 for no benefit.

- [ ] **Step 2: Update `BookingOut.training_id` to be nullable**

In `backend/app/schemas/booking.py`, change:

```python
    training_id: UUID
```

to:

```python
    training_id: UUID | None
```

- [ ] **Step 3: Update `compute_open_slots` to treat pending as occupying the slot**

In `backend/app/repositories/coach_marketplace.py`, in `compute_open_slots`,
change the query:

```python
    booked_rows = await conn.fetch(
        "SELECT starts_at FROM bookings WHERE coach_user_id = $1 AND status = 'confirmed' "
        "AND starts_at >= $2 AND starts_at < $3",
```

to:

```python
    booked_rows = await conn.fetch(
        "SELECT starts_at FROM bookings WHERE coach_user_id = $1 AND status IN ('pending', 'confirmed') "
        "AND starts_at >= $2 AND starts_at < $3",
```

- [ ] **Step 4: Update the in-memory fakes in `conftest.py`**

Replace `fake_create_booking` (currently calls `trainings_module.create_training`
and hardcodes `"status": "confirmed"`) with:

```python
    async def fake_create_booking(conn, *, coach_user_id, athlete_user_id, starts_at, duration_minutes, format, price_per_session, currency, location):
        if any(
            b["coach_user_id"] == coach_user_id and b["starts_at"] == starts_at and b["status"] in ("pending", "confirmed")
            for b in bookings_store.values()
        ):
            return None
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
            "status": "pending",
            "training_id": None,
            "created_at": datetime.now(timezone.utc),
            "responded_at": None,
        }
        bookings_store[booking_id] = record
        return dict(record)
```

And update the booked-set comparison inside `fake_compute_open_slots` from:

```python
        booked = {b["starts_at"] for b in bookings_store.values() if b["coach_user_id"] == coach_user_id and b["status"] == "confirmed"}
```

to:

```python
        booked = {b["starts_at"] for b in bookings_store.values() if b["coach_user_id"] == coach_user_id and b["status"] in ("pending", "confirmed")}
```

- [ ] **Step 5: Update the existing test that assumed instant confirmation**

In `backend/tests/test_bookings_api.py`, replace
`test_athlete_can_book_open_slot_and_it_appears_in_calendar` with:

```python
def test_athlete_booking_creates_pending_request_with_no_training_yet(logged_in_client, login_as) -> None:
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
    assert booking["status"] == "pending"
    assert booking["training_id"] is None
    assert booking["is_completed"] is False

    mine = client.get("/api/bookings/me", headers=athlete_headers).json()
    assert len(mine) == 1
    assert mine[0]["id"] == booking["id"]
    assert mine[0]["status"] == "pending"
```

- [ ] **Step 6: Run the booking test suite**

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest tests/test_bookings_api.py -v
```

Expected: all tests pass (the other 5 tests in this file don't assert a
specific `status` value on success, only on the 400/409 rejection paths, so
they're unaffected by the pending-by-default change).

- [ ] **Step 7: Commit**

```bash
git add backend/app/repositories/bookings.py backend/app/repositories/coach_marketplace.py backend/app/schemas/booking.py backend/tests/conftest.py backend/tests/test_bookings_api.py
git commit -m "feat: booking creation starts a pending request instead of auto-confirming"
```

---

### Task 4: Coach confirm/decline endpoints and the pending-requests list

**Files:**
- Modify: `backend/app/repositories/bookings.py` (add `confirm_booking`, `decline_booking`, `list_pending_for_coach`)
- Modify: `backend/app/schemas/booking.py` (add `PendingBookingOut`)
- Modify: `backend/app/api/routes/bookings.py` (add 3 routes)
- Modify: `backend/tests/conftest.py` (add matching fakes)
- Create: `backend/tests/test_booking_confirmation_api.py`

**Interfaces:**
- Consumes: `bookings_repo.create_booking` (Task 3, unchanged signature), `trainings_repo.create_training(conn, created_by, **fields)` (existing).
- Produces: `bookings_repo.confirm_booking(conn, *, booking_id, coach_user_id) -> dict | None`, `bookings_repo.decline_booking(conn, *, booking_id, coach_user_id) -> dict | None` (both return `None` if the booking isn't this coach's pending one), `bookings_repo.list_pending_for_coach(conn, coach_user_id) -> list[dict]` (each dict has `id, athlete_user_id, athlete_full_name, starts_at, duration_minutes, format, price_per_session, currency, created_at`). Routes: `GET /api/bookings/coach/pending`, `POST /api/bookings/{id}/confirm`, `POST /api/bookings/{id}/decline` — later tasks (5) call these repo functions and hit these routes.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_booking_confirmation_api.py`:

```python
from __future__ import annotations

from tests.test_bookings_api import _list_coach_with_slot


def _create_pending_booking(client, coach_token, login_as, telegram_id=890101):
    coach_id, slot = _list_coach_with_slot(client, coach_token)
    athlete_token = login_as(telegram_id, first_name="Athlete")
    resp = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {athlete_token}"},
        json={"coach_user_id": coach_id, "starts_at": slot, "format": "online"},
    )
    assert resp.status_code == 200, resp.text
    return coach_id, athlete_token, resp.json()


def test_coach_sees_pending_request_in_inbox(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as)

    pending = client.get("/api/bookings/coach/pending", headers={"Authorization": f"Bearer {coach_token}"}).json()
    assert len(pending) == 1
    assert pending[0]["id"] == booking["id"]
    assert pending[0]["athlete_full_name"] == "Athlete"


def test_coach_confirms_booking_creates_training_and_notifies_athlete(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as)

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
    coach_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as)

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
        json={"coach_user_id": coach_id, "starts_at": booking["starts_at"], "format": "online"},
    )
    assert retry.status_code == 200, retry.text
    assert retry.json()["status"] == "pending"


def test_confirm_rejects_wrong_coach(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as)

    other_coach_token = login_as(890103, first_name="OtherCoach")
    resp = client.post(
        f"/api/bookings/{booking['id']}/confirm",
        headers={"Authorization": f"Bearer {other_coach_token}"},
    )
    assert resp.status_code == 403


def test_confirm_twice_is_rejected(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as)

    headers = {"Authorization": f"Bearer {coach_token}"}
    first = client.post(f"/api/bookings/{booking['id']}/confirm", headers=headers)
    assert first.status_code == 200

    second = client.post(f"/api/bookings/{booking['id']}/confirm", headers=headers)
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "booking_not_pending"
```

- [ ] **Step 2: Run it to verify it fails**

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest tests/test_booking_confirmation_api.py -v
```

Expected: FAIL — `404 Not Found` for `/api/bookings/coach/pending` and
`/{id}/confirm` (routes don't exist yet).

- [ ] **Step 3: Add the repository functions**

In `backend/app/repositories/bookings.py`, add:

```python
async def confirm_booking(conn: asyncpg.Connection, *, booking_id: UUID, coach_user_id: UUID) -> dict[str, Any] | None:
    """Confirms a pending booking: creates the linked Training and flips the
    booking to 'confirmed', in one transaction. Returns None if the booking
    isn't this coach's currently-pending one (already handled, or a race
    with the expiry sweep) — the route layer turns that into a 409."""
    async with conn.transaction():
        booking = await conn.fetchrow(
            "SELECT * FROM bookings WHERE id = $1 AND coach_user_id = $2 AND status = 'pending' FOR UPDATE",
            booking_id,
            coach_user_id,
        )
        if booking is None:
            return None
        coach_profile = await conn.fetchrow("SELECT location FROM coach_profiles WHERE user_id = $1", coach_user_id)
        training = await trainings_repo.create_training(
            conn,
            booking["athlete_user_id"],
            type="personal",
            training_date=booking["starts_at"].date(),
            start_time=booking["starts_at"].time(),
            duration_minutes=booking["duration_minutes"],
            location=coach_profile["location"] if booking["format"] == "offline" else "Онлайн",
            description="Бронирование тренера через маркетплейс",
        )
        await conn.execute(
            "UPDATE bookings SET status = 'confirmed', training_id = $1, responded_at = now() WHERE id = $2",
            training["id"],
            booking_id,
        )
    return await get_booking(conn, booking_id)


async def decline_booking(conn: asyncpg.Connection, *, booking_id: UUID, coach_user_id: UUID) -> dict[str, Any] | None:
    """Returns None if the booking isn't this coach's currently-pending one."""
    result = await conn.execute(
        "UPDATE bookings SET status = 'declined', responded_at = now() "
        "WHERE id = $1 AND coach_user_id = $2 AND status = 'pending'",
        booking_id,
        coach_user_id,
    )
    if not result.endswith("1"):
        return None
    return await get_booking(conn, booking_id)


async def list_pending_for_coach(conn: asyncpg.Connection, coach_user_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT b.id, b.athlete_user_id, b.starts_at, b.duration_minutes, b.format,
               b.price_per_session, b.currency, b.created_at,
               u.first_name || COALESCE(' ' || u.last_name, '') AS athlete_full_name
        FROM bookings b
        JOIN users u ON u.id = b.athlete_user_id
        WHERE b.coach_user_id = $1 AND b.status = 'pending'
        ORDER BY b.created_at ASC
        """,
        coach_user_id,
    )
    return [dict(row) for row in rows]
```

Add the missing import at the top of the file (it already imports
`trainings_repo` as `from app.repositories import trainings as trainings_repo`
— check this is present; it was already there from `create_booking`'s
original version).

- [ ] **Step 4: Add the `PendingBookingOut` schema**

In `backend/app/schemas/booking.py`, add:

```python
class PendingBookingOut(BaseModel):
    id: UUID
    athlete_user_id: UUID
    athlete_full_name: str
    starts_at: datetime
    duration_minutes: int
    format: str
    price_per_session: float | None
    currency: str
    created_at: datetime
```

- [ ] **Step 5: Add the routes**

In `backend/app/api/routes/bookings.py`, add the import
`from app.schemas.booking import BookingIn, BookingOut, PendingBookingOut, ReviewIn, ReviewOut`
(extends the existing import line), and add these three routes (place them
before `review_booking` so `/coach/pending` isn't shadowed by
`/{booking_id}/...` — not that it would collide given the different path
shapes, but it keeps coach-facing routes grouped together):

```python
@router.get("/coach/pending", response_model=list[PendingBookingOut])
async def list_pending_bookings(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[PendingBookingOut]:
    rows = await bookings_repo.list_pending_for_coach(conn, user["id"])
    return [PendingBookingOut(**row) for row in rows]


@router.post("/{booking_id}/confirm", response_model=BookingOut)
async def confirm_booking(
    booking_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> BookingOut:
    booking = await bookings_repo.get_booking(conn, booking_id)
    if booking is None:
        raise NotFoundError("booking not found")
    if booking["coach_user_id"] != user["id"]:
        raise ForbiddenError("you can only confirm your own bookings")
    confirmed = await bookings_repo.confirm_booking(conn, booking_id=booking_id, coach_user_id=user["id"])
    if confirmed is None:
        raise APIError("booking is no longer pending", code="booking_not_pending", status_code=409)
    return await _to_out(conn, confirmed)


@router.post("/{booking_id}/decline", response_model=BookingOut)
async def decline_booking(
    booking_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> BookingOut:
    booking = await bookings_repo.get_booking(conn, booking_id)
    if booking is None:
        raise NotFoundError("booking not found")
    if booking["coach_user_id"] != user["id"]:
        raise ForbiddenError("you can only decline your own bookings")
    declined = await bookings_repo.decline_booking(conn, booking_id=booking_id, coach_user_id=user["id"])
    if declined is None:
        raise APIError("booking is no longer pending", code="booking_not_pending", status_code=409)
    return await _to_out(conn, declined)
```

Note: this step deliberately does **not** wire in notifications yet — that's
Task 6, kept separate so this task's tests only exercise the confirm/decline
state machine itself.

- [ ] **Step 6: Add the fakes in `conftest.py`**

Add near the existing `fake_get_booking`/`fake_list_for_athlete` fakes:

```python
    async def fake_confirm_booking(conn, *, booking_id, coach_user_id):
        record = bookings_store.get(booking_id)
        if record is None or record["coach_user_id"] != coach_user_id or record["status"] != "pending":
            return None
        coach_profile = coach_store.get(coach_user_id, {})
        training = await trainings_module.create_training(
            conn,
            record["athlete_user_id"],
            type="personal",
            training_date=record["starts_at"].date(),
            start_time=record["starts_at"].time(),
            duration_minutes=record["duration_minutes"],
            location=coach_profile.get("location") if record["format"] == "offline" else "Онлайн",
            description="Бронирование тренера через маркетплейс",
        )
        record["status"] = "confirmed"
        record["training_id"] = training["id"]
        record["responded_at"] = datetime.now(timezone.utc)
        return dict(record)

    async def fake_decline_booking(conn, *, booking_id, coach_user_id):
        record = bookings_store.get(booking_id)
        if record is None or record["coach_user_id"] != coach_user_id or record["status"] != "pending":
            return None
        record["status"] = "declined"
        record["responded_at"] = datetime.now(timezone.utc)
        return dict(record)

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

    monkeypatch.setattr(bookings_module, "confirm_booking", fake_confirm_booking)
    monkeypatch.setattr(bookings_module, "decline_booking", fake_decline_booking)
    monkeypatch.setattr(bookings_module, "list_pending_for_coach", fake_list_pending_for_coach)
```

(Place this block right after the existing
`monkeypatch.setattr(bookings_module, "list_for_athlete", fake_list_for_athlete)`
line.)

- [ ] **Step 7: Run the tests**

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest tests/test_booking_confirmation_api.py tests/test_bookings_api.py -v
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/repositories/bookings.py backend/app/schemas/booking.py backend/app/api/routes/bookings.py backend/tests/conftest.py backend/tests/test_booking_confirmation_api.py
git commit -m "feat: add coach confirm/decline endpoints and pending-bookings inbox"
```

---

### Task 5: 24-hour auto-expiry sweep

**Files:**
- Modify: `backend/app/repositories/bookings.py` (add `sweep_expired`)
- Modify: `backend/app/services/background.py` (add `sweep_expired_bookings`, wire into `run_tick`)
- Modify: `backend/tests/conftest.py` (add `fake_sweep_expired`)
- Modify: `backend/tests/test_booking_confirmation_api.py` (add sweep test)

**Interfaces:**
- Consumes: `bookings_repo.list_pending_for_coach`/`confirm_booking`/`decline_booking` (Task 4, for test setup only).
- Produces: `bookings_repo.sweep_expired(conn, *, older_than: datetime) -> list[dict]` (each dict has `id`, `athlete_user_id`), `background.sweep_expired_bookings(conn) -> None` — Task 6 calls the latter's per-booking result to fire a notification.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_booking_confirmation_api.py`:

```python
from datetime import datetime, timedelta, timezone

from app.services import background


async def test_sweep_expires_pending_booking_after_24_hours(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as)

    # Backdate the booking's created_at past the 24h cutoff by monkeypatching
    # is not available here (no direct store access from the test module),
    # so instead call the sweep with an `older_than` cutoff in the future —
    # equivalent to "24 hours have passed" from the sweep's point of view.
    from app.repositories import bookings as bookings_repo

    future_cutoff = datetime.now(timezone.utc) + timedelta(hours=1)
    expired = await bookings_repo.sweep_expired(None, older_than=future_cutoff)
    assert any(e["id"] == booking["id"] for e in expired)

    pending = client.get("/api/bookings/coach/pending", headers={"Authorization": f"Bearer {coach_token}"}).json()
    assert pending == []

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
    coach_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as, telegram_id=890201)

    monkeypatch.setattr(background, "BOOKING_EXPIRY_HOURS", 0)
    await background.sweep_expired_bookings(None)

    mine = client.get("/api/bookings/me", headers={"Authorization": f"Bearer {athlete_token}"}).json()
    assert mine[0]["status"] == "expired"
```

- [ ] **Step 2: Run it to verify it fails**

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest tests/test_booking_confirmation_api.py -k expire -v
```

Expected: FAIL — `sweep_expired` doesn't exist yet
(`AttributeError: module 'app.repositories.bookings' has no attribute 'sweep_expired'`).

- [ ] **Step 3: Add the repository function**

In `backend/app/repositories/bookings.py`, add:

```python
async def sweep_expired(conn: asyncpg.Connection, *, older_than: datetime) -> list[dict[str, Any]]:
    """Auto-declines every 'pending' booking created before `older_than`.
    Called by the background tick with a rolling 24h cutoff — see
    app.services.background.sweep_expired_bookings."""
    rows = await conn.fetch(
        "UPDATE bookings SET status = 'expired', responded_at = now() "
        "WHERE status = 'pending' AND created_at < $1 "
        "RETURNING id, athlete_user_id",
        older_than,
    )
    return [dict(row) for row in rows]
```

- [ ] **Step 4: Add the background sweep function**

In `backend/app/services/background.py`, add near the top (after the
existing imports):

```python
from app.repositories import bookings as bookings_repo

BOOKING_EXPIRY_HOURS = 24
```

And add a new function, following `sweep_overdue_tasks`'s shape:

```python
async def sweep_expired_bookings(conn: asyncpg.Connection) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=BOOKING_EXPIRY_HOURS)
    expired = await bookings_repo.sweep_expired(conn, older_than=cutoff)
    if expired:
        logger.info("Auto-declined %d expired booking request(s)", len(expired))
```

(Notification firing for each expired booking is added in Task 6 — this
step only makes the statuses flip.)

And wire it into `run_tick`:

```python
async def run_tick(pool: asyncpg.Pool, bot: Bot, settings: Settings) -> None:
    async with pool.acquire() as conn:
        await sweep_overdue_tasks(conn)
        await sweep_expired_bookings(conn)
        await send_due_notifications(conn, bot, settings)
        await purge_soft_deleted_files(conn, settings)
```

- [ ] **Step 5: Add the fake in `conftest.py`**

```python
    async def fake_sweep_expired(conn, *, older_than):
        expired = []
        for record in bookings_store.values():
            if record["status"] == "pending" and record["created_at"] < older_than:
                record["status"] = "expired"
                record["responded_at"] = datetime.now(timezone.utc)
                expired.append({"id": record["id"], "athlete_user_id": record["athlete_user_id"]})
        return expired

    monkeypatch.setattr(bookings_module, "sweep_expired", fake_sweep_expired)
```

(Place right after the `list_pending_for_coach` fake registration from Task 4.)

- [ ] **Step 6: Run the tests**

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest tests/test_booking_confirmation_api.py -v
```

Expected: all PASS, including the two new sweep tests.

- [ ] **Step 7: Commit**

```bash
git add backend/app/repositories/bookings.py backend/app/services/background.py backend/tests/conftest.py backend/tests/test_booking_confirmation_api.py
git commit -m "feat: auto-decline pending bookings after 24 hours via the background sweep"
```

---

### Task 6: Notifications for the booking lifecycle

**Files:**
- Modify: `backend/app/schemas/notification.py` (add 2 categories)
- Modify: `backend/app/services/notifications.py` (add 2 `schedule_*` functions)
- Modify: `backend/app/api/routes/bookings.py` (call them from create/confirm/decline)
- Modify: `backend/app/services/background.py` (call the decided-notification from the sweep)
- Modify: `backend/tests/conftest.py` (expose `notifications_store` on the test client)
- Modify: `backend/tests/test_booking_confirmation_api.py` (add notification assertions)

**Interfaces:**
- Consumes: `_notify_recipients` (existing private helper in `app/services/notifications.py`), `users_repo.get_by_id(conn, user_id)` (existing).
- Produces: `notifications_service.schedule_booking_requested_notification(conn, booking)`, `notifications_service.schedule_booking_decided_notification(conn, booking, outcome: Literal["confirmed", "declined", "expired"])` — both take the dict shapes already returned by `bookings_repo.create_booking`/`confirm_booking`/`decline_booking`/`sweep_expired` (all of which include at least `id` and `athlete_user_id`; `create_booking`'s result additionally has `coach_user_id`/`starts_at` and `confirm_booking`'s has `starts_at`).

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_booking_confirmation_api.py`:

```python
def test_booking_request_notifies_coach(logged_in_client, login_as) -> None:
    client, coach_token = logged_in_client
    coach_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as, telegram_id=890301)

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

    coach_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as, telegram_id=890302)
    athlete_id = client.get("/api/auth/me", headers={"Authorization": f"Bearer {athlete_token}"}).json()["id"]

    confirm_resp = client.post(f"/api/bookings/{booking['id']}/confirm", headers=coach_headers)
    assert confirm_resp.status_code == 200

    decided = [n for n in client.notifications_store.values() if n["category"] == "booking_decided"]
    assert len(decided) == 1
    assert str(decided[0]["user_id"]) == athlete_id
    assert "подтвердил" in decided[0]["body"]

    coach_id2, athlete_token2, booking2 = _create_pending_booking(client, coach_token, login_as, telegram_id=890303)
    decline_resp = client.post(f"/api/bookings/{booking2['id']}/decline", headers=coach_headers)
    assert decline_resp.status_code == 200

    decided_bodies = {n["body"] for n in client.notifications_store.values() if n["category"] == "booking_decided"}
    assert any("отклонена" in body for body in decided_bodies)
```

- [ ] **Step 2: Run it to verify it fails**

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest tests/test_booking_confirmation_api.py -k "notifies" -v
```

Expected: FAIL — `AttributeError: 'TestClient' object has no attribute 'notifications_store'`.

- [ ] **Step 3: Widen the notification categories**

In `backend/app/schemas/notification.py`, change:

```python
NotificationCategory = Literal["training_reminder", "task_deadline", "new_training", "new_match", "new_task"]

NOTIFICATION_CATEGORIES: tuple[NotificationCategory, ...] = (
    "training_reminder",
    "task_deadline",
    "new_training",
    "new_match",
    "new_task",
)
```

to:

```python
NotificationCategory = Literal[
    "training_reminder", "task_deadline", "new_training", "new_match", "new_task",
    "booking_requested", "booking_decided",
]

NOTIFICATION_CATEGORIES: tuple[NotificationCategory, ...] = (
    "training_reminder",
    "task_deadline",
    "new_training",
    "new_match",
    "new_task",
    "booking_requested",
    "booking_decided",
)
```

- [ ] **Step 4: Add the two `schedule_*` functions**

In `backend/app/services/notifications.py`, add the import
`from app.repositories import users as users_repo` (next to the existing
`from app.repositories import teams as teams_repo`), and add at the end of
the file:

```python
async def schedule_booking_requested_notification(conn: asyncpg.Connection, booking: dict[str, Any]) -> None:
    """Pings the coach that a new booking request is waiting on them."""
    athlete = await users_repo.get_by_id(conn, booking["athlete_user_id"])
    athlete_name = athlete["first_name"] if athlete else "Атлет"
    when = booking["starts_at"].strftime("%d.%m в %H:%M")
    await _notify_recipients(
        conn,
        recipient_ids=[booking["coach_user_id"]],
        category="booking_requested",
        title="Новая заявка на тренировку",
        body=f"{athlete_name} — {when}",
        entity_type="booking",
        entity_id=booking["id"],
        send_at=datetime.now(timezone.utc),
    )


async def schedule_booking_decided_notification(
    conn: asyncpg.Connection, booking: dict[str, Any], *, outcome: str
) -> None:
    """Pings the athlete once their booking request has an outcome —
    confirmed by the coach, declined by the coach, or auto-declined by the
    24h expiry sweep (see app.services.background.sweep_expired_bookings)."""
    if outcome == "confirmed":
        when = booking["starts_at"].strftime("%d.%m в %H:%M")
        body = f"Тренер подтвердил тренировку {when}."
    elif outcome == "declined":
        body = "Заявка на тренировку отклонена."
    else:
        body = "Заявка на тренировку отменена: тренер не ответил вовремя."
    await _notify_recipients(
        conn,
        recipient_ids=[booking["athlete_user_id"]],
        category="booking_decided",
        title="Статус заявки на тренировку",
        body=body,
        entity_type="booking",
        entity_id=booking["id"],
        send_at=datetime.now(timezone.utc),
    )
```

- [ ] **Step 5: Wire the routes**

In `backend/app/api/routes/bookings.py`, add the import
`from app.services import notifications as notifications_service`, then:

In `create_booking` (the `POST ""` route), right before `return await _to_out(conn, booking)`:

```python
    await notifications_service.schedule_booking_requested_notification(conn, booking)
    return await _to_out(conn, booking)
```

In `confirm_booking` (the route added in Task 4), right before
`return await _to_out(conn, confirmed)`:

```python
    await notifications_service.schedule_booking_decided_notification(conn, confirmed, outcome="confirmed")
    return await _to_out(conn, confirmed)
```

In `decline_booking` (the route added in Task 4), right before
`return await _to_out(conn, declined)`:

```python
    await notifications_service.schedule_booking_decided_notification(conn, declined, outcome="declined")
    return await _to_out(conn, declined)
```

- [ ] **Step 6: Wire the sweep**

In `backend/app/services/background.py`, add the import
`from app.services import notifications as notifications_service` and
update `sweep_expired_bookings`:

```python
async def sweep_expired_bookings(conn: asyncpg.Connection) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=BOOKING_EXPIRY_HOURS)
    expired = await bookings_repo.sweep_expired(conn, older_than=cutoff)
    for booking in expired:
        await notifications_service.schedule_booking_decided_notification(conn, booking, outcome="expired")
    if expired:
        logger.info("Auto-declined %d expired booking request(s)", len(expired))
```

- [ ] **Step 7: Expose the notification store to tests**

In `backend/tests/conftest.py`, right before `with TestClient(app) as test_client:`,
after the `app.dependency_overrides[deps.get_db] = override_get_db` line,
there is a `with TestClient(app) as test_client: yield test_client` block.
Change it to attach the store for inspection:

```python
    with TestClient(app) as test_client:
        test_client.notifications_store = notifications_store
        yield test_client
```

- [ ] **Step 8: Run the tests**

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest tests/test_booking_confirmation_api.py tests/test_notifications_api.py -v
```

Expected: all PASS. Also run the full backend suite to confirm nothing else broke:

```bash
docker compose -f docker-compose.dev.yml exec backend python -m pytest -q
```

Expected: all PASS (same count as before this plan, plus the new tests
added across Tasks 3-6).

- [ ] **Step 9: Commit**

```bash
git add backend/app/schemas/notification.py backend/app/services/notifications.py backend/app/api/routes/bookings.py backend/app/services/background.py backend/tests/conftest.py backend/tests/test_booking_confirmation_api.py
git commit -m "feat: notify coach on new booking requests and athlete on the outcome"
```

---

### Task 7: Frontend types and API client for booking confirmation

**Files:**
- Modify: `frontend/src/types/booking.ts`
- Modify: `frontend/src/types/notification.ts`
- Modify: `frontend/src/api/bookings.ts`

**Interfaces:**
- Produces: `BookingStatus` union type, `Booking.status: BookingStatus`, `Booking.trainingId: string | null`, `PendingBookingDto`/`PendingBooking`/`mapPendingBookingDto`, and `listCoachPendingBookings`/`confirmBooking`/`declineBooking` in `api/bookings.ts` — Tasks 8-9 consume all of these.

- [ ] **Step 1: Widen the booking status type and make `trainingId` nullable**

In `frontend/src/types/booking.ts`, add near the top (after the imports, if
any — this file has none currently):

```typescript
export type BookingStatus = "pending" | "confirmed" | "declined" | "expired" | "cancelled";
```

Change `BookingDto.training_id: string;` to `training_id: string | null;`
and `BookingDto.status: string;` to `status: BookingStatus;`.

Change `Booking.trainingId: string;` to `trainingId: string | null;` and
`Booking.status: string;` to `status: BookingStatus;`.

In `mapBookingDto`, no line changes are needed — `trainingId: dto.training_id`
and `status: dto.status` already just pass the value through; only the
types tighten.

Then add, at the end of the file:

```typescript
export interface PendingBookingDto {
  id: string;
  athlete_user_id: string;
  athlete_full_name: string;
  starts_at: string;
  duration_minutes: number;
  format: string;
  price_per_session: number | null;
  currency: string;
  created_at: string;
}

export interface PendingBooking {
  id: string;
  athleteUserId: string;
  athleteFullName: string;
  startsAt: string;
  durationMinutes: number;
  format: "online" | "offline";
  pricePerSession: number | null;
  currency: string;
  createdAt: string;
}

export function mapPendingBookingDto(dto: PendingBookingDto): PendingBooking {
  return {
    id: dto.id,
    athleteUserId: dto.athlete_user_id,
    athleteFullName: dto.athlete_full_name,
    startsAt: dto.starts_at,
    durationMinutes: dto.duration_minutes,
    format: dto.format as "online" | "offline",
    pricePerSession: dto.price_per_session,
    currency: dto.currency,
    createdAt: dto.created_at,
  };
}
```

- [ ] **Step 2: Add the two new notification categories**

In `frontend/src/types/notification.ts`, change:

```typescript
export type NotificationCategory = "training_reminder" | "task_deadline" | "new_training" | "new_match" | "new_task";

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  training_reminder: "Напоминания о тренировках",
  task_deadline: "Напоминания о дедлайнах заданий",
  new_training: "Новые тренировки в команде",
  new_match: "Новые матчи",
  new_task: "Новые задания",
};
```

to:

```typescript
export type NotificationCategory =
  | "training_reminder"
  | "task_deadline"
  | "new_training"
  | "new_match"
  | "new_task"
  | "booking_requested"
  | "booking_decided";

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  training_reminder: "Напоминания о тренировках",
  task_deadline: "Напоминания о дедлайнах заданий",
  new_training: "Новые тренировки в команде",
  new_match: "Новые матчи",
  new_task: "Новые задания",
  booking_requested: "Новые заявки на тренировку (для тренера)",
  booking_decided: "Статус моих заявок на тренировку",
};
```

- [ ] **Step 3: Add the new API functions**

In `frontend/src/api/bookings.ts`, change the import line to also pull in
the new type/mapper:

```typescript
import { mapBookingDto, mapPendingBookingDto, type Booking, type BookingDto, type BookingInput, type PendingBooking, type PendingBookingDto, type ReviewDto, type ReviewInput } from "../types/booking";
```

Then add at the end of the file:

```typescript
export async function listCoachPendingBookings(token: string): Promise<PendingBooking[]> {
  const dtos = await apiRequest<PendingBookingDto[]>("/api/bookings/coach/pending", { token });
  return dtos.map(mapPendingBookingDto);
}

export async function confirmBooking(token: string, bookingId: string): Promise<Booking> {
  const dto = await apiRequest<BookingDto>(`/api/bookings/${bookingId}/confirm`, { method: "POST", token });
  return mapBookingDto(dto);
}

export async function declineBooking(token: string, bookingId: string): Promise<Booking> {
  const dto = await apiRequest<BookingDto>(`/api/bookings/${bookingId}/decline`, { method: "POST", token });
  return mapBookingDto(dto);
}
```

- [ ] **Step 4: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec frontend npx tsc --noEmit
```

Expected: no errors. (There will likely be pre-existing errors in files
this task hasn't touched yet — `MyBookingsSection.tsx` still reads
`b.trainingId` as if non-null in places it doesn't, so this step should be
clean; if not, note which file/line and fix it as part of this task since
it's this task's type change causing it.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/booking.ts frontend/src/types/notification.ts frontend/src/api/bookings.ts
git commit -m "feat: add booking-confirmation types and API client functions"
```

---

### Task 8: Athlete-side UI — pending/declined/expired states

**Files:**
- Modify: `frontend/src/components/coaches/BookingFlow.tsx`
- Modify: `frontend/src/components/coaches/CoachMarketplaceScreen.tsx` (the `"confirmed"` view)
- Modify: `frontend/src/components/coaches/MyBookingsSection.tsx`
- Modify: `frontend/src/components/coaches/coaches.module.css`

**Interfaces:**
- Consumes: `Booking.status: BookingStatus` (Task 7), `listMyBookings` (existing, unchanged signature — now returns rows in any of 5 statuses).

- [ ] **Step 1: Update the booking-flow success copy**

In `frontend/src/components/coaches/BookingFlow.tsx`, change:

```tsx
            <p className={profileStyles.subtitle}>После подтверждения бронь появится в вашем календаре.</p>
```

to:

```tsx
            <p className={profileStyles.subtitle}>Заявка уйдёт тренеру на подтверждение — она появится в календаре, как только он её примет.</p>
```

- [ ] **Step 2: Update the post-booking success screen copy**

In `frontend/src/components/coaches/CoachMarketplaceScreen.tsx`, change the
`"confirmed"` view block:

```tsx
          <h2 className={teamStyles.teamName}>Готово!</h2>
          <p className={teamStyles.teamMeta}>
            Бронь с {view.booking.coachFullName} на{" "}
            {new Date(view.booking.startsAt).toLocaleString("ru-RU", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}{" "}
            подтверждена и добавлена в ваш календарь.
          </p>
```

to:

```tsx
          <h2 className={teamStyles.teamName}>Заявка отправлена!</h2>
          <p className={teamStyles.teamMeta}>
            Заявка на {new Date(view.booking.startsAt).toLocaleString("ru-RU", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}{" "}
            отправлена тренеру {view.booking.coachFullName}. Ждите подтверждения — статус можно посмотреть в «Мои
            брони» в профиле.
          </p>
```

- [ ] **Step 3: Add status sections to "Мои брони"**

In `frontend/src/components/coaches/MyBookingsSection.tsx`, replace:

```tsx
  const upcoming = state.bookings.filter((b) => !b.isCompleted && b.status === "confirmed");
  const past = state.bookings.filter((b) => b.isCompleted);
```

with:

```tsx
  const pending = state.bookings.filter((b) => b.status === "pending");
  const upcoming = state.bookings.filter((b) => !b.isCompleted && b.status === "confirmed");
  const past = state.bookings.filter((b) => b.isCompleted);
  const declinedOrExpired = state.bookings.filter((b) => b.status === "declined" || b.status === "expired");
```

Then, right after the opening `<h1 className={profileStyles.pageHeading}>Мои брони</h1>` line, add a new section before the existing "Предстоящие" one:

```tsx
        {pending.length > 0 && (
          <>
            <h2 className={profileStyles.title}>Ожидают подтверждения</h2>
            {pending.map((b) => (
              <div className={styles.bookingRow} key={b.id}>
                <div>
                  <p className={profileStyles.rowValue}>{b.coachFullName}</p>
                  <p className={profileStyles.subtitle}>{formatDate(b.startsAt)}</p>
                </div>
                <span className={styles.bookingStatus}>Ожидает тренера</span>
              </div>
            ))}
          </>
        )}
```

And after the existing "Прошедшие" block, add:

```tsx
        {declinedOrExpired.length > 0 && (
          <>
            <h2 className={profileStyles.title}>Отклонённые</h2>
            {declinedOrExpired.map((b) => (
              <div className={styles.bookingRow} key={b.id}>
                <div>
                  <p className={profileStyles.rowValue}>{b.coachFullName}</p>
                  <p className={profileStyles.subtitle}>{formatDate(b.startsAt)}</p>
                </div>
                <span className={styles.bookingStatusMuted}>
                  {b.status === "declined" ? "Отклонена тренером" : "Истекла — тренер не ответил"}
                </span>
              </div>
            ))}
          </>
        )}
```

- [ ] **Step 4: Add the muted status style**

In `frontend/src/components/coaches/coaches.module.css`, find the existing
`.bookingStatus` rule and add right after it:

```css
.bookingStatusMuted {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-text-secondary);
}
```

- [ ] **Step 5: Verify in the browser**

Start (or confirm running) the dev stack's frontend preview, log in as the
dev user, go through Тренеры → a listed coach → book a slot, then check
Профиль → Мои брони shows it under "Ожидают подтверждения" with the new
copy. (Full end-to-end including confirm/decline needs Task 9's coach
inbox and the second dev-login from Task 2 — a fuller check happens at the
end of Task 9.)

```bash
docker compose -f docker-compose.dev.yml exec frontend npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/coaches/BookingFlow.tsx frontend/src/components/coaches/CoachMarketplaceScreen.tsx frontend/src/components/coaches/MyBookingsSection.tsx frontend/src/components/coaches/coaches.module.css
git commit -m "feat: reflect pending/declined/expired booking states in athlete-facing UI"
```

---

### Task 9: Coach "Входящие" screen

**Files:**
- Create: `frontend/src/components/coaches/IncomingBookingsScreen.tsx`
- Modify: `frontend/src/components/coaches/coaches.module.css`
- Modify: `frontend/src/components/profile/ProfileSummary.tsx`
- Modify: `frontend/src/components/profile/ProfileScreen.tsx`

**Interfaces:**
- Consumes: `listCoachPendingBookings`, `confirmBooking`, `declineBooking` (Task 7), `PendingBooking` type (Task 7).

- [ ] **Step 1: Write the `IncomingBookingsScreen` component**

Create `frontend/src/components/coaches/IncomingBookingsScreen.tsx`:

```tsx
// frontend/src/components/coaches/IncomingBookingsScreen.tsx
import { useEffect, useState } from "react";
import { confirmBooking, declineBooking, listCoachPendingBookings } from "../../api/bookings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import type { PendingBooking } from "../../types/booking";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; bookings: PendingBooking[] };

export function IncomingBookingsScreen({ token, onBack }: { token: string; onBack: () => void }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = () => {
    listCoachPendingBookings(token)
      .then((bookings) => setState({ status: "ready", bookings }))
      .catch((err: unknown) =>
        setState({ status: "error", message: err instanceof ApiError ? err.message : "Не удалось загрузить заявки" }),
      );
  };

  useEffect(load, [token]);

  const respond = async (bookingId: string, action: "confirm" | "decline") => {
    setBusyId(bookingId);
    setActionError(null);
    try {
      if (action === "confirm") {
        await confirmBooking(token, bookingId);
      } else {
        await declineBooking(token, bookingId);
      }
      if (state.status === "ready") {
        setState({ status: "ready", bookings: state.bookings.filter((b) => b.id !== bookingId) });
      }
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось обработать заявку");
    } finally {
      setBusyId(null);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

  if (state.status === "loading") return <StateScreen kind="loading" title="Загрузка заявок…" />;
  if (state.status === "error") return <StateScreen kind="error" title="Не удалось загрузить заявки" description={state.message} />;

  return (
    <div className={profileStyles.screen}>
      <div className={sharedStyles.headerRow}>
        <button type="button" className={sharedStyles.iconButton} onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      <div className={profileStyles.card}>
        <h1 className={profileStyles.pageHeading}>Входящие заявки</h1>

        {actionError && <p className={profileStyles.error}>{actionError}</p>}

        {state.bookings.length === 0 && <p className={profileStyles.subtitle}>Нет заявок, ожидающих ответа.</p>}

        {state.bookings.map((b) => (
          <div className={styles.incomingRow} key={b.id}>
            <div>
              <p className={profileStyles.rowValue}>{b.athleteFullName}</p>
              <p className={profileStyles.subtitle}>
                {formatDate(b.startsAt)} · {b.format === "online" ? "Онлайн" : "Очно"}
              </p>
            </div>
            <div className={styles.incomingActions}>
              <button
                type="button"
                className={profileStyles.buttonPrimary}
                disabled={busyId === b.id}
                onClick={() => void respond(b.id, "confirm")}
              >
                Подтвердить
              </button>
              <button
                type="button"
                className={profileStyles.buttonSecondary}
                disabled={busyId === b.id}
                onClick={() => void respond(b.id, "decline")}
              >
                Отклонить
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add layout styles**

In `frontend/src/components/coaches/coaches.module.css`, add:

```css
.incomingRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);
}

.incomingRow:last-child {
  border-bottom: none;
}

.incomingActions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.pendingCountBadge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--radius-pill);
  background: var(--color-danger);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  margin-left: auto;
}
```

- [ ] **Step 3: Wire it into the profile screen**

In `frontend/src/components/profile/ProfileScreen.tsx`, add the import
`import { IncomingBookingsScreen } from "../coaches/IncomingBookingsScreen";`
(alongside the existing coaches imports), add
`const [showIncomingBookings, setShowIncomingBookings] = useState(false);`
next to the other `show*` state declarations, add the route:

```tsx
  if (showIncomingBookings) {
    return <IncomingBookingsScreen token={token} onBack={() => setShowIncomingBookings(false)} />;
  }
```

(place it next to the `showMarketplaceSettings` branch), and pass the new
callback to `<ProfileSummary>`:

```tsx
      onOpenIncomingBookings={() => setShowIncomingBookings(true)}
```

- [ ] **Step 4: Add the button + badge to `ProfileSummary`**

In `frontend/src/components/profile/ProfileSummary.tsx`:

Re-add the `token` prop (it was removed in the earlier settings-screen
change since nothing used it then; the pending-count fetch below needs it
again):

```tsx
interface ProfileSummaryProps {
  token: string;
  profile: ProfileMe;
```

and in the destructured params:

```tsx
export function ProfileSummary({
  token,
  profile,
```

add `onOpenIncomingBookings: () => void;` to the props interface (next to
`onOpenMarketplaceSettings`), add the import
`import { useEffect, useState } from "react";` (there is currently no React
hook import in this file — add it) and
`import { listCoachPendingBookings } from "../../api/bookings";`, then
inside the component body add:

```tsx
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (mode !== "coach") return;
    listCoachPendingBookings(token)
      .then((bookings) => setPendingCount(bookings.length))
      .catch(() => setPendingCount(0));
  }, [token, mode]);
```

(place this after the existing `const mode = ...` line).

Then replace the existing marketplace-settings card:

```tsx
      {mode === "coach" && profile.coach && (
        <div className={styles.card}>
          <button type="button" className={styles.buttonSecondary} onClick={onOpenMarketplaceSettings}>
            <Icon name="settings" size={17} />
            Маркетплейс тренеров
          </button>
        </div>
      )}
```

with:

```tsx
      {mode === "coach" && profile.coach && (
        <div className={styles.card}>
          <button type="button" className={styles.buttonSecondary} onClick={onOpenMarketplaceSettings}>
            <Icon name="settings" size={17} />
            Маркетплейс тренеров
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={onOpenIncomingBookings}>
            <Icon name="inbox" size={17} />
            Входящие заявки
            {pendingCount > 0 && <span className={styles.pendingCountBadge}>{pendingCount}</span>}
          </button>
        </div>
      )}
```

Note: `styles` here is `profile.module.css`, which doesn't have
`.pendingCountBadge` — that class was added to `coaches.module.css` in Step
2. Add a second style import at the top of `ProfileSummary.tsx`:
`import coachStyles from "../coaches/coaches.module.css";` and use
`className={coachStyles.pendingCountBadge}` instead of `styles.pendingCountBadge`
in the JSX above (this file already follows the "import a sibling module
for one class" convention used throughout the coaches/profile screens).

- [ ] **Step 5: Pass `token` back through from `ProfileScreen`**

In `frontend/src/components/profile/ProfileScreen.tsx`, the final
`<ProfileSummary ... />` call currently doesn't pass `token` (removed
earlier). Add it back:

```tsx
  return (
    <ProfileSummary
      token={token}
      profile={data}
```

- [ ] **Step 6: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec frontend npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Full end-to-end verification in the Browser pane**

1. Open the frontend preview (`http://localhost:5175`), log in as the coach
   dev user, go to Профиль → Маркетплейс тренеров, set up a listing (price,
   format, weekly availability) if not already done from earlier testing.
2. Open a second tab in a private/incognito window (or a second browser),
   navigate to the same URL, and call `POST /api/auth/dev-login-2` instead
   of the normal login flow — easiest via the browser's dev tools console:
   `fetch('/api/auth/dev-login-2', {method: 'POST'}).then(r => r.json()).then(d => localStorage.setItem('access_token', d.access_token))`
   then reload. This logs that tab in as the second dev user (the athlete).
3. In the athlete tab: Тренеры → the coach's card → Профиль → book an open
   slot. Confirm the success screen now says "Заявка отправлена!" and Мои
   брони shows it under "Ожидают подтверждения".
4. In the coach tab: Профиль → "Входящие заявки" — confirm the badge shows
   `1` and the request appears with the athlete's name, date/time, and
   format. Click "Подтвердить".
5. Back in the athlete tab, reload Мои брони — confirm the booking moved to
   "Предстоящие" and a personal training now exists for it in Календарь.
6. Repeat steps 3-4 with a second slot, this time clicking "Отклонить" in
   the coach tab — confirm it disappears from "Входящие", and in the
   athlete tab it now appears under "Отклонённые" as "Отклонена тренером".

Take a screenshot of the coach's "Входящие заявки" screen with a pending
request showing, and of the athlete's "Мои брони" showing the pending
section, as proof.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/coaches/IncomingBookingsScreen.tsx frontend/src/components/coaches/coaches.module.css frontend/src/components/profile/ProfileSummary.tsx frontend/src/components/profile/ProfileScreen.tsx
git commit -m "feat: add coach's incoming-bookings inbox with confirm/decline actions"
```

---

## Self-Review Notes

- **Spec coverage:** who-confirms (coach) → Tasks 4/9; slot-held-while-pending → Task 1 (partial index) + Task 3 (compute_open_slots); no decline reason → Task 4/9 (single-click decline, no comment field anywhere); Training-created-on-confirm-only → Task 4; 24h auto-expiry → Task 5; dev-login-2 → Task 2; notifications (both categories, both directions) → Task 6; athlete UI (pending/declined/expired sections, copy changes) → Task 8; coach inbox with badge → Task 9. All spec sections have a task.
- **Placeholder scan:** no TBD/TODO; every step has literal code, not a description of code.
- **Type consistency:** `bookings_repo.confirm_booking`/`decline_booking`/`list_pending_for_coach`/`sweep_expired` signatures match between their Task 4/5 definitions and every call site (routes in Task 4/6, `background.py` in Task 5/6, fakes in `conftest.py`). `PendingBookingOut` (backend, Task 4) and `PendingBookingDto`/`PendingBooking` (frontend, Task 7) carry the same field set. `schedule_booking_decided_notification`'s `outcome` values (`"confirmed"|"declined"|"expired"`) are used identically at all three call sites (Task 6 routes, Task 6 sweep wiring).
