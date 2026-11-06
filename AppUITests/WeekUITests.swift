import XCTest

/// «Эта неделя» on the home against the local server: seven days, today chosen at first, each day shows its events or says there are none.
final class WeekUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    func testTheWeekShowsSevenDaysAndTheEventsOfTheDayThatIsTouched() throws {
        try launchSignedIn()
        XCTAssertTrue(app.mainTabBar.buttons["Главная"].isSelected)
        let days = app.descendants(matching: .any).matching(identifier: "home.weekDay")
        let first = days.firstMatch
        _ = first.waitForExistence(timeout: 15)
        scrollUntilVisible(first)
        XCTAssertTrue(first.exists, "no week card on the home")
        XCTAssertEqual(days.count, 7, "a week has seven days")
        let heading = element("home.weekHeading")
        XCTAssertTrue(heading.label.hasPrefix("Сегодня"), "today is chosen at first, got «\(heading.label)»")
        XCTAssertEqual(days.matching(NSPredicate(format: "isSelected == true")).count, 1)

        // every day answers: a list of its events or «событий нет»
        for index in 0..<7 {
            let day = days.element(boundBy: index)
            scrollUntilVisible(day)
            day.tap()
            let answered = element("home.weekEmpty").waitForExistence(timeout: 3) || element("home.weekEvent").waitForExistence(timeout: 3)
            XCTAssertTrue(answered, "day \(index + 1) shows neither events nor the empty note")
            XCTAssertTrue(days.element(boundBy: index).isSelected, "the touched day should be the chosen one")
        }
        XCTAssertFalse(element("home.weekHeading").label.isEmpty)
    }
}
