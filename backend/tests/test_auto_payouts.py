"""Automatic payouts against a real PostgreSQL and a pretend bank (docs/payouts-automation.md). No real money anywhere."""
from __future__ import annotations

import asyncpg
import pytest

from app.config import get_settings, production_problems
from app.integrations.payouts import FakeBank
from app.services import auto_payouts
from tests.admin_world import ADMIN_EMAIL, live_client, pg, set_admins, world  # noqa: F401  (fixtures)
from tests.finance_helpers import assert_books_are_sound, ledger_totals, run, trainer_balances, with_conn
from tests.live_helpers import sql, sql_value
from tests.test_finance import PASSWORD, SBP, ask_withdrawal, available_money, fin, paid_booking, reconfigure  # noqa: F401  (fixtures)

OTHER_PHONE = {"phone": "+7 903 111-22-33", "bank": "Тинькофф", "recipient": "Иванов Иван Иванович"}


@pytest.fixture
def bank(monkeypatch) -> FakeBank:
    pretend = FakeBank()
    monkeypatch.setattr("app.integrations.payouts._fake_bank", pretend)
    return pretend


def tick(fin) -> dict:
    return run(with_conn(fin.dsn, lambda conn: auto_payouts.process_due(conn, get_settings())))


def reconcile_now(fin) -> list[str]:
    async def go(conn):
        from app.integrations.payouts import get_provider

        return await auto_payouts.reconcile(conn, get_settings(), get_provider(get_settings()), force=True)

    return run(with_conn(fin.dsn, go))


def automation(fin, **env: str) -> None:
    base = {"PAYOUT_PROVIDER": "fake", "PAYOUTS_AUTO_ENABLED": "true", "PAYOUT_AUTO_DELAY_MINUTES": "0", "PAYOUT_AUTO_MAX_RUB": "5000",
            "PAYOUT_AUTO_DAILY_TRAINER_RUB": "15000", "PAYOUT_AUTO_DAILY_TOTAL_RUB": "300000", "PAYOUT_NEW_DETAILS_COOLDOWN_HOURS": "72"}
    base.update(env)
    reconfigure(fin, **base)


def status_of(fin, wid: str) -> str:
    return sql_value(fin.dsn, "SELECT status FROM withdrawal_requests WHERE id = $1::uuid", wid)


def attention_of(fin, wid: str) -> str | None:
    return sql_value(fin.dsn, "SELECT attention FROM withdrawal_requests WHERE id = $1::uuid", wid)


def trusted_trainer(fin, n: int = 0, money: int = 1_000_000):
    """A trainer who has already been paid once, by a person, to these requisites - so the system may pay him on its own."""
    coach, player, booking, _ = paid_booking(fin, n)
    sql(fin.dsn, "UPDATE users SET first_name = 'Иван', last_name = 'Иванов', password_changed_at = now() - interval '30 days' WHERE id = $1::uuid", coach.user_id)
    available_money(fin, coach.user_id, money)
    wid = ask_withdrawal(coach, 150_000).json()["id"]
    for step in ("review", "approve", "processing"):
        fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{wid}/{step}", json={})
    fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{wid}/paid", json={"bank_reference": f"MANUAL-{n}-0001", "paid_amount_kopecks": 150_000})
    return coach


def test_the_first_payout_is_manual_and_then_trusted_requisites_are_paid_by_the_system(fin, bank) -> None:
    coach, player, booking, _ = paid_booking(fin)
    sql(fin.dsn, "UPDATE users SET first_name = 'Иван', last_name = 'Иванов', password_changed_at = now() - interval '30 days' WHERE id = $1::uuid", coach.user_id)
    available_money(fin, coach.user_id, 1_000_000)
    automation(fin)

    first = ask_withdrawal(coach, 200_000).json()["id"]
    assert tick(fin)["manual"] == 1 and status_of(fin, first) == "requested" and "первая выплата" in attention_of(fin, first)
    assert bank.sent_orders == []
    fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{first}/review", json={})
    for step in ("approve", "processing"):
        fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{first}/{step}", json={})
    fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{first}/paid", json={"bank_reference": "MANUAL-0001", "paid_amount_kopecks": 200_000})

    second = ask_withdrawal(coach, 250_000).json()["id"]
    assert tick(fin)["paid"] == 1
    assert status_of(fin, second) == "paid"
    [order] = bank.sent_orders
    assert (order.amount_kopecks, order.idempotency_key, order.details["recipient"]) == (250_000, f"withdrawal:{second}", SBP["recipient"])
    row = sql(fin.dsn, "SELECT automated, paid_by, bank_reference, paid_amount_kopecks FROM withdrawal_requests WHERE id = $1::uuid", second)[0]
    assert (row["automated"], row["paid_by"], row["paid_amount_kopecks"]) == (True, None, 250_000) and row["bank_reference"].startswith("FAKE-")
    assert sql_value(fin.dsn, "SELECT status FROM payout_attempts WHERE withdrawal_id = $1::uuid", second) == "succeeded"
    balances = trainer_balances(fin.dsn, coach.user_id)
    assert (balances["trainer_reserved"], balances["trainer_available"]) == (0, 1_000_000 - 200_000 - 250_000)
    assert ledger_totals(fin.dsn)["payouts_external"] == 450_000
    events = [(e["from_status"], e["to_status"], e["actor_user_id"]) for e in sql(fin.dsn, "SELECT from_status, to_status, actor_user_id FROM withdrawal_events WHERE withdrawal_id = $1::uuid ORDER BY id", second)]
    assert [(f, t) for f, t, _ in events] == [(None, "requested"), ("requested", "under_review"), ("under_review", "approved"), ("approved", "processing"), ("processing", "paid")]
    assert [a for _, _, a in events[1:]] == [None] * 4  # the steps made by the system carry no person
    assert sql_value(fin.dsn, "SELECT count(*) FROM notifications WHERE category = 'withdrawal_update' AND title = 'Выплата проведена'") == 2
    assert tick(fin)["paid"] == 0 and len(bank.sent_orders) == 1  # nothing is sent twice
    assert_books_are_sound(fin.dsn)


def test_the_trainer_has_time_to_cancel_before_the_system_touches_the_request(fin, bank) -> None:
    coach = trusted_trainer(fin)
    automation(fin, PAYOUT_AUTO_DELAY_MINUTES="10")
    wid = ask_withdrawal(coach, 200_000).json()["id"]
    assert tick(fin)["paid"] == 0 and status_of(fin, wid) == "requested"
    coach.ok("POST", f"/api/finance/withdrawals/{wid}/cancel", json={})
    sql(fin.dsn, "UPDATE withdrawal_requests SET created_at = now() - interval '1 hour' WHERE id = $1::uuid", wid)
    tick(fin)
    assert status_of(fin, wid) == "canceled" and bank.sent_orders == []


def test_everything_stays_off_by_default(fin, bank) -> None:
    coach = trusted_trainer(fin)
    wid = ask_withdrawal(coach, 200_000).json()["id"]
    assert tick(fin) == {k: 0 for k in tick(fin)} and status_of(fin, wid) == "requested" and bank.sent_orders == []
    automation(fin, PAYOUT_PROVIDER="manual")
    tick(fin)
    assert status_of(fin, wid) == "requested" and bank.sent_orders == []


@pytest.mark.parametrize("env, amount, details, expect", [
    ({}, 600_000, SBP, "выше лимита"),
    ({"PAYOUT_AUTO_DAILY_TRAINER_RUB": "2500"}, 200_000, SBP, None),                    # first one fits the day...
    ({}, 200_000, OTHER_PHONE, "новые реквизиты"),
    ({}, 200_000, {**SBP, "recipient": "Петров Пётр Петрович"}, "не совпадает"),
])
def test_a_request_that_breaks_a_rule_is_left_for_a_person(fin, bank, env, amount, details, expect) -> None:
    coach = trusted_trainer(fin)
    automation(fin, **env)
    wid = ask_withdrawal(coach, amount, details=details).json()["id"]
    tick(fin)
    if expect is None:
        assert status_of(fin, wid) == "paid"
        again = ask_withdrawal(coach, 200_000).json()["id"]  # ...the second one does not
        tick(fin)
        assert status_of(fin, again) == "requested" and "суточный лимит" in attention_of(fin, again)
        assert len(bank.sent_orders) == 1
    else:
        assert status_of(fin, wid) == "requested" and expect in attention_of(fin, wid)
        assert bank.sent_orders == []
    assert_books_are_sound(fin.dsn)


def test_the_platform_wide_daily_limit_and_a_recent_password_change(fin, bank) -> None:
    coach = trusted_trainer(fin)
    automation(fin, PAYOUT_AUTO_DAILY_TOTAL_RUB="2500")
    first, second = ask_withdrawal(coach, 200_000).json()["id"], ask_withdrawal(coach, 200_000).json()["id"]
    tick(fin)
    assert (status_of(fin, first), status_of(fin, second)) == ("paid", "requested") and "по платформе" in attention_of(fin, second)

    automation(fin)
    sql(fin.dsn, "UPDATE users SET password_changed_at = now() WHERE id = $1::uuid", coach.user_id)
    tick(fin)
    assert status_of(fin, second) == "requested" and "пароль" in attention_of(fin, second)


def test_requisites_used_by_two_trainers_are_never_paid_automatically(fin, bank) -> None:
    first = trusted_trainer(fin, 0)
    second, _, _, _ = paid_booking(fin, 1)
    sql(fin.dsn, "UPDATE users SET first_name = 'Иван', last_name = 'Иванов', password_changed_at = now() - interval '30 days' WHERE id = $1::uuid", second.user_id)
    available_money(fin, second.user_id, 500_000)
    automation(fin)
    wid = ask_withdrawal(second, 200_000).json()["id"]
    tick(fin)
    assert status_of(fin, wid) == "requested" and "другой тренер" in attention_of(fin, wid)
    assert bank.sent_orders == [] and first


def test_a_trainer_with_a_debt_or_a_banned_account_is_left_for_a_person(fin, bank) -> None:
    coach = trusted_trainer(fin)
    automation(fin)
    wid = ask_withdrawal(coach, 200_000).json()["id"]
    sql(fin.dsn, "UPDATE users SET is_banned = true WHERE id = $1::uuid", coach.user_id)
    tick(fin)
    assert status_of(fin, wid) == "requested" and "заблокирован" in attention_of(fin, wid) and bank.sent_orders == []


def test_a_bank_that_does_not_answer_halts_automation_and_nothing_is_sent_twice(fin, bank) -> None:
    coach = trusted_trainer(fin)
    automation(fin)
    bank.next_outcome = "unreachable"
    wid = ask_withdrawal(coach, 200_000).json()["id"]
    assert tick(fin)["unknown"] == 1
    assert status_of(fin, wid) == "processing" and sql_value(fin.dsn, "SELECT status FROM payout_attempts") == "unknown"
    assert trainer_balances(fin.dsn, coach.user_id)["trainer_reserved"] == 200_000  # the money is NOT returned on its own
    assert sql_value(fin.dsn, "SELECT halted FROM payout_automation_state")
    assert sql_value(fin.dsn, "SELECT count(*) FROM notifications WHERE title = 'Автоматические выплаты остановлены'") == 1

    later = ask_withdrawal(coach, 200_000).json()["id"]
    assert tick(fin)["halted"] == 1 and status_of(fin, later) == "requested"  # halted: nothing new is started
    assert len(bank.sent_orders) == 1 and sql_value(fin.dsn, "SELECT status FROM payout_attempts WHERE withdrawal_id = $1::uuid", wid) == "unknown"


def test_an_unanswered_transfer_that_the_bank_did_make_is_found_by_its_key_not_repeated(fin, bank) -> None:
    coach = trusted_trainer(fin)
    automation(fin)
    bank.next_outcome = "unreachable_but_done"
    wid = ask_withdrawal(coach, 200_000).json()["id"]
    tick(fin)
    assert status_of(fin, wid) == "processing"
    assert tick(fin)["resolved"] == 1  # works even while halted: it only finishes what is already moving
    assert status_of(fin, wid) == "paid" and len(bank.sent_orders) == 1
    assert trainer_balances(fin.dsn, coach.user_id)["trainer_reserved"] == 0
    assert_books_are_sound(fin.dsn)


def test_a_refusal_by_the_bank_returns_the_money(fin, bank) -> None:
    coach = trusted_trainer(fin)
    automation(fin)
    before = trainer_balances(fin.dsn, coach.user_id)["trainer_available"]
    bank.next_outcome = "failed"
    wid = ask_withdrawal(coach, 200_000).json()["id"]
    assert tick(fin)["rejected"] == 1
    assert status_of(fin, wid) == "rejected" and sql_value(fin.dsn, "SELECT status FROM payout_attempts") == "failed"
    balances = trainer_balances(fin.dsn, coach.user_id)
    assert (balances["trainer_reserved"], balances["trainer_available"]) == (0, before)
    assert not sql_value(fin.dsn, "SELECT halted FROM payout_automation_state")  # one refusal is an ordinary event
    assert sql_value(fin.dsn, "SELECT count(*) FROM notifications WHERE title = 'Заявка на вывод отклонена'") == 1
    assert ledger_totals(fin.dsn)["payouts_external"] == 150_000
    assert_books_are_sound(fin.dsn)


def test_three_refusals_in_an_hour_halt_automation(fin, bank) -> None:
    coach = trusted_trainer(fin)
    automation(fin)
    for _ in range(3):
        bank.next_outcome = "failed"
        ask_withdrawal(coach, 200_000)
        tick(fin)
    assert sql_value(fin.dsn, "SELECT halted FROM payout_automation_state")


def test_a_bank_that_reports_another_amount_stops_everything_and_pays_nothing(fin, bank) -> None:
    coach = trusted_trainer(fin)
    automation(fin)
    bank.amount_delta = 1
    wid = ask_withdrawal(coach, 200_000).json()["id"]
    assert tick(fin)["mismatch"] == 1
    assert status_of(fin, wid) == "processing" and sql_value(fin.dsn, "SELECT halted FROM payout_automation_state")
    assert ledger_totals(fin.dsn)["payouts_external"] == 150_000  # only the manual one is booked
    assert trainer_balances(fin.dsn, coach.user_id)["trainer_reserved"] == 200_000


def test_a_transfer_that_is_still_pending_is_followed_until_it_ends(fin, bank) -> None:
    coach = trusted_trainer(fin)
    automation(fin)
    bank.next_outcome = "pending"
    wid = ask_withdrawal(coach, 200_000).json()["id"]
    assert tick(fin)["sent"] == 1 and status_of(fin, wid) == "processing"
    tick(fin)
    assert status_of(fin, wid) == "processing"
    bank.finish(f"withdrawal:{wid}")
    assert tick(fin)["resolved"] == 1 and status_of(fin, wid) == "paid" and len(bank.sent_orders) == 1


def test_an_administrator_cannot_pay_or_reject_a_transfer_that_is_in_flight(fin, bank) -> None:
    coach = trusted_trainer(fin)
    automation(fin)
    bank.next_outcome = "pending"
    wid = ask_withdrawal(coach, 200_000).json()["id"]
    tick(fin)
    reject = fin.admin.call("POST", f"/api/admin/finance/withdrawals/{wid}/reject", json={"reason": "test", "confirm_not_sent": True})
    paid = fin.admin.call("POST", f"/api/admin/finance/withdrawals/{wid}/paid", json={"bank_reference": "MANUAL-X-0002", "paid_amount_kopecks": 200_000})
    assert (reject.status_code, paid.status_code) == (409, 409) and reject.json()["error"]["code"] == "payout_in_flight"
    assert status_of(fin, wid) == "processing"


def test_an_administrator_settles_an_unanswered_transfer_after_looking_at_the_bank(fin, bank) -> None:
    coach = trusted_trainer(fin)
    automation(fin)
    bank.next_outcome = "unreachable"
    lost = ask_withdrawal(coach, 200_000).json()["id"]
    tick(fin)
    fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{lost}/reject", json={"reason": "в банке перевода нет", "confirm_not_sent": True})
    assert status_of(fin, lost) == "rejected" and sql_value(fin.dsn, "SELECT status FROM payout_attempts WHERE withdrawal_id = $1::uuid", lost) == "failed"
    assert trainer_balances(fin.dsn, coach.user_id)["trainer_reserved"] == 0
    assert_books_are_sound(fin.dsn)


def test_resuming_needs_a_finance_administrator_and_is_audited(fin, bank) -> None:
    coach = trusted_trainer(fin)
    automation(fin)
    bank.next_outcome = "unreachable"
    ask_withdrawal(coach, 200_000)
    tick(fin)
    state = fin.admin.ok("GET", "/api/admin/finance/payouts/automation")
    assert state["halted"] and "нет ответа банка" in state["halted_reason"] and state["enabled"]
    assert coach.call("POST", "/api/admin/finance/payouts/automation/resume", json={}).status_code in (401, 403)
    assert coach.call("GET", "/api/admin/finance/payouts/automation").status_code in (401, 403)
    fin.admin.ok("POST", "/api/admin/finance/payouts/automation/resume", json={})
    assert not sql_value(fin.dsn, "SELECT halted FROM payout_automation_state")
    assert sql_value(fin.dsn, "SELECT count(*) FROM admin_audit_log WHERE action = 'finance.payouts.resume'") == 1


def test_the_reconciliation_halts_on_any_difference_with_the_banks_statement(fin, bank) -> None:
    coach = trusted_trainer(fin)
    automation(fin)
    wid = ask_withdrawal(coach, 200_000).json()["id"]
    tick(fin)
    sql(fin.dsn, "UPDATE payout_attempts SET created_at = now() - interval '1 hour'")
    assert reconcile_now(fin) == []  # the books and the bank agree

    del bank.operations[f"withdrawal:{wid}"]  # the bank has no trace of what we booked as sent
    problems = reconcile_now(fin)
    assert problems and "в выписке банка нет" in problems[0]
    assert sql_value(fin.dsn, "SELECT halted FROM payout_automation_state")


def test_an_operation_at_the_bank_that_we_never_made_halts_automation(fin, bank) -> None:
    trusted_trainer(fin)
    automation(fin)
    run(bank.send(__import__("app.integrations.payouts", fromlist=["PayoutOrder"]).PayoutOrder("withdrawal:stranger", 100, "sbp", {}, "x")))
    assert "неизвестна нам" in reconcile_now(fin)[0] and sql_value(fin.dsn, "SELECT halted FROM payout_automation_state")


def test_the_database_itself_refuses_a_wrong_amount_and_a_second_live_attempt(fin, bank) -> None:
    coach = trusted_trainer(fin)
    wid = ask_withdrawal(coach, 200_000).json()["id"]

    def insert(amount: int, key: str, status: str = "created"):
        return sql(fin.dsn, "INSERT INTO payout_attempts (withdrawal_id, provider, idempotency_key, amount_kopecks, status) VALUES ($1::uuid, 'fake', $2, $3, $4)", wid, key, amount, status)

    with pytest.raises(asyncpg.PostgresError):
        insert(200_001, "k1")  # not the amount of the request
    insert(200_000, "k2")
    with pytest.raises(asyncpg.UniqueViolationError):
        insert(200_000, "k3")  # a second live attempt for the same request
    sql(fin.dsn, "UPDATE payout_attempts SET status = 'failed' WHERE idempotency_key = 'k2'")
    insert(200_000, "k3")  # after a proven failure a new one is possible
    with pytest.raises(asyncpg.UniqueViolationError):
        insert(200_000, "k2", "failed")  # an operation key is used once, ever


def test_a_paid_request_needs_a_person_or_the_system_never_nobody(fin, bank) -> None:
    coach = trusted_trainer(fin)
    wid = ask_withdrawal(coach, 200_000).json()["id"]
    sql(fin.dsn, "UPDATE withdrawal_requests SET status = 'processing' WHERE id = $1::uuid", wid)
    with pytest.raises(asyncpg.CheckViolationError):
        sql(fin.dsn, "UPDATE withdrawal_requests SET status = 'paid', bank_reference = 'ABCDE-12345', paid_at = now(), paid_amount_kopecks = amount_kopecks WHERE id = $1::uuid", wid)


def test_the_production_check_refuses_the_pretend_bank_and_automation_without_a_provider() -> None:
    from tests.test_auth_hardening import _prod

    fatal, _ = production_problems(_prod(PAYOUT_PROVIDER="fake"))
    assert any("pretend bank" in m for m in fatal)
    fatal, _ = production_problems(_prod(PAYOUTS_AUTO_ENABLED="true", FINANCE_ADMIN_EMAILS=ADMIN_EMAIL))
    assert any("needs a payout provider" in m for m in fatal)
    fatal, _ = production_problems(_prod(PAYOUTS_AUTO_ENABLED="true", PAYOUT_PROVIDER="fake"))
    assert any("FINANCE_ADMIN_EMAILS" in m for m in fatal)


@pytest.mark.parametrize("first, last, recipient, ok", [
    ("Иван", "Иванов", "Иванов Иван Иванович", True), ("Пётр", "Фёдоров", "ФЕДОРОВ ПЕТР", True), ("Анна", "Петрова-Сидорова", "Сидорова Анна Петрова", True),
    ("Иван", "Иванов", "Петров Пётр", False), ("Иван", None, "Иванов Иван", False), ("", "Иванов", "Иванов", False),
])
def test_the_recipient_must_carry_the_trainers_name(first, last, recipient, ok) -> None:
    assert auto_payouts.recipient_matches(first, last, recipient) is ok
