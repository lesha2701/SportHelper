import XCTest

/// «Главная» against the local server: a coach sees the numbers of the team, a player their own progress and tasks.
/// SAG_TEAM_NAME picks the coach's team; the player test needs SAG_TODO_TASK, a task waiting for them.
final class HomeUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }
    private var env: [String: String] { ProcessInfo.processInfo.environment }

    func testTheHomeIsTheFirstTab() throws {
        try launchSignedIn()
        XCTAssertTrue(app.tabBars.buttons["Главная"].isSelected, "the home should open first")
        let shown = app.navigationBars["Тренерская панель"].waitForExistence(timeout: 10) || app.navigationBars["Твой прогресс"].exists
        XCTAssertTrue(shown, "the home has no title")
    }

    func testACoachSeesTheNumbersOfTheTeamAndCanStartSomething() throws {
        try launchSignedIn()
        guard app.navigationBars["Тренерская панель"].waitForExistence(timeout: 10) else { throw XCTSkip("This needs a coach account.") }
        XCTAssertTrue(app.staticTexts["Посещаемость"].waitForExistence(timeout: 15), "no attendance tile")
        XCTAssertTrue(element("stats.tile").exists)
        XCTAssertTrue(app.staticTexts["Нагрузка команды"].exists || app.staticTexts["Требуют внимания"].exists)
        scrollUntilVisible(element("home.quick.task"))
        element("home.quick.task").tap()
        XCTAssertTrue(app.navigationBars.firstMatch.waitForExistence(timeout: 10), "the task form did not open")
    }

    func testAPlayerSeesTheirTasksAndOpensOne() throws {
        try launchSignedIn()
        guard app.navigationBars["Твой прогресс"].waitForExistence(timeout: 10) else { throw XCTSkip("This needs a player account.") }
        guard let title = env["SAG_TODO_TASK"] else { throw XCTSkip("Set TEST_RUNNER_SAG_TODO_TASK.") }
        let task = app.staticTexts[title].firstMatch
        _ = task.waitForExistence(timeout: 15)
        scrollUntilVisible(task)
        XCTAssertTrue(task.exists, "the task is not on the home")
        task.tap()
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 10))
    }
}
