import XCTest

/// The calendar, for the coach test account the local scenario fills with trainings (held and upcoming).
final class CalendarUITests: SignedInUITestCase {
    private var calendarTab: XCUIElement { app.tabBars.buttons["Календарь"] }

    private func openCalendar() throws {
        try launchSignedIn()
        calendarTab.tap()
        XCTAssertTrue(app.navigationBars["Календарь"].waitForExistence(timeout: 10), "the calendar did not open")
    }

    func testTheListShowsTheTrainingsWithTheirTimeAndTeam() throws {
        try openCalendar()

        let training = app.buttons["calendar.training"].firstMatch
        XCTAssertTrue(training.waitForExistence(timeout: 15), "no training in the list")
        XCTAssertTrue(training.label.contains("Сессия с"), "a booked session is named after the athlete: \(training.label)")
        XCTAssertTrue(training.label.range(of: #"\d{2}:\d{2}"#, options: .regularExpression) != nil, "the time should be shown: \(training.label)")
    }

    func testOpeningATrainingShowsItsDetails() throws {
        try openCalendar()
        app.buttons["calendar.training"].firstMatch.tap()

        XCTAssertTrue(app.navigationBars["Тренировка"].waitForExistence(timeout: 10), "the training screen did not open")
        XCTAssertTrue(app.staticTexts["training.title"].waitForExistence(timeout: 10))
        XCTAssertTrue(text(containing: "60 мин").exists, "the duration should be shown")
        XCTAssertTrue(text(containing: "–").exists, "the time range should be shown")
        XCTAssertTrue(text(containing: "Дата").exists)

        app.navigationBars["Тренировка"].buttons.firstMatch.tap()  // back
        XCTAssertTrue(app.navigationBars["Календарь"].waitForExistence(timeout: 5), "back should return to the calendar")
    }

    func testTheWeekCanBePagedAndComesBackToToday() throws {
        try openCalendar()
        app.buttons["Неделя"].tap()

        let range = app.staticTexts["calendar.weekRange"]
        XCTAssertTrue(range.waitForExistence(timeout: 10), "the week range did not appear")
        let thisWeek = range.label
        XCTAssertFalse(app.buttons["calendar.thisWeek"].exists, "already on this week")

        app.buttons["calendar.nextWeek"].tap()
        XCTAssertTrue(app.buttons["calendar.thisWeek"].waitForExistence(timeout: 5), "should offer the way back")
        XCTAssertNotEqual(app.staticTexts["calendar.weekRange"].label, thisWeek, "the week should have changed")

        app.buttons["calendar.thisWeek"].tap()
        XCTAssertTrue(app.staticTexts["calendar.weekRange"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["calendar.weekRange"].label, thisWeek)
    }

    func testTheWeekShowsEveryDayEvenEmptyOnes() throws {
        try openCalendar()
        app.buttons["Неделя"].tap()

        XCTAssertTrue(text(containing: "Сегодня").waitForExistence(timeout: 15), "the week did not load, or today is not marked")
        // The local scenario's trainings start tomorrow, so the days before today are empty: they must still be listed, saying so.
        XCTAssertTrue(text(containing: "Нет событий").exists, "an empty day should say it has no events")
    }
}
