import XCTest

/// «Главная» against the local server: a coach sees the numbers of the team, a player their own progress and tasks.
/// SAG_TEAM_NAME picks the coach's team; the player test needs SAG_TODO_TASK, a task waiting for them.
final class HomeUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }
    private var env: [String: String] { ProcessInfo.processInfo.environment }

    func testTheHomeIsTheFirstTab() throws {
        try launchSignedIn()
        XCTAssertTrue(app.mainTabBar.buttons["Главная"].isSelected, "the home should open first")
        let shown = app.staticTexts["Тренерская панель"].waitForExistence(timeout: 10) || app.staticTexts["Твой прогресс"].exists
        XCTAssertTrue(shown, "the home has no title")
    }

    func testACoachSeesTheNumbersOfTheTeamAndCanStartSomething() throws {
        try launchSignedIn()
        guard app.staticTexts["Тренерская панель"].waitForExistence(timeout: 10) else { throw XCTSkip("This needs a coach account.") }
        if element("home.createTeam").waitForExistence(timeout: 5) { throw XCTSkip("This needs a coach who is in a team.") }
        XCTAssertTrue(app.staticTexts["Посещаемость"].waitForExistence(timeout: 15), "no attendance tile")
        XCTAssertTrue(element("stats.tile").exists)
        XCTAssertTrue(app.staticTexts["Нагрузка команды"].exists || app.staticTexts["Требуют внимания"].exists)
        scrollUntilVisible(element("home.quick.task"))
        element("home.quick.task").tap()
        XCTAssertTrue(app.navigationBars.firstMatch.waitForExistence(timeout: 10), "the task form did not open")
    }

    /// A coach who has no team yet gets the same home as on the site: the nearest event, the week, three numbers of their own.
    func testACoachWithoutATeamSeesTheirWeekAndNumbersNotAnEmptyScreen() throws {
        try launchSignedIn()
        guard app.staticTexts["Тренерская панель"].waitForExistence(timeout: 10) else { throw XCTSkip("This needs a coach account.") }
        // a coach with a team has the team's numbers (attendance); this test is for the one who has none
        if app.staticTexts["Посещаемость"].waitForExistence(timeout: 12) { throw XCTSkip("This needs a coach who is not in a team.") }
        XCTAssertFalse(app.staticTexts["Пока нет команд"].exists, "the empty screen is back")
        XCTAssertTrue(element("home.next").exists || element("home.noEvents").exists, "the nearest event (or the note that there is none) is missing")
        for label in ["Занятий на этой неделе", "Событий в ближайшие 2 недели", "Новых заявок"] {
            let tile = app.staticTexts[label]
            scrollUntilVisible(tile, attempts: 4)
            XCTAssertTrue(tile.exists, "no «\(label)» number")
        }
        scrollUntilVisible(element("home.weekDay"))
        XCTAssertTrue(element("home.weekDay").exists, "no «Эта неделя»")
        scrollUntilVisible(element("home.createTeam"))
        XCTAssertTrue(element("home.createTeam").isHittable, "starting a team must stay one tap away")
    }

    func testAPlayerSeesTheirTasksAndOpensOne() throws {
        try launchSignedIn()
        guard app.staticTexts["Твой прогресс"].waitForExistence(timeout: 10) else { throw XCTSkip("This needs a player account.") }
        guard let title = env["SAG_TODO_TASK"] else { throw XCTSkip("Set TEST_RUNNER_SAG_TODO_TASK.") }
        let task = app.staticTexts[title].firstMatch
        _ = task.waitForExistence(timeout: 15)
        scrollUntilVisible(task)
        XCTAssertTrue(task.exists, "the task is not on the home")
        task.tap()
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 10))
    }
}
