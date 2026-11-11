"""The settlement account's balance entered by a finance administrator (card #37) against a real PostgreSQL: the trainers' part is exact
(by the books at the moment of the entry), everything else on the account is the platform's, and entries are append-only and audited."""
from __future__ import annotations

from tests.admin_world import live_client, pg, world  # noqa: F401  (fixtures)
from tests.live_helpers import sql, sql_value
from tests.test_finance import ADMIN_EMAIL, ask_withdrawal, available_money, fin, paid_booking, reconfigure  # noqa: F401  (fixtures and helpers)

URL = "/api/admin/finance/bank-balance"


def _trainer_share(fin, booking) -> int:
    return sql_value(fin.dsn, "SELECT trainer_kopecks FROM payments WHERE booking_id = $1::uuid", booking["id"])


def _gross(fin, booking) -> int:
    return sql_value(fin.dsn, "SELECT gross_kopecks FROM payments WHERE booking_id = $1::uuid", booking["id"])


def test_nothing_is_known_until_the_balance_is_entered(fin) -> None:
    view = fin.admin.ok("GET", URL)
    assert view == {"latest": None, "trainers_now_kopecks": 0, "history": []}


def test_the_trainers_part_is_exact_and_the_rest_of_the_account_is_ours(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    gross, trainer = _gross(fin, booking), _trainer_share(fin, booking)
    assert fin.admin.ok("GET", URL)["trainers_now_kopecks"] == trainer  # 100 - commission, to the kopeck (the trainer's share is untouched by fees)

    # the bank shows the whole payment minus a fee that ЮKassa took (the fee is the platform's loss, never the trainer's)
    yookassa_fee = 3_500
    view = fin.admin.ok("POST", URL, json={"balance_kopecks": gross - yookassa_fee, "note": "  выписка за 11 ноября  "})
    latest = view["latest"]
    assert latest["balance_kopecks"] == gross - yookassa_fee and latest["trainers_kopecks"] == trainer
    assert latest["ours_kopecks"] == gross - yookassa_fee - trainer and latest["note"] == "выписка за 11 ноября"
    assert latest["entered_by_email"] == ADMIN_EMAIL


def test_money_in_a_withdrawal_request_is_still_the_trainers_money_on_the_account(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    available_money(fin, coach.user_id, 400_000)
    before = fin.admin.ok("GET", URL)["trainers_now_kopecks"]
    assert ask_withdrawal(coach, 150_000).status_code == 201
    assert fin.admin.ok("GET", URL)["trainers_now_kopecks"] == before  # moved from «available» to «in requests», still on the account


def test_an_entry_keeps_what_the_books_said_then_and_a_newer_one_replaces_it(fin) -> None:
    coach, player, booking, _ = paid_booking(fin, 0)
    first = fin.admin.ok("POST", URL, json={"balance_kopecks": 500_000})["latest"]
    paid_booking(fin, 1)  # more trainers' money arrives afterwards
    view = fin.admin.ok("GET", URL)
    assert view["latest"]["trainers_kopecks"] == first["trainers_kopecks"]            # the old entry is not rewritten
    assert view["trainers_now_kopecks"] > first["trainers_kopecks"]                   # the live figure moved on
    second = fin.admin.ok("POST", URL, json={"balance_kopecks": 900_000})
    assert second["latest"]["id"] > first["id"] and second["latest"]["trainers_kopecks"] == second["trainers_now_kopecks"]
    assert [h["balance_kopecks"] for h in second["history"]] == [900_000, 500_000]


def test_the_account_can_hold_less_than_the_trainers_are_owed_and_it_is_shown_as_negative_ours(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    trainer = _trainer_share(fin, booking)
    latest = fin.admin.ok("POST", URL, json={"balance_kopecks": trainer - 1_000})["latest"]
    assert latest["ours_kopecks"] == -1_000  # a hole in the account: the administrator must see it, not a rounded zero


def test_only_a_finance_administrator_enters_it_and_the_entry_is_audited(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    assert coach.call("POST", URL, json={"balance_kopecks": 1}).status_code == 403 and player.call("GET", URL).status_code == 403
    reconfigure(fin, FINANCE_ADMIN_EMAILS="somebody.else@example.com")
    assert fin.admin.call("POST", URL, json={"balance_kopecks": 1}).json()["error"]["code"] == "finance_access_required"
    reconfigure(fin, FINANCE_ADMIN_EMAILS=ADMIN_EMAIL)
    assert sql_value(fin.dsn, "SELECT count(*) FROM bank_balance_snapshots") == 0

    fin.admin.ok("POST", URL, json={"balance_kopecks": 123_456})
    audit = sql(fin.dsn, "SELECT result, details::text AS d FROM admin_audit_log WHERE action = 'finance.bank_balance.entered'")
    assert len(audit) == 1 and audit[0]["result"] == "success" and "123456" in audit[0]["d"]


def test_a_balance_must_be_a_whole_non_negative_number_of_kopecks(fin) -> None:
    for body in ({"balance_kopecks": -1}, {"balance_kopecks": 10.5}, {"balance_kopecks": "abc"}, {}, {"balance_kopecks": 1, "note": "x" * 501}):
        assert fin.admin.call("POST", URL, json=body).status_code == 422, body
    assert fin.admin.ok("POST", URL, json={"balance_kopecks": 0})["latest"]["balance_kopecks"] == 0  # an empty account is a valid balance
    assert sql_value(fin.dsn, "SELECT count(*) FROM bank_balance_snapshots") == 1
