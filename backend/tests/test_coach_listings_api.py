from __future__ import annotations

import io
from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4

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


def test_cannot_delete_listing_with_active_booking(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    listing = _list_a_listing(client, token)

    # Insert a pending booking directly into the shared fake bookings store
    # (same shape/pattern used elsewhere in this suite, e.g.
    # test_booking_on_one_listing_blocks_the_slot_on_the_coachs_other_listing) —
    # the guard under test (has_active_booking) is keyed on listing_id.
    booking_id = uuid4()
    client.bookings_store[booking_id] = {
        "id": booking_id,
        "coach_user_id": UUID(listing["coach_user_id"]),
        "listing_id": UUID(listing["id"]),
        "athlete_user_id": uuid4(),
        "starts_at": datetime.now(timezone.utc) + timedelta(days=1),
        "duration_minutes": 60,
        "format": "online",
        "price_per_session": 2000,
        "currency": "RUB",
        "status": "pending",
        "training_id": None,
        "created_at": datetime.now(timezone.utc),
        "responded_at": None,
    }

    resp = client.delete(f"/api/coach-listings/{listing['id']}", headers=headers)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "listing_has_active_booking"

    # Once the booking is no longer active, the same listing can be deleted.
    client.bookings_store[booking_id]["status"] = "declined"
    resp2 = client.delete(f"/api/coach-listings/{listing['id']}", headers=headers)
    assert resp2.status_code == 204

    mine = client.get("/api/coach-listings/me", headers=headers).json()
    assert mine == []


def test_upload_and_replace_listing_photo(logged_in_client, login_as) -> None:
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

    # Listing photos are uploaded with access_level=PUBLIC precisely so that
    # athletes browsing the marketplace (not just the owning coach) can see
    # them. Fetching with the owner's own token would pass even for a
    # PRIVATE file, so prove PUBLIC access genuinely works by fetching as a
    # completely different, non-owning user.
    other_token = login_as(870003, first_name="BrowsingAthlete")
    other_headers = {"Authorization": f"Bearer {other_token}"}
    other_get = client.get(f"/api/files/{second_file_id}", headers=other_headers)
    assert other_get.status_code == 200


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


def test_upload_listing_video_within_limits_succeeds(logged_in_client, queue_video_duration) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)
    listing = client.post("/api/coach-listings", headers=headers, json=_listing_payload()).json()

    queue_video_duration(45)  # under the 60s hard limit
    resp = client.post(
        f"/api/coach-listings/{listing['id']}/video",
        headers=headers,
        files={"file": ("clip.mp4", io.BytesIO(b"fake-mp4-bytes"), "video/mp4")},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["video_file_id"] is not None


def test_upload_listing_video_rejects_over_duration_limit(logged_in_client, queue_video_duration) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)
    listing = client.post("/api/coach-listings", headers=headers, json=_listing_payload()).json()

    queue_video_duration(75)  # over the 60s hard limit
    resp = client.post(
        f"/api/coach-listings/{listing['id']}/video",
        headers=headers,
        files={"file": ("clip.mp4", io.BytesIO(b"fake-mp4-bytes"), "video/mp4")},
    )
    assert resp.status_code == 413
    assert resp.json()["error"]["code"] == "video_too_long"
    # Rejected upload must not have left a file record behind.
    assert client.get("/api/coach-listings/me", headers=headers).json()[0]["video_file_id"] is None


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


def test_booking_on_one_listing_blocks_the_slot_on_the_coachs_other_listing(logged_in_client) -> None:
    """compute_open_slots keys its "booked" lookup on coach_user_id, not
    listing_id, because a coach can list the same available time through
    several listings but can still only be in one place at a time. Prove
    that a booking made against listing A also removes the identical slot
    from listing B's open slots — while a different slot time stays open on
    both — rather than trusting the (correct, but untested) implementation."""
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)

    listing_a = client.post(
        "/api/coach-listings", headers=headers, json=_listing_payload(title="Индивидуальные")
    ).json()
    listing_b = client.post(
        "/api/coach-listings", headers=headers, json=_listing_payload(title="Групповые")
    ).json()
    assert listing_a["coach_user_id"] == listing_b["coach_user_id"]

    # Both listings expose the same Monday 10:00-12:00 window, so the same
    # two candidate slots (10:00 and 11:00) exist in both listings' open
    # slots before anything is booked.
    for listing in (listing_a, listing_b):
        client.put(
            f"/api/coach-listings/{listing['id']}/availability",
            headers=headers,
            json=[{"weekday": 0, "start_time": "10:00:00", "end_time": "12:00:00"}],
        )
        resp = client.put(
            f"/api/coach-listings/{listing['id']}", headers=headers, json=_listing_payload(is_listed=True)
        )
        assert resp.status_code == 200, resp.text

    today = date.today()
    days_until_monday = (7 - today.weekday()) % 7
    next_monday = today + timedelta(days=days_until_monday or 7)
    booked_starts_at = datetime.combine(next_monday, datetime.min.time(), tzinfo=timezone.utc).replace(hour=10)
    other_starts_at = booked_starts_at.replace(hour=11)

    # Book the 10:00 slot directly against listing A's flow by inserting
    # into the shared fake bookings store (the real POST /api/bookings
    # endpoint for listings doesn't exist yet) — same shape fake_create_booking
    # builds, keyed on the shared coach's user id.
    coach_user_id = UUID(listing_a["coach_user_id"])
    booking_id = uuid4()
    client.bookings_store[booking_id] = {
        "id": booking_id,
        "coach_user_id": coach_user_id,
        "listing_id": UUID(listing_a["id"]),
        "athlete_user_id": uuid4(),
        "starts_at": booked_starts_at,
        "duration_minutes": 60,
        "format": "online",
        "price_per_session": 2000,
        "currency": "RUB",
        "status": "confirmed",
        "training_id": None,
        "created_at": datetime.now(timezone.utc),
        "responded_at": None,
    }

    slots_a = client.get(
        f"/api/coach-listings/{listing_a['id']}/slots",
        params={"from_date": next_monday.isoformat(), "to_date": next_monday.isoformat()},
        headers=headers,
    ).json()
    slots_b = client.get(
        f"/api/coach-listings/{listing_b['id']}/slots",
        params={"from_date": next_monday.isoformat(), "to_date": next_monday.isoformat()},
        headers=headers,
    ).json()

    expected_remaining = [{"starts_at": other_starts_at.isoformat().replace("+00:00", "Z"), "duration_minutes": 60}]
    assert slots_a == expected_remaining
    assert slots_b == expected_remaining


def test_list_listings_rejects_non_numeric_max_price(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.get("/api/coach-listings", params={"max_price": "abc"}, headers=headers)
    assert resp.status_code == 422


def test_slots_rejects_invalid_date_range(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    listing = _list_a_listing(client, token)

    today = date.today()
    resp = client.get(
        f"/api/coach-listings/{listing['id']}/slots",
        params={"from_date": today.isoformat(), "to_date": (today - timedelta(days=1)).isoformat()},
        headers=headers,
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "invalid_date_range"


def test_slots_rejects_date_range_too_wide(logged_in_client) -> None:
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    listing = _list_a_listing(client, token)

    today = date.today()
    resp = client.get(
        f"/api/coach-listings/{listing['id']}/slots",
        params={"from_date": today.isoformat(), "to_date": (today + timedelta(days=120)).isoformat()},
        headers=headers,
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "date_range_too_wide"


def test_listing_schema_rejects_is_listed_without_price(logged_in_client) -> None:
    """Distinct from test_update_listing_requires_availability_before_listing
    (the route-level 409 availability_required check): this proves the
    Pydantic-level _validate_listing_requirements validator on
    CoachListingIn itself rejects is_listed=true with no price, independent
    of whether availability windows exist."""
    client, token = logged_in_client
    headers = {"Authorization": f"Bearer {token}"}
    _create_coach_profile(client, token)
    listing = client.post("/api/coach-listings", headers=headers, json=_listing_payload()).json()
    client.put(
        f"/api/coach-listings/{listing['id']}/availability",
        headers=headers,
        json=[{"weekday": 0, "start_time": "10:00:00", "end_time": "12:00:00"}],
    )

    resp = client.put(
        f"/api/coach-listings/{listing['id']}",
        headers=headers,
        json=_listing_payload(is_listed=True, price_per_session=None),
    )
    assert resp.status_code == 422
