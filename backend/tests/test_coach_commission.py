"""A finance administrator can give one trainer a personal commission, against a real PostgreSQL: it applies to the payments that trainer's
bookings get from then on, everybody else keeps the general commission, the payments already created keep their percent, a change needs the
second factor entered a moment ago and is audited."""
from __future__ import annotations

from tests.admin_world import live_client, pg, world  # noqa: F401  (fixtures)
from tests.finance_helpers import confirmed_booking, webhook
from tests.live_helpers import sql, sql_value
from tests.test_finance import ADMIN_EMAIL, fin, paid_booking, reconfigure  # noqa: F401  (fixtures and helpers)

LIST = "/api/admin/finance/coach-commissions"
GENERAL = "/api/admin/finance/commission"


def coach_id(fin, n: int) -> str:
    return sql_value(fin.dsn, "SELECT id::text FROM users WHERE email = $1", f"coach{n}@example.com")


def put(fin, coach: str, percent, reason: str = "Договорённость с тренером"):
    return fin.admin.call("PUT", f"{LIST}/{coach}", json={"percent": percent, "reason": reason})


def payment_percent(fin, booking) -> str:
    return sql_value(fin.dsn, "SELECT commission_percent::text FROM payments WHERE booking_id = $1::uuid", booking["id"])


def pay(fin, coach, player, booking) -> None:
    coach.ok("POST", f"/api/bookings/{booking['id']}/confirm")
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    pid = next(p for p in fin.provider.payments if fin.provider.payments[p]["metadata"]["booking_id"] == booking["id"])
    fin.provider.finish(pid, "succeeded")
    assert webhook(fin.world, pid).status_code == 200


def pending_booking(fin, n: int):
    """A trainer who exists and has a booking waiting for his confirmation (nothing paid yet): (coach, player, booking, his user id)."""
    coach, player, booking = confirmed_booking(fin.world, coach_email=f"coach{n}@example.com", player_email=f"player{n}@example.com", title=f"Спорт {n}")
    return coach, player, booking, coach_id(fin, n)


def test_everybody_pays_the_general_commission_until_a_personal_one_is_set(fin) -> None:
    pending_booking(fin, 0)
    page = fin.admin.ok("GET", LIST)
    assert page["general_percent"] == "10" and page["max_percent"] == "50"
    row = next(i for i in page["items"] if i["email"] == "coach0@example.com")
    assert row["personal_percent"] is None and row["percent"] == "10" and row["since"] is None


def test_a_personal_percent_applies_to_that_trainers_new_payments_only(fin) -> None:
    coach, player, booking, cid = pending_booking(fin, 0)
    _, _, other_booking, _ = paid_booking(fin, 1)

    view = put(fin, cid, "15").json()
    assert view["personal_percent"] == "15" and view["percent"] == "15" and view["set_by_email"] == ADMIN_EMAIL
    assert coach.ok("GET", "/api/finance/summary")["commission_percent"] == "15"  # what the trainer is shown follows

    pay(fin, coach, player, booking)
    assert payment_percent(fin, booking).startswith("15")
    gross, fee, trainer = sql(fin.dsn, "SELECT gross_kopecks, platform_fee_kopecks, trainer_kopecks FROM payments WHERE booking_id = $1::uuid", booking["id"])[0].values()
    assert fee * 100 == gross * 15 and fee + trainer == gross
    assert payment_percent(fin, other_booking).startswith("10")  # another trainer: the general commission, and his payment was made before


def test_a_trainer_without_a_personal_percent_follows_the_general_one(fin) -> None:
    _, _, _, cid = pending_booking(fin, 0)
    coach1, player1, booking1, _ = pending_booking(fin, 1)
    assert put(fin, cid, "5").status_code == 200

    fin.admin.ok("PUT", GENERAL, json={"percent": "12", "reason": "Новый тариф"})
    assert coach1.ok("GET", "/api/finance/summary")["commission_percent"] == "12"
    pay(fin, coach1, player1, booking1)
    assert payment_percent(fin, booking1).startswith("12")
    rows = {i["email"]: i for i in fin.admin.ok("GET", LIST)["items"]}
    assert rows["coach0@example.com"]["percent"] == "5" and rows["coach1@example.com"]["percent"] == "12"  # the personal one does not move with the general


def test_a_payment_already_created_keeps_its_percent(fin) -> None:
    coach, player, booking = confirmed_booking(fin.world, coach_email="coach0@example.com", player_email="player0@example.com", title="Спорт 0", confirm=True)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    assert payment_percent(fin, booking).startswith("10")
    assert put(fin, coach_id(fin, 0), "30").status_code == 200
    assert payment_percent(fin, booking).startswith("10")


def test_handing_the_trainer_back_to_the_general_commission(fin) -> None:
    coach, _, _, cid = pending_booking(fin, 0)
    put(fin, cid, "20")
    back = put(fin, cid, None, "Акция закончилась").json()
    assert back["personal_percent"] is None and back["percent"] == "10" and back["since"] is None
    assert coach.ok("GET", "/api/finance/summary")["commission_percent"] == "10"
    assert put(fin, cid, None).json()["error"]["code"] == "coach_commission_unchanged"
    assert [(r["previous"], r["percent"]) for r in sql(fin.dsn, "SELECT previous::text, percent::text FROM coach_commission_changes ORDER BY id")] == [("10.00", "20.00"), ("20.00", None)]


def test_zero_and_the_ceiling_are_allowed_and_the_same_percent_is_refused(fin) -> None:
    _, _, _, cid = pending_booking(fin, 0)
    assert put(fin, cid, "0").json()["personal_percent"] == "0"  # a free trainer is not «no personal percent»
    assert put(fin, cid, "0").json()["error"]["code"] == "coach_commission_unchanged"
    assert put(fin, cid, "50").json()["personal_percent"] == "50"
    assert put(fin, cid, "10").json()["personal_percent"] == "10"  # equal to the general one, yet personal: it stays when the general one moves
    fin.admin.ok("PUT", GENERAL, json={"percent": "20", "reason": "Новый тариф"})
    assert next(i for i in fin.admin.ok("GET", LIST)["items"] if i["email"] == "coach0@example.com")["percent"] == "10"


def test_the_percent_is_bounded_a_reason_is_required_and_only_trainers_are_found(fin) -> None:
    _, _, _, cid = pending_booking(fin, 0)
    url = f"{LIST}/{cid}"
    for body in ({"percent": "50.01", "reason": "x"}, {"percent": "-1", "reason": "x"}, {"percent": "10.123", "reason": "x"}, {"percent": "abc", "reason": "x"},
                 {"percent": "12", "reason": ""}, {"percent": "12"}, {"reason": "без процента"}):
        assert fin.admin.call("PUT", url, json=body).status_code == 422, body
    player_id = sql_value(fin.dsn, "SELECT id::text FROM users WHERE email = 'player0@example.com'")
    assert put(fin, player_id, "5").status_code == 404  # a player has no trainer profile
    assert put(fin, "00000000-0000-4000-8000-000000000000", "5").status_code == 404
    assert sql_value(fin.dsn, "SELECT count(*) FROM coach_commission_changes") == 0


def test_a_change_is_audited_with_its_reason_and_both_values(fin) -> None:
    _, _, _, cid = pending_booking(fin, 0)
    put(fin, cid, "7.5", "Договорились на 7,5")
    row = sql(fin.dsn, "SELECT result, reason, target_id, details::text AS d FROM admin_audit_log WHERE action = 'finance.coach_commission.change'")
    assert len(row) == 1 and row[0]["result"] == "success" and row[0]["reason"] == "Договорились на 7,5" and row[0]["target_id"] == cid
    assert '"10"' in row[0]["d"] and '"7.5"' in row[0]["d"]


def test_only_a_finance_administrator_with_a_fresh_second_factor_can_change_it(fin) -> None:
    coach, player, _, cid = pending_booking(fin, 0)
    assert coach.call("PUT", f"{LIST}/{cid}", json={"percent": "1", "reason": "сам себе"}).status_code == 403
    assert player.call("GET", LIST).status_code == 403
    reconfigure(fin, FINANCE_ADMIN_EMAILS="somebody.else@example.com")
    assert put(fin, cid, "1").json()["error"]["code"] == "finance_access_required"
    assert fin.admin.call("GET", LIST).json()["error"]["code"] == "finance_access_required"
    reconfigure(fin, FINANCE_ADMIN_EMAILS=ADMIN_EMAIL)
    sql(fin.dsn, "UPDATE user_sessions SET mfa_verified_at = now() - interval '30 minutes' WHERE user_id = $1::uuid", fin.world.admin.user_id)
    assert put(fin, cid, "1").json()["error"]["code"] == "mfa_recent_required"
    assert sql_value(fin.dsn, "SELECT count(*) FROM coach_commission_changes") == 0


def test_trainers_are_found_by_name_or_email_and_the_personal_ones_come_first(fin) -> None:
    for n in (0, 1, 2):
        pending_booking(fin, n)
    put(fin, coach_id(fin, 2), "8")
    page = fin.admin.ok("GET", LIST)
    assert [i["email"] for i in page["items"]][0] == "coach2@example.com" and page["total"] == 3
    only = fin.admin.ok("GET", LIST, params={"only_personal": "true"})
    assert [i["email"] for i in only["items"]] == ["coach2@example.com"] and only["total"] == 1
    found = fin.admin.ok("GET", LIST, params={"q": "coach1@"})
    assert [i["email"] for i in found["items"]] == ["coach1@example.com"]
    assert fin.admin.ok("GET", LIST, params={"q": "player0@"})["items"] == []  # a player is not a trainer
    assert fin.admin.ok("GET", LIST, params={"q": "100%"})["items"] == []  # the % is not a wildcard
