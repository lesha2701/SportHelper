import XCTest

/// A coach opens a session they were booked for from the calendar: the training screen offers the session with the athlete and what to do
/// with it (the local scenario books coach1 with players, some sessions held and some ahead).
final class CoachSessionUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    func testTheCoachSeesTheSessionCardWithTheAthleteOnABookedTraining() throws {
        try launchSignedIn()
        app.mainTabBar.buttons["Календарь"].tap()
        XCTAssertTrue(app.navigationBars["Календарь"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["calendar.training"].firstMatch.waitForExistence(timeout: 15))

        let session = app.buttons.matching(identifier: "calendar.training").containing(NSPredicate(format: "label CONTAINS %@", "Сессия с")).firstMatch
        scrollUntilVisible(session, attempts: 20)
        XCTAssertTrue(session.exists, "no booked session in the calendar")
        session.tap()

        XCTAssertTrue(app.navigationBars["Тренировка"].waitForExistence(timeout: 10), "the training screen did not open")
        XCTAssertTrue(element("booking.card").waitForExistence(timeout: 15), "the coach has no session card on a training they were booked for")
        XCTAssertTrue(element("booking.playerProfile").exists, "the athlete's page cannot be opened from the card")
        // whichever session it is, the card says what the coach can do next: mark it held, review the athlete, or when the button comes
        let next = [
            element("booking.complete"), element("booking.reviewPlayer"), element("booking.playerReviewed"),
            text(containing: "появится, когда занятие начнётся")
        ]
        XCTAssertTrue(next.contains { $0.exists }, "the card does not say what the coach can do with the session")
    }
}
