from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from app.services import background

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
    coach_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as, telegram_id=890401)

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
    coach_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as, telegram_id=890402)

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
    coach_id, athlete_token, booking = _create_pending_booking(client, coach_token, login_as, telegram_id=890201)

    monkeypatch.setattr(background, "BOOKING_EXPIRY_HOURS", 0)
    await background.sweep_expired_bookings(None)

    mine = client.get("/api/bookings/me", headers={"Authorization": f"Bearer {athlete_token}"}).json()
    assert mine[0]["status"] == "expired"


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
