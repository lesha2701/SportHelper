import XCTest

/// Confirming that a booked session took place (docs/session-confirmation.md), against the local server. Needs an athlete account with an
/// in-person booking whose session is over and not confirmed yet; another account skips.
final class SessionConfirmationUITests: SignedInUITestCase {
    private func openMyBookings() throws {
        try launchSignedIn()
        profileTab.tap()
        let row = app.buttons["profile.myBookings"]
        guard row.waitForExistence(timeout: 10) else { throw XCTSkip("This test needs an athlete account.") }
        row.tap()
        XCTAssertTrue(app.navigationBars["Мои брони"].waitForExistence(timeout: 10), "my bookings did not open")
    }

    /// The button may be below the visible part of a long list: the rows are built only when scrolled to.
    private func find(_ identifier: String) -> XCUIElement? {
        let button = app.buttons[identifier].firstMatch
        for _ in 0..<6 {
            if button.waitForExistence(timeout: 2) && button.isHittable { return button }
            app.swipeUp()
        }
        return button.exists ? button : nil
    }

    func testTheAthleteShowsTheCodeAndConfirmsTheSession() throws {
        try openMyBookings()
        guard let showCode = find("session.showCode") else { throw XCTSkip("No in-person session waiting for confirmation for this account.") }
        showCode.tap()
        let code = app.staticTexts["session.code"]
        XCTAssertTrue(code.waitForExistence(timeout: 10), "the code was not shown")
        // VoiceOver reads it digit by digit; on screen it is two halves of three
        XCTAssertNotNil(code.label.range(of: #"^Код( \d){6}$"#, options: .regularExpression), "the code should be read out digit by digit: \(code.label)")
        app.buttons["session.codeClose"].tap()
        XCTAssertTrue(code.waitForNonExistence(timeout: 5))

        guard let confirm = find("session.confirm") else { throw XCTSkip("The session is not over yet, so it cannot be confirmed.") }
        confirm.tap()
        XCTAssertTrue(text(containing: "Вы подтвердили тренировку").waitForExistence(timeout: 15),
                      "the card should say the session is confirmed: \(app.staticTexts["session.error"].exists ? app.staticTexts["session.error"].label : "no error shown")")
    }

    func testAProblemReportOffersOnlyTheAthletesOwnKindsAndNeedsWordsForOther() throws {
        try openMyBookings()
        guard let problem = find("session.problem") else { throw XCTSkip("No session open for a report for this account.") }
        problem.tap()
        XCTAssertTrue(app.navigationBars["Сообщить о проблеме"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Тренер не пришёл"].exists || text(containing: "Тренер не пришёл").exists)
        XCTAssertFalse(text(containing: "Игрок не пришёл").exists, "the athlete cannot report their own no-show")
        app.buttons["Другое"].firstMatch.tap()
        app.buttons["session.problemSend"].tap()
        XCTAssertTrue(app.staticTexts["session.problemError"].waitForExistence(timeout: 5), "«Другое» without words must be refused before sending")
        app.navigationBars["Сообщить о проблеме"].buttons["Отмена"].tap()
    }
}
