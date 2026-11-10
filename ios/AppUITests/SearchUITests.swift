import XCTest

/// The global search against the local server: from the magnifier on the home, a question finds the team, a result opens its screen on
/// top of the search, and a question that finds nothing says so. Needs a team in the account (the seed scripts make «Команда iOS …»).
final class SearchUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func openSearch() {
        XCTAssertTrue(app.mainTabBar.buttons["Главная"].isSelected)
        let button = element("search.button")
        XCTAssertTrue(button.waitForExistence(timeout: 15), "no magnifier on the home")
        button.tap()
        XCTAssertTrue(element("search.hint").waitForExistence(timeout: 10), "the search should open with its hint")
    }

    private func ask(_ text: String) {
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "no search field")
        field.tap()
        field.typeText(text)
    }

    func testAShortQuestionIsNotAskedAndAnEmptyAnswerIsSaid() throws {
        try launchSignedIn()
        openSearch()
        ask("я")
        XCTAssertTrue(element("search.hint").exists, "one letter is too little to ask")
        XCTAssertFalse(element("search.empty").exists)
        ask("яяяяяя")  // together seven letters, which nothing is named
        XCTAssertTrue(element("search.empty").waitForExistence(timeout: 15), "nothing found should be said")
    }

    func testATeamIsFoundAndItsScreenOpensOnTopOfTheSearch() throws {
        try launchSignedIn()
        openSearch()
        ask("Команда")
        let result = element("search.result")
        XCTAssertTrue(result.waitForExistence(timeout: 15), "no team found by «Команда»")
        XCTAssertTrue(text(containing: "Команды").exists, "the group is titled")
        result.tap()
        XCTAssertTrue(element("team.member").waitForExistence(timeout: 15), "the team's screen should open with its members")
        XCTAssertFalse(element("search.hint").exists)
        // the back arrow leads to the results again, the cross closes the search
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(element("search.result").waitForExistence(timeout: 10), "back should show the results again")
        let close = app.buttons["Закрыть"].firstMatch
        XCTAssertTrue(close.waitForExistence(timeout: 10), "no cross to close the search")
        close.tap()
        XCTAssertTrue(element("search.button").waitForExistence(timeout: 10), "closing returns to the home")
    }

    /// Needs the data that the seed scripts leave for coach1: a match against «Соперник …», tasks «Задание …» and a coach «Финансовый Тренер».
    func testAMatchATaskAndACoachOpenTheirOwnScreens() throws {
        try launchSignedIn()
        for (question, bar) in [("Соперник", "Матч"), ("Задание", "Задание"), ("Финансовый", "Тренер")] {
            openSearch()
            ask(question)
            let result = element("search.result")
            XCTAssertTrue(result.waitForExistence(timeout: 15), "nothing found by «\(question)»")
            result.tap()
            XCTAssertTrue(app.navigationBars[bar].waitForExistence(timeout: 15), "«\(question)» should open the screen «\(bar)»")
            app.navigationBars[bar].buttons.firstMatch.tap()
            XCTAssertTrue(element("search.result").waitForExistence(timeout: 10), "back should show the results again")
            let close = app.buttons["Закрыть"].firstMatch
            XCTAssertTrue(close.waitForExistence(timeout: 10))
            close.tap()
            XCTAssertTrue(element("search.button").waitForExistence(timeout: 10))
        }
    }
}
