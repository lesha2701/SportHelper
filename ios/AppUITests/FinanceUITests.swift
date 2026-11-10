import XCTest

/// «Финансы» of a coach against the local server (the section is switched on there). It only reads, so any coach will do; the amounts are
/// checked for the throwaway coach that the seed script `seed_finance.py` makes (SAG_FINANCE=1): 12 500,50 ₽ available, 2 250 ₽ waiting
/// for the lesson, 10 000 ₽ in a request that is being checked.
final class FinanceUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func openFinance() {
        profileTab.tap()
        let link = element("profile.finance")
        scrollUntilVisible(link)
        XCTAssertTrue(link.waitForExistence(timeout: 10), "no «Финансы» in a coach's profile")
        link.tap()
        XCTAssertTrue(element("finance.balance").waitForExistence(timeout: 15), "the balance should be shown")
    }

    func testTheFinanceScreenShowsTheBalanceTheRequestsAndTheHistory() throws {
        try launchSignedIn()
        openFinance()
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "stats.tile").count, 4, "four balance tiles")
        XCTAssertTrue(text(containing: "Доступно к выводу").exists)
        let requests = text(containing: "Заявки на вывод")
        scrollUntilVisible(requests)
        XCTAssertTrue(requests.exists)
        let history = text(containing: "История операций")
        scrollUntilVisible(history)
        XCTAssertTrue(history.exists)
    }

    func testTheSeededCoachSeesHisMoneyAndTheRequestAndThePayment() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["SAG_FINANCE"] == "1", "needs the coach made by seed_finance.py")
        try launchSignedIn()
        openFinance()
        for amount in ["12\u{a0}500,50", "2\u{a0}250,00", "10\u{a0}000,00"] {
            XCTAssertTrue(text(containing: amount).exists, "no \(amount) among the tiles")
        }
        let request = element("finance.withdrawal")
        scrollUntilVisible(request)
        XCTAssertTrue(request.exists, "the request for a payout should be listed")
        XCTAssertTrue(request.label.contains("Заявка создана"), "its status: \(request.label)")
        let payment = text(containing: "Оплата занятия получена")
        scrollUntilVisible(payment)
        XCTAssertTrue(payment.exists, "the payment is in the history")
        XCTAssertTrue(text(containing: "комиссия платформы").exists, "who paid what and the commission")
        XCTAssertTrue(text(containing: "Заявка на вывод создана").exists)
    }
}
