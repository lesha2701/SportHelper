import XCTest

/// Booking a coach and paying for it, against the local server with its fake payment provider. Which test runs depends on the account
/// in the environment: an athlete books and pays, a coach answers requests. The other kind of account skips.
final class BookingsUITests: SignedInUITestCase {
    private func openProfile() throws {
        try launchSignedIn()
        profileTab.tap()
    }

    private func openMyBookings() throws {
        try openProfile()
        let row = app.buttons["profile.myBookings"]
        guard row.waitForExistence(timeout: 10) else { throw XCTSkip("This test needs an athlete account.") }
        row.tap()
        XCTAssertTrue(app.navigationBars["Мои брони"].waitForExistence(timeout: 10), "my bookings did not open")
    }

    func testAnAthleteCanFindACoachAndSendARequest() throws {
        try launchSignedIn()
        profileTab.tap()
        // A coach's own listing is not offered to the coach, so this needs an athlete account.
        guard app.buttons["profile.myBookings"].waitForExistence(timeout: 10) else { throw XCTSkip("This test needs an athlete account.") }
        app.mainTabBar.buttons["Тренеры"].tap()
        let listing = app.buttons["coaches.listing"].firstMatch
        XCTAssertTrue(listing.waitForExistence(timeout: 15), "no coach listing in the catalogue")
        listing.tap()

        let book = app.buttons["listing.book"]
        XCTAssertTrue(book.waitForExistence(timeout: 10), "the listing screen has no booking button")
        book.tap()

        let slot = app.buttons["booking.slot"].firstMatch
        XCTAssertTrue(slot.waitForExistence(timeout: 15), "no free time was offered")
        slot.tap()
        let submit = app.buttons["booking.submit"]
        XCTAssertTrue(submit.waitForExistence(timeout: 5))
        submit.tap()

        XCTAssertTrue(app.staticTexts["booking.sent"].waitForExistence(timeout: 15), "the request was not accepted: \(app.staticTexts["booking.error"].exists ? app.staticTexts["booking.error"].label : "no message")")
        app.buttons["booking.openMine"].tap()
        XCTAssertTrue(app.navigationBars["Мои брони"].waitForExistence(timeout: 10), "«Мои брони» should open from the confirmation")
        XCTAssertTrue(text(containing: "Ожидает подтверждения тренера").waitForExistence(timeout: 10), "the new request should wait for the coach")
    }

    func testAConfirmedBookingOffersPaymentAndOpensThePaymentPage() throws {
        try openMyBookings()
        let pay = app.buttons["booking.pay"].firstMatch
        guard pay.waitForExistence(timeout: 10) else { throw XCTSkip("No confirmed unpaid booking for this account (run the coach confirmation first).") }
        XCTAssertTrue(text(containing: "Типовых условиях").exists, "the legal notice must stand next to the pay button")
        pay.tap()

        // The payment page opens in a system browser sheet (its own process: only the page itself is visible, not its buttons).
        // This account's fake provider has an unreachable address, so what is checked is that the sheet opened and can be closed.
        let browser = app.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH 'BrowserView'")).firstMatch
        XCTAssertTrue(browser.waitForExistence(timeout: 15), "the payment page did not open")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12))
            .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.98)))
        XCTAssertTrue(browser.waitForNonExistence(timeout: 10), "the payment page should close")
        // Closing the page makes the app ask the server what happened; with nothing paid it must not claim success.
        XCTAssertTrue(app.buttons["booking.pay"].firstMatch.waitForExistence(timeout: 15) || app.otherElements["booking.processing"].exists
            || text(containing: "Оплата обрабатывается").exists, "after the page closed, the booking should be payable again or processing")
        XCTAssertFalse(app.otherElements["booking.paid"].exists, "nothing was paid, so the booking must not show as paid")
    }

    func testACoachSeesAndAnswersRequests() throws {
        try openProfile()
        let row = app.buttons["profile.requests"]
        guard row.waitForExistence(timeout: 10) else {
            let labels = app.descendants(matching: .any).allElementsBoundByIndex.prefix(60).map { $0.label }.filter { !$0.isEmpty }
            throw XCTSkip("This test needs a coach account. On screen: \(labels)")
        }
        row.tap()
        XCTAssertTrue(app.navigationBars["Входящие заявки"].waitForExistence(timeout: 10))
        let confirm = app.buttons["requests.confirm"].firstMatch
        guard confirm.waitForExistence(timeout: 10) else {
            let labels = app.descendants(matching: .any).allElementsBoundByIndex.prefix(80).map { "\($0.elementType.rawValue):\($0.identifier):\($0.label)" }
            throw XCTSkip("No requests waiting; an athlete has to send one first. On screen: \(labels)")
        }
        confirm.tap()
        let message = app.staticTexts["requests.message"]
        XCTAssertTrue(message.waitForExistence(timeout: 10), "no answer was shown")
        XCTAssertTrue(message.label.contains("подтверждена"), message.label)
    }

    // MARK: cancelling

    func testAnAthleteSeesTheMoneyFirstAndCancelsAConfirmedBooking() throws {
        try openMyBookings()
        let cancel = app.buttons["booking.cancel"].firstMatch
        guard cancel.waitForExistence(timeout: 10) else { throw XCTSkip("No confirmed booking to cancel for this account (run the coach confirmation first).") }
        let before = app.buttons.matching(identifier: "booking.cancel").count
        cancel.tap()

        // what the cancellation means for the money is shown BEFORE the button is pressed
        let explanation = app.staticTexts["cancel.explanation"]
        XCTAssertTrue(explanation.waitForExistence(timeout: 15), "the window did not tell what happens to the money: \(app.staticTexts["cancel.loadError"].exists ? app.staticTexts["cancel.loadError"].label : "no message")")
        XCTAssertTrue(["Вернём 100%", "Деньги не вернутся", "деньги не списывались"].contains { explanation.label.contains($0) }, explanation.label)
        app.buttons["cancel.confirm"].tap()

        // the cancelled booking no longer offers cancelling (the list is long: its new place is at the bottom, off the screen)
        let gone = NSPredicate { _, _ in self.app.buttons.matching(identifier: "booking.cancel").count == before - 1 }
        wait(for: [XCTNSPredicateExpectation(predicate: gone, object: nil)], timeout: 20)
        XCTAssertEqual(app.buttons.matching(identifier: "booking.cancel").count, before - 1, "the cancelled booking must not offer cancelling again")
        let list = app.collectionViews["bookings.list"]
        for _ in 0..<12 where !text(containing: "Отменена вами").exists { list.swipeUp() }
        XCTAssertTrue(text(containing: "Отменена вами").exists, "the booking did not move to the cancelled ones")
    }

    func testACoachCannotCancelWithoutAReasonAndDoesWithOne() throws {
        try openProfile()
        let row = app.buttons["profile.coachBookings"]
        // the profile is a long list: the coach's rows sit under its first screen and are not built until scrolled to
        _ = app.buttons["profile.edit"].waitForExistence(timeout: 10)
        for _ in 0..<6 where !row.exists { app.swipeUp() }
        guard row.exists else { throw XCTSkip("This test needs a coach account.") }
        for _ in 0..<3 where !row.isHittable { app.swipeUp() }
        row.tap()
        XCTAssertTrue(app.navigationBars["Записи"].waitForExistence(timeout: 10))
        let cancel = app.buttons["booking.cancel"].firstMatch
        guard cancel.waitForExistence(timeout: 10) else { throw XCTSkip("No confirmed booking to cancel for this coach.") }
        cancel.tap()

        XCTAssertTrue(app.staticTexts["cancel.explanation"].waitForExistence(timeout: 15), "the window did not tell what happens to the money")
        app.buttons["cancel.confirm"].tap()
        XCTAssertTrue(app.staticTexts["cancel.error"].waitForExistence(timeout: 5), "a coach must be asked for a reason")

        let reason = app.textFields["cancel.reason"]
        reason.tap()
        reason.typeText("Заболел тренер")
        app.buttons["cancel.confirm"].tap()
        XCTAssertTrue(app.buttons["cancel.confirm"].waitForNonExistence(timeout: 20), "the window should close once the booking is cancelled")
        let list = app.collectionViews["coachBookings.list"]  // the cancelled bookings are the last section, off the screen
        for _ in 0..<12 where !text(containing: "Отменена вами").exists { list.swipeUp() }
        XCTAssertTrue(text(containing: "Отменена вами").exists, "the cancelled booking should show who cancelled it")
    }
}
