"""«Подобрать тренера», stage 3 — the money: the platform's raised share of the FIRST session with a client it brought, who gets that
right and when it passes on, the in-app payment that cannot be bypassed, and the athlete staying anonymous to the trainer until they pay.
Real PostgreSQL, real sessions, a pretend ЮKassa."""
from __future__ import annotations

import asyncio
from datetime import timedelta

from tests.admin_world import Browser, live_client, pg, publish_listing, world  # noqa: F401  (fixtures)
from tests.finance_helpers import MONDAY, webhook
from tests.live_helpers import sql, sql_value
from tests.test_finance import ADMIN_EMAIL, fin, reconfigure  # noqa: F401  (fixtures and helpers)
from tests.test_match_offers import CONTACTS, MINE, QUEUE, error_code, make_coach, new_request, offer, offer_id

GENERAL = "/api/admin/finance/match-commission"


def listing_of(fin, coach: Browser) -> str:
    return sql_value(fin.dsn, "SELECT id::text FROM coach_listings WHERE coach_user_id = $1::uuid ORDER BY created_at LIMIT 1", coach.user_id)


def matched(fin, athlete: Browser, coach: Browser, **offer_body) -> str:
    """The whole road to «the athlete chose this trainer»: request, offer, the trainer agrees, the athlete agrees. The offer's id."""
    request = new_request(athlete)
    if offer_body:
        fin.admin.ok("POST", f"{QUEUE}/{request['id']}/offers", json={"coach_user_id": coach.user_id, **offer_body})
    else:
        offer(fin.world, request["id"], coach)
    oid = offer_id(fin.world, request["id"], coach)
    coach.ok("POST", f"/api/match-offers/{oid}/accept")
    athlete.ok("POST", f"{MINE}/offers/{oid}/accept")
    return oid


def book(player: Browser, listing_id: str, n: int = 0) -> dict:
    slots = player.ok("GET", f"/api/coach-listings/{listing_id}/slots", params={"from_date": MONDAY.isoformat(), "to_date": (MONDAY + timedelta(days=21)).isoformat()})
    return player.ok("POST", "/api/bookings", json={"listing_id": listing_id, "starts_at": slots[n]["starts_at"], "format": "online"})


def pay(fin, player: Browser, booking: dict) -> None:
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    pid = next(p for p in fin.provider.payments if fin.provider.payments[p]["metadata"]["booking_id"] == booking["id"])
    fin.provider.finish(pid, "succeeded")
    assert webhook(fin.world, pid).status_code == 200


def payment(fin, booking: dict) -> dict:
    return sql(fin.dsn, "SELECT gross_kopecks, commission_percent::float AS percent, platform_fee_kopecks, trainer_kopecks FROM payments WHERE booking_id = $1::uuid", booking["id"])[0]


def setup(fin):
    coach = make_coach(fin.world)
    athlete = Browser(fin.world.client, "athlete@example.com", "Анна", "player")
    athlete.ok("PUT", "/api/profile/player", json={"full_name": "Анна", "sport": "Теннис", "age": 20, "height_cm": None, "weight_kg": None,
                                                   "position": None, "level": "amateur", "goals": None, "load_restrictions": None})
    return coach, athlete, listing_of(fin, coach)


# --- the general percent: set by a finance administrator, with a history ---------------------------------------------------


def test_the_general_percent_starts_from_the_environment_and_keeps_a_history(fin) -> None:
    view = fin.admin.ok("GET", GENERAL)
    assert view["percent"] == "50" and view["source"] == "environment" and view["history"] == [] and view["max_percent"] == "100"
    assert view["attribution_days"] == 30

    changed = fin.admin.ok("PUT", GENERAL, json={"percent": "40", "reason": "Осенняя акция"})
    assert changed["percent"] == "40" and changed["source"] == "admin"
    fin.admin.ok("PUT", GENERAL, json={"percent": "100", "reason": "Потолок"})
    history = fin.admin.ok("GET", GENERAL)["history"]
    assert [(h["previous"], h["percent"]) for h in history] == [("40", "100"), ("50", "40")]
    assert history[0]["changed_by_email"] == ADMIN_EMAIL
    row = sql(fin.dsn, "SELECT reason, details::text AS d FROM admin_audit_log WHERE action = 'finance.match_commission.change' ORDER BY created_at LIMIT 1")[0]
    assert row["reason"] == "Осенняя акция" and '"50"' in row["d"] and '"40"' in row["d"]
    # the ordinary commission is a separate setting
    assert fin.admin.ok("GET", "/api/admin/finance/commission")["percent"] == "10"


def test_the_general_percent_is_bounded_and_needs_a_reason_and_a_finance_administrator(fin) -> None:
    for body in ({"percent": "100.01", "reason": "x"}, {"percent": "-1", "reason": "x"}, {"percent": "40.123", "reason": "x"}, {"percent": "40", "reason": ""}, {"percent": "40"}):
        assert fin.admin.call("PUT", GENERAL, json=body).status_code == 422, body
    assert error_code(fin.admin.call("PUT", GENERAL, json={"percent": "50", "reason": "то же"})) == "commission_unchanged"
    assert fin.admin.ok("PUT", GENERAL, json={"percent": "0", "reason": "Без комиссии"})["percent"] == "0"

    reconfigure(fin, FINANCE_ADMIN_EMAILS="somebody.else@example.com")
    assert error_code(fin.admin.call("PUT", GENERAL, json={"percent": "20", "reason": "Проверка"})) == "finance_access_required"
    assert fin.admin.call("GET", GENERAL).status_code == 403
    reconfigure(fin, FINANCE_ADMIN_EMAILS=ADMIN_EMAIL)
    sql(fin.dsn, "UPDATE user_sessions SET mfa_verified_at = now() - interval '30 minutes' WHERE user_id = $1::uuid", fin.world.admin.user_id)
    assert error_code(fin.admin.call("PUT", GENERAL, json={"percent": "20", "reason": "Проверка"})) == "mfa_recent_required"
    assert sql_value(fin.dsn, "SELECT count(*) FROM match_commission_changes") == 1


# --- the percent of an offer: from the general setting, or its own, then frozen ----------------------------------------------


def test_an_offer_takes_the_current_general_percent_and_keeps_it(fin) -> None:
    coach, athlete, _ = setup(fin)
    fin.admin.ok("PUT", GENERAL, json={"percent": "35", "reason": "Новый тариф"})
    oid = matched(fin, athlete, coach)

    fin.admin.ok("PUT", GENERAL, json={"percent": "60", "reason": "Снова меняем"})

    assert sql_value(fin.dsn, "SELECT first_session_percent::float FROM coach_match_offers WHERE id = $1::uuid", oid) == 35
    admin_view = fin.admin.ok("GET", f"{QUEUE}/{sql_value(fin.dsn, 'SELECT request_id::text FROM coach_match_offers')}")["offers"][0]
    assert admin_view["first_session_percent"] == 35 and admin_view["percent_overridden"] is False and admin_view["window_ends_at"] is not None


def test_a_finance_administrator_can_set_the_percent_of_one_offer_with_a_reason(fin) -> None:
    coach, athlete, _ = setup(fin)
    request = new_request(athlete)
    body = {"coach_user_id": coach.user_id, "first_session_percent": "30", "percent_reason": "Договорились с тренером об особых условиях"}

    created = fin.admin.ok("POST", f"{QUEUE}/{request['id']}/offers", json=body)

    one = created["offers"][0]
    assert one["first_session_percent"] == 30 and one["percent_overridden"] is True and one["percent_reason"] == "Договорились с тренером об особых условиях"
    row = sql(fin.dsn, "SELECT reason, details::text AS d FROM admin_audit_log WHERE action = 'match_offer_create'")[0]
    assert row["reason"] == "Договорились с тренером об особых условиях" and '"percent_overridden": true' in row["d"]
    assert coach.ok("GET", "/api/match-offers/incoming")[0]["first_session_percent"] == 30  # the trainer is shown what will be taken


def test_an_override_needs_a_reason_a_finance_administrator_and_a_sane_number(fin) -> None:
    coach, athlete, _ = setup(fin)
    request = new_request(athlete)
    url = f"{QUEUE}/{request['id']}/offers"
    assert fin.admin.call("POST", url, json={"coach_user_id": coach.user_id, "first_session_percent": "30"}).status_code == 422
    assert fin.admin.call("POST", url, json={"coach_user_id": coach.user_id, "first_session_percent": "101", "percent_reason": "x"}).status_code == 422

    reconfigure(fin, FINANCE_ADMIN_EMAILS="somebody.else@example.com")  # an ordinary administrator may offer, but not change the percent
    other = new_request(Browser(fin.world.client, "second@example.com", "Борис", "player"))
    denied = fin.admin.call("POST", f"{QUEUE}/{other['id']}/offers", json={"coach_user_id": coach.user_id, "first_session_percent": "10", "percent_reason": "Хочу"})
    assert denied.status_code == 403 and error_code(denied) == "finance_access_required"
    assert fin.admin.call("POST", f"{QUEUE}/{other['id']}/offers", json={"coach_user_id": coach.user_id}).status_code == 201


# --- the money of the first session ---------------------------------------------------------------------------------------


def test_the_first_booking_after_the_choice_pays_the_offers_percent_and_the_next_one_the_usual(fin) -> None:
    coach, athlete, listing = setup(fin)
    matched(fin, athlete, coach)

    first = book(athlete, listing, 0)
    assert first["from_match"] is True and first["match_percent"] is None  # the athlete is not told the platform's share
    coach.ok("POST", f"/api/bookings/{first['id']}/confirm")
    pay(fin, athlete, first)

    money = payment(fin, first)
    assert money["percent"] == 50 and money["platform_fee_kopecks"] == money["gross_kopecks"] // 2
    assert money["platform_fee_kopecks"] + money["trainer_kopecks"] == money["gross_kopecks"]
    assert sql_value(fin.dsn, "SELECT commission_percent::float FROM trainer_earnings WHERE booking_id = $1::uuid", first["id"]) == 50
    assert sql_value(fin.dsn, "SELECT gross_kopecks FROM payments WHERE booking_id = $1::uuid", first["id"]) == 250000  # the price is unchanged

    second = book(athlete, listing, 1)
    assert second["from_match"] is False
    coach.ok("POST", f"/api/bookings/{second['id']}/confirm")
    pay(fin, athlete, second)
    assert payment(fin, second)["percent"] == 10


def test_the_percent_of_the_offer_replaces_a_personal_commission_and_the_trainer_sees_it(fin) -> None:
    coach, athlete, listing = setup(fin)
    fin.admin.ok("PUT", f"/api/admin/finance/coach-commissions/{coach.user_id}", json={"percent": "5", "reason": "Личный тариф"})
    matched(fin, athlete, coach, first_session_percent="25", percent_reason="Особые условия")

    first = book(athlete, listing, 0)
    coach.ok("POST", f"/api/bookings/{first['id']}/confirm")
    shown = next(b for b in coach.ok("GET", "/api/bookings/coach") if b["id"] == first["id"])
    assert shown["from_match"] is True and shown["match_percent"] == 25
    pay(fin, athlete, first)

    assert payment(fin, first)["percent"] == 25
    later = book(athlete, listing, 1)
    coach.ok("POST", f"/api/bookings/{later['id']}/confirm")
    pay(fin, athlete, later)
    assert payment(fin, later)["percent"] == 5  # the personal percent is back for everything after the first session


def test_a_change_of_the_general_percent_after_the_offer_does_not_touch_its_payment(fin) -> None:
    coach, athlete, listing = setup(fin)
    matched(fin, athlete, coach)
    fin.admin.ok("PUT", GENERAL, json={"percent": "80", "reason": "Позже"})
    fin.admin.ok("PUT", "/api/admin/finance/commission", json={"percent": "20", "reason": "Общая тоже"})

    first = book(athlete, listing, 0)
    coach.ok("POST", f"/api/bookings/{first['id']}/confirm")
    pay(fin, athlete, first)

    assert payment(fin, first)["percent"] == 50


def test_an_ordinary_booking_of_an_unrelated_athlete_is_not_touched(fin) -> None:
    coach, athlete, listing = setup(fin)
    matched(fin, athlete, coach)
    stranger = Browser(fin.world.client, "stranger@example.com", "Борис", "player")

    booking = book(stranger, listing, 0)
    coach.ok("POST", f"/api/bookings/{booking['id']}/confirm")
    pay(fin, stranger, booking)

    assert booking["from_match"] is False and payment(fin, booking)["percent"] == 10


# --- who gets the right, and when it passes on ---------------------------------------------------------------------------


def test_a_booking_before_the_choice_or_after_the_window_follows_the_usual_rules(fin) -> None:
    coach, athlete, listing = setup(fin)
    request = new_request(athlete)
    offer(fin.world, request["id"], coach)
    oid = offer_id(fin.world, request["id"], coach)
    coach.ok("POST", f"/api/match-offers/{oid}/accept")

    early = book(athlete, listing, 0)  # the trainer agreed, the athlete has not chosen yet
    assert early["from_match"] is False
    athlete.ok("POST", f"{MINE}/offers/{oid}/accept")
    assert sql_value(fin.dsn, "SELECT match_offer_id FROM bookings WHERE id = $1::uuid", early["id"]) is not None  # ... it takes the right on the choice
    coach.ok("POST", f"/api/bookings/{early['id']}/decline")

    sql(fin.dsn, "UPDATE coach_match_offers SET window_ends_at = now() - interval '1 minute'")
    late = book(athlete, listing, 1)
    assert late["from_match"] is False


def test_the_window_is_counted_from_the_choice_for_the_configured_number_of_days(fin) -> None:
    reconfigure(fin, MATCH_ATTRIBUTION_DAYS="7")
    coach, athlete, _ = setup(fin)
    matched(fin, athlete, coach)

    days = sql_value(fin.dsn, "SELECT round(extract(epoch FROM window_ends_at - athlete_responded_at) / 86400)::int FROM coach_match_offers")

    assert days == 7


def test_the_right_belongs_to_one_booking_at_a_time_and_passes_on_when_it_is_released(fin) -> None:
    coach, athlete, listing = setup(fin)
    matched(fin, athlete, coach)
    first = book(athlete, listing, 0)
    assert first["from_match"] is True
    blocked = athlete.call("POST", "/api/bookings", json={"listing_id": listing, "starts_at": first["starts_at"], "format": "online"})
    assert blocked.status_code == 409 and error_code(blocked) == "match_booking_open"  # one unpaid first session at a time

    coach.ok("POST", f"/api/bookings/{first['id']}/decline")  # declined: the right is free again
    second = book(athlete, listing, 1)
    assert second["from_match"] is True
    coach.ok("POST", f"/api/bookings/{second['id']}/confirm")
    pay(fin, athlete, second)
    assert payment(fin, second)["percent"] == 50
    assert sql_value(fin.dsn, "SELECT count(*) FROM bookings WHERE match_offer_id IS NOT NULL") == 2

    third = book(athlete, listing, 2)  # the right is used by the paid one
    assert third["from_match"] is False


def test_a_fully_refunded_first_session_gives_the_right_to_the_next_booking(fin) -> None:
    coach, athlete, listing = setup(fin)
    matched(fin, athlete, coach)
    first = book(athlete, listing, 0)
    coach.ok("POST", f"/api/bookings/{first['id']}/confirm")
    pay(fin, athlete, first)
    # the money went back in full and the booking was cancelled
    sql(fin.dsn, "UPDATE payments SET status = 'refunded' WHERE booking_id = $1::uuid", first["id"])
    sql(fin.dsn, "UPDATE bookings SET status = 'cancelled' WHERE id = $1::uuid", first["id"])

    second = book(athlete, listing, 1)

    assert second["from_match"] is True


def test_a_late_cancellation_that_returns_nothing_keeps_the_right_used(fin) -> None:
    coach, athlete, listing = setup(fin)
    matched(fin, athlete, coach)
    first = book(athlete, listing, 0)
    coach.ok("POST", f"/api/bookings/{first['id']}/confirm")
    pay(fin, athlete, first)
    sql(fin.dsn, "UPDATE bookings SET status = 'cancelled' WHERE id = $1::uuid", first["id"])  # paid, cancelled late: the trainer keeps the money

    assert book(athlete, listing, 1)["from_match"] is False


def test_an_unpaid_confirmed_booking_that_is_over_releases_the_right(fin) -> None:
    coach, athlete, listing = setup(fin)
    matched(fin, athlete, coach)
    first = book(athlete, listing, 0)
    coach.ok("POST", f"/api/bookings/{first['id']}/confirm")
    sql(fin.dsn, "UPDATE bookings SET starts_at = starts_at - interval '60 days' WHERE id = $1::uuid", first["id"])

    assert book(athlete, listing, 0)["from_match"] is True


def test_a_free_booking_does_not_use_the_right_up(fin) -> None:
    coach, athlete, listing = setup(fin)
    matched(fin, athlete, coach)
    sql(fin.dsn, "UPDATE coach_listings SET price_per_session = 0")
    free = book(athlete, listing, 0)
    assert free["from_match"] is False
    sql(fin.dsn, "UPDATE coach_listings SET price_per_session = 2500")

    assert book(athlete, listing, 1)["from_match"] is True


def test_any_listing_of_the_trainer_counts_not_only_the_one_from_the_offer(fin) -> None:
    coach, athlete, _ = setup(fin)
    matched(fin, athlete, coach)
    other = publish_listing(coach, "Второе объявление")

    assert book(athlete, other["id"], 0)["from_match"] is True


def test_two_bookings_made_at_the_same_moment_cannot_both_take_the_right(fin) -> None:
    import asyncpg

    from app.repositories import match_attribution

    coach, athlete, listing = setup(fin)
    matched(fin, athlete, coach)
    slots = athlete.ok("GET", f"/api/coach-listings/{listing}/slots", params={"from_date": MONDAY.isoformat(), "to_date": (MONDAY + timedelta(days=14)).isoformat()})
    # two plain bookings in the database, as if both were created before either was checked
    ids = []
    for slot in slots[:2]:
        ids.append(sql_value(
            fin.dsn,
            "INSERT INTO bookings (coach_user_id, listing_id, athlete_user_id, starts_at, duration_minutes, format, price_per_session, currency, status) "
            "VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text::timestamp, 60, 'online', 2500, 'RUB', 'pending') RETURNING id::text",
            coach.user_id, listing, athlete.user_id, slot["starts_at"].replace("Z", "").split("+")[0],
        ))

    async def go() -> list:
        conns = [await asyncpg.connect(fin.dsn) for _ in ids]
        try:
            rows = [dict(await c.fetchrow("SELECT id, coach_user_id, athlete_user_id, price_per_session, created_at, match_offer_id FROM bookings WHERE id = $1::uuid", i)) for c, i in zip(conns, ids)]
            return await asyncio.gather(*(match_attribution.claim(c, r) for c, r in zip(conns, rows)))
        finally:
            for c in conns:
                await c.close()

    results = asyncio.run(go())

    assert sum(r is not None for r in results) == 1
    assert sql_value(fin.dsn, "SELECT count(*) FROM bookings WHERE match_offer_id IS NOT NULL") == 1


def test_a_booking_that_missed_the_right_takes_it_when_its_payment_starts_after_the_holder_is_gone(fin) -> None:
    coach, athlete, listing = setup(fin)
    matched(fin, athlete, coach)
    first = book(athlete, listing, 0)
    sql(fin.dsn, "INSERT INTO bookings (coach_user_id, listing_id, athlete_user_id, starts_at, duration_minutes, format, price_per_session, currency, status) "
                 "SELECT coach_user_id, listing_id, athlete_user_id, starts_at + interval '7 days', duration_minutes, format, price_per_session, currency, 'pending' FROM bookings WHERE id = $1::uuid", first["id"])
    plain_id = sql_value(fin.dsn, "SELECT id::text FROM bookings WHERE match_offer_id IS NULL")
    coach.ok("POST", f"/api/bookings/{first['id']}/decline")
    coach.ok("POST", f"/api/bookings/{plain_id}/confirm")

    athlete.ok("POST", f"/api/bookings/{plain_id}/pay")

    assert sql_value(fin.dsn, "SELECT match_offer_id IS NOT NULL FROM bookings WHERE id = $1::uuid", plain_id) is True
    assert sql_value(fin.dsn, "SELECT commission_percent::float FROM payments WHERE booking_id = $1::uuid", plain_id) == 50


# --- payment in the app is mandatory --------------------------------------------------------------------------------------


def test_an_offer_cannot_be_made_while_online_payment_is_off_or_the_trainer_has_no_priced_listing(fin) -> None:
    coach, athlete, _ = setup(fin)
    request = new_request(athlete)
    reconfigure(fin, YOOKASSA_ENABLED="false")
    off = fin.admin.call("POST", f"{QUEUE}/{request['id']}/offers", json={"coach_user_id": coach.user_id})
    assert off.status_code == 409 and error_code(off) == "payments_unavailable"
    reconfigure(fin, YOOKASSA_ENABLED="true")

    sql(fin.dsn, "UPDATE coach_listings SET price_per_session = 0")
    assert fin.admin.ok("GET", f"{QUEUE}/{request['id']}/candidates") == []
    assert error_code(fin.admin.call("POST", f"{QUEUE}/{request['id']}/offers", json={"coach_user_id": coach.user_id})) == "not_eligible"


def test_the_trainer_cannot_confirm_a_matched_booking_when_payment_is_off_or_close_it_unpaid(fin) -> None:
    coach, athlete, listing = setup(fin)
    matched(fin, athlete, coach)
    first = book(athlete, listing, 0)
    reconfigure(fin, YOOKASSA_ENABLED="false")
    off = coach.call("POST", f"/api/bookings/{first['id']}/confirm")
    assert off.status_code == 409 and error_code(off) == "payments_unavailable"
    reconfigure(fin, YOOKASSA_ENABLED="true")

    coach.ok("POST", f"/api/bookings/{first['id']}/confirm")
    sql(fin.dsn, "UPDATE bookings SET starts_at = starts_at - interval '30 days' WHERE id = $1::uuid", first["id"])
    unpaid = coach.call("POST", f"/api/bookings/{first['id']}/complete")
    assert unpaid.status_code == 409 and error_code(unpaid) == "payment_required"


# --- the athlete stays anonymous until the first session is paid ----------------------------------------------------------


def test_the_trainer_sees_no_name_notes_or_profile_before_payment_and_everything_after(fin) -> None:
    coach, athlete, listing = setup(fin)
    matched(fin, athlete, coach)
    slots = athlete.ok("GET", f"/api/coach-listings/{listing}/slots", params={"from_date": MONDAY.isoformat(), "to_date": MONDAY.isoformat()})
    first = athlete.ok("POST", "/api/bookings", json={"listing_id": listing, "starts_at": slots[0]["starts_at"], "format": "online", "athlete_notes": CONTACTS})

    pending = coach.ok("GET", "/api/bookings/coach/pending")[0]
    assert pending["athlete_hidden"] is True and pending["athlete_full_name"] == "Спортсмен из подбора" and pending["from_match"] is True
    assert pending["match_percent"] == 50
    assert "999" not in (pending["athlete_notes"] or "") and "ivan@mail.ru" not in (pending["athlete_notes"] or "") and "[контакт скрыт]" in pending["athlete_notes"]
    note = next(n for n in coach.ok("GET", "/api/notifications") if n["category"] == "booking_requested")
    assert "Анна" not in note["body"] and "Спортсмен из подбора" in note["body"]
    assert coach.call("GET", f"/api/players/{athlete.user_id}/profile").status_code == 403
    assert coach.call("GET", f"/api/players/{athlete.user_id}/reviews").status_code == 403

    coach.ok("POST", f"/api/bookings/{first['id']}/confirm")
    listed = next(b for b in coach.ok("GET", "/api/bookings/coach") if b["id"] == first["id"])
    assert listed["athlete_hidden"] is True and listed["athlete_full_name"] == "Спортсмен из подбора" and "999" not in (listed["athlete_notes"] or "")
    assert coach.call("GET", f"/api/chats/for-booking/{first['id']}").status_code == 409  # the chat opens with the payment

    pay(fin, athlete, first)

    opened = next(b for b in coach.ok("GET", "/api/bookings/coach") if b["id"] == first["id"])
    assert opened["athlete_hidden"] is False and opened["athlete_full_name"] == "Анна" and "999" in opened["athlete_notes"]
    assert coach.ok("GET", f"/api/players/{athlete.user_id}/profile")
    assert coach.ok("GET", f"/api/chats/for-booking/{first['id']}")["title"] == "Анна"


def test_the_calendar_and_the_cancellation_notice_do_not_name_an_unpaid_client(fin) -> None:
    coach, athlete, listing = setup(fin)
    matched(fin, athlete, coach)
    first = book(athlete, listing, 0)
    coach.ok("POST", f"/api/bookings/{first['id']}/confirm")
    day = sql_value(fin.dsn, "SELECT starts_at::date::text FROM bookings WHERE id = $1::uuid", first["id"])

    titles = [e["title"] for e in coach.ok("GET", "/api/calendar", params={"date_from": day, "date_to": day})]
    assert titles == ["Сессия с Спортсмен из подбора"]

    athlete.ok("POST", f"/api/bookings/{first['id']}/cancel", json={"reason": None})
    cancelled = next(n for n in coach.ok("GET", "/api/notifications") if n["title"] == "Тренировка отменена")
    assert "Анна" not in cancelled["body"] and "Спортсмен из подбора" in cancelled["body"]


def test_ordinary_bookings_show_the_athlete_as_before(fin) -> None:
    coach, athlete, listing = setup(fin)

    booking = book(athlete, listing, 0)

    pending = coach.ok("GET", "/api/bookings/coach/pending")[0]
    assert booking["from_match"] is False and pending["athlete_hidden"] is False and pending["from_match"] is False and pending["athlete_full_name"] == "Анна"
    assert coach.ok("GET", f"/api/players/{athlete.user_id}/profile")


def test_deleting_the_athletes_requests_does_not_fail_because_of_a_matched_booking(fin) -> None:
    coach, athlete, listing = setup(fin)
    matched(fin, athlete, coach)
    first = book(athlete, listing, 0)

    sql(fin.dsn, "DELETE FROM coach_match_requests")

    assert sql_value(fin.dsn, "SELECT match_offer_id FROM bookings WHERE id = $1::uuid", first["id"]) is None


def test_the_trainers_terms_show_the_percent_in_force_and_the_window(fin) -> None:
    coach = make_coach(fin.world)
    fin.admin.ok("PUT", GENERAL, json={"percent": "35", "reason": "Новый тариф"})

    settings = coach.ok("GET", "/api/match-offers/settings")

    text = " ".join(settings["terms"])
    assert settings["first_session_percent"] == 35 and "35%" in text and "30 дн." in text and "50%" not in text
