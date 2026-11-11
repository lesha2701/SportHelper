"""The commission is set by a finance administrator (card #38) against a real PostgreSQL: it applies to the payments created after the change,
the payments already created keep their percent, the change needs the second factor entered a moment ago and is audited."""
from __future__ import annotations

from tests.admin_world import live_client, pg, world  # noqa: F401  (fixtures)
from tests.live_helpers import sql, sql_value
from tests.test_finance import ADMIN_EMAIL, fin, paid_booking, reconfigure  # noqa: F401  (fixtures and helpers)

URL = "/api/admin/finance/commission"


def _expire_recent_code(fin, minutes: int = 30) -> None:
    sql(fin.dsn, "UPDATE user_sessions SET mfa_verified_at = now() - make_interval(mins => $2) WHERE user_id = $1::uuid", fin.world.admin.user_id, minutes)


def _payment_percent(fin, booking) -> str:
    return sql_value(fin.dsn, "SELECT commission_percent::text FROM payments WHERE booking_id = $1::uuid", booking["id"])


def test_until_someone_changes_it_the_environment_value_applies(fin) -> None:
    view = fin.admin.ok("GET", URL)
    assert view["percent"] == "10" and view["source"] == "environment" and view["history"] == [] and view["applies_to"] == "new_payments"
    assert fin.admin.ok("GET", "/api/admin/finance/overview")["commission_percent"] == "10"


def test_a_change_applies_to_new_payments_and_leaves_the_existing_ones_alone(fin) -> None:
    coach, player, old_booking, _ = paid_booking(fin, 0)
    old_fee = sql_value(fin.dsn, "SELECT platform_fee_kopecks FROM payments WHERE booking_id = $1::uuid", old_booking["id"])

    changed = fin.admin.ok("PUT", URL, json={"percent": "15", "reason": "Новый тариф с 1 декабря"})
    assert changed["percent"] == "15" and changed["source"] == "admin" and changed["history"][0]["previous"] == "10"
    assert fin.admin.ok("GET", "/api/admin/finance/overview")["commission_percent"] == "15"
    assert coach.ok("GET", "/api/finance/summary")["commission_percent"] == "15"  # what the trainer is shown follows

    _, _, new_booking, _ = paid_booking(fin, 1)
    assert _payment_percent(fin, new_booking).startswith("15")
    assert _payment_percent(fin, old_booking).startswith("10")  # frozen when it was created
    assert sql_value(fin.dsn, "SELECT platform_fee_kopecks FROM payments WHERE booking_id = $1::uuid", old_booking["id"]) == old_fee
    new_gross, new_fee, new_trainer = sql(fin.dsn, "SELECT gross_kopecks, platform_fee_kopecks, trainer_kopecks FROM payments WHERE booking_id = $1::uuid", new_booking["id"])[0].values()
    assert new_fee * 100 == new_gross * 15 and new_fee + new_trainer == new_gross


def test_a_change_is_audited_with_its_reason_and_both_values(fin) -> None:
    fin.admin.ok("PUT", URL, json={"percent": "7.5", "reason": "Акция для новых тренеров"})
    row = sql(fin.dsn, "SELECT result, reason, details::text AS d FROM admin_audit_log WHERE action = 'finance.commission.change'")
    assert len(row) == 1 and row[0]["result"] == "success" and row[0]["reason"] == "Акция для новых тренеров"
    assert '"10"' in row[0]["d"] and '"7.5"' in row[0]["d"]
    assert fin.admin.ok("GET", URL)["percent"] == "7.5"  # shown without trailing zeros


def test_only_a_finance_administrator_with_a_fresh_second_factor_can_change_it(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    body = {"percent": "20", "reason": "Проверка"}
    assert coach.call("PUT", URL, json=body).status_code == 403 and player.call("GET", URL).status_code == 403
    reconfigure(fin, FINANCE_ADMIN_EMAILS="somebody.else@example.com")
    assert fin.admin.call("PUT", URL, json=body).json()["error"]["code"] == "finance_access_required"
    reconfigure(fin, FINANCE_ADMIN_EMAILS=ADMIN_EMAIL)

    _expire_recent_code(fin)
    stale = fin.admin.call("PUT", URL, json=body)
    assert stale.status_code == 403 and stale.json()["error"]["code"] == "mfa_recent_required"
    assert sql_value(fin.dsn, "SELECT count(*) FROM commission_changes") == 0


def test_the_percent_is_bounded_and_a_reason_is_required(fin) -> None:
    for body in ({"percent": "50.01", "reason": "x"}, {"percent": "-1", "reason": "x"}, {"percent": "10.123", "reason": "x"},
                 {"percent": "abc", "reason": "x"}, {"percent": "12", "reason": ""}, {"percent": "12"}):
        assert fin.admin.call("PUT", URL, json=body).status_code == 422, body
    assert fin.admin.call("PUT", URL, json={"percent": "10", "reason": "то же самое"}).json()["error"]["code"] == "commission_unchanged"
    assert fin.admin.ok("PUT", URL, json={"percent": "0", "reason": "Бесплатный период"})["percent"] == "0"  # zero and the ceiling are allowed
    assert fin.admin.ok("PUT", URL, json={"percent": "50", "reason": "Потолок"})["percent"] == "50"
    assert sql_value(fin.dsn, "SELECT count(*) FROM commission_changes") == 2


def test_the_history_keeps_every_change_newest_first(fin) -> None:
    for percent in ("12", "14", "9.5"):
        fin.admin.ok("PUT", URL, json={"percent": percent, "reason": f"на {percent}"})
    history = fin.admin.ok("GET", URL)["history"]
    assert [(h["previous"], h["percent"]) for h in history] == [("14", "9.5"), ("12", "14"), ("10", "12")]
    assert history[0]["changed_by_email"] == ADMIN_EMAIL
