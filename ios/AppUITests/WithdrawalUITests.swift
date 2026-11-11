import XCTest

/// Asking for a payout and taking the request back, against the local server (the throwaway coach of the finance seed has more than the
/// minimum available). Every request made here is cancelled at the end, so the balance is the same afterwards.
final class WithdrawalUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func fill(_ id: String, _ value: String, secure: Bool = false) {
        let field = secure ? app.secureTextFields[id].firstMatch : app.textFields[id].firstMatch
        scrollUntilVisible(field)
        XCTAssertTrue(field.waitForExistence(timeout: 5), "no field \(id)")
        field.tap()
        field.typeText(value)
    }

    private func openFinance() {
        profileTab.tap()
        let link = element("profile.finance")
        scrollUntilVisible(link)
        link.tap()
        XCTAssertTrue(element("finance.balance").waitForExistence(timeout: 15))
    }

    func testAnObviousMistakeIsShownBeforeAnythingIsSentAndAWrongPasswordUnderItsField() throws {
        try launchSignedIn()
        openFinance()
        element("finance.withdraw").tap()
        XCTAssertTrue(element("withdraw.amount").waitForExistence(timeout: 10))

        // Only the amount filled in: the form says what else is wrong and sends nothing.
        fill("withdraw.amount", "10000")
        let submit = element("withdraw.submit")
        scrollUntilVisible(submit)
        submit.tap()
        XCTAssertTrue(element("withdraw.error.recipient").waitForExistence(timeout: 5), "the missing recipient must be named")
        XCTAssertTrue(element("withdraw.error.password").exists)

        fill("withdraw.recipient", "Анна Тренер")
        fill("withdraw.bank", "Сбербанк")
        fill("withdraw.phone", "9123456789")
        fill("withdraw.password", "definitely-not-the-password", secure: true)
        scrollUntilVisible(submit)
        submit.tap()
        XCTAssertTrue(element("withdraw.error.password").waitForExistence(timeout: 10), "the server's «Неверный пароль» belongs under the password")
        XCTAssertTrue(text(containing: "Неверный пароль").exists)
    }

    func testARequestIsCreatedShownAndTakenBack() throws {
        try launchSignedIn()
        let (_, password) = try credentials()
        openFinance()
        let before = app.descendants(matching: .any).matching(identifier: "finance.withdrawal").count
        element("finance.withdraw").tap()
        XCTAssertTrue(element("withdraw.amount").waitForExistence(timeout: 10))
        fill("withdraw.amount", "10000")
        fill("withdraw.recipient", "Анна Тренер")
        fill("withdraw.bank", "Сбербанк")
        fill("withdraw.phone", "9123456789")
        fill("withdraw.password", password, secure: true)
        let submit = element("withdraw.submit")
        scrollUntilVisible(submit)
        submit.tap()

        XCTAssertTrue(element("finance.notice").waitForExistence(timeout: 15), "the screen must say the request was created")
        XCTAssertTrue(text(containing: "Заявка на").exists)
        let cancel = app.buttons["finance.cancelWithdrawal"].firstMatch
        scrollUntilVisible(cancel)
        XCTAssertTrue(cancel.exists, "a new request can be taken back: \(app.debugDescription.suffix(3500))")
        XCTAssertGreaterThan(app.descendants(matching: .any).matching(identifier: "finance.withdrawal").count, before - 1)

        cancel.tap()
        let confirm = app.buttons["Да, отменить"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        XCTAssertTrue(text(containing: "Заявка отменена").waitForExistence(timeout: 15), "the cancellation must be confirmed")
    }
}
