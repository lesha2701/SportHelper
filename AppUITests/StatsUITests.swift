import XCTest

/// The statistics against the local server: a person's own (with measured values that can be added, changed and deleted) and,
/// for a coach, those of the team and of a player of it. SAG_TEAM_NAME picks the coach's team.
final class StatsUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }
    private var env: [String: String] { ProcessInfo.processInfo.environment }
    private func stamp() -> String { String(Int(Date().timeIntervalSince1970)) }

    private func type(_ text: String, into id: String) {
        let field = app.textFields[id]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "no field \(id)")
        field.tap()
        field.typeText(text + "\n")  // the return key closes the keyboard, which would cover the rest of the form
    }

    private func metricRow(_ name: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "playerStats.metric")
            .containing(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
    }

    /// The line "Название: значение" of a measured value.
    private func metricText(_ name: String) -> XCUIElement { text(containing: name) }

    private func openTeam() throws {
        try launchSignedIn()
        guard app.staticTexts["Тренерская панель"].waitForExistence(timeout: 10) else { throw XCTSkip("This needs a coach account.") }
        app.mainTabBar.buttons["Команды"].tap()
        XCTAssertTrue(app.navigationBars["Команды"].waitForExistence(timeout: 10))
        if let name = env["SAG_TEAM_NAME"] {
            let row = app.staticTexts[name]
            XCTAssertTrue(row.waitForExistence(timeout: 15), "the team \(name) is not in the list")
            row.tap()
        } else {
            let row = app.buttons["teams.team"].firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 15), "no team in the list")
            row.tap()
        }
    }

    /// Adds a measured value on the open statistics screen and checks it is listed.
    private func addMetric(_ name: String, value: String) {
        let add = element("playerStats.addMetric")
        scrollUntilVisible(add)
        add.tap()
        type(name, into: "metricForm.name")
        type(value, into: "metricForm.value")
        type("см", into: "metricForm.unit")
        app.buttons["metricForm.save"].tap()
        let row = metricRow(name)
        XCTAssertTrue(row.waitForExistence(timeout: 15), "the new value is not listed")
        scrollUntilVisible(row)
        XCTAssertTrue(metricText(name).label.contains("\(value) см"), "the value should be shown with its unit, it says: \(metricText(name).label)")
    }

    private func changeAndDelete(_ name: String) {
        let row = metricRow(name)
        scrollUntilVisible(row)
        row.buttons["playerStats.metricMenu"].tap()
        app.buttons["Изменить"].tap()
        let field = app.textFields["metricForm.value"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        replaceText(in: field, with: "13\n")
        app.buttons["metricForm.save"].tap()
        let changed = metricRow(name)
        XCTAssertTrue(changed.waitForExistence(timeout: 15))
        let deadline = Date().addingTimeInterval(10)
        while !metricText(name).label.contains("13 см"), Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.3)) }
        XCTAssertTrue(metricText(name).label.contains("13 см"), "the change was not saved, it says: \(metricText(name).label)")

        changed.buttons["playerStats.metricMenu"].tap()
        app.buttons["Удалить"].tap()
        app.sheets.buttons["Удалить"].firstMatch.tap()
        let gone = NSPredicate(format: "exists == false")
        let wait = XCTNSPredicateExpectation(predicate: gone, object: metricRow(name))
        XCTAssertEqual(XCTWaiter().wait(for: [wait], timeout: 10), .completed, "the value was not deleted")
    }

    func testAPersonSeesTheirStatisticsAndManagesMeasuredValues() throws {
        try launchSignedIn()
        profileTab.tap()
        scrollUntilVisible(element("profile.stats"))
        element("profile.stats").tap()
        XCTAssertTrue(app.navigationBars["Статистика"].waitForExistence(timeout: 10), "the statistics did not open")
        XCTAssertTrue(element("playerStats.attendance").waitForExistence(timeout: 15) || element("playerStats.empty").exists, "neither numbers nor the empty note")
        XCTAssertTrue(element("playerStats.ai").exists, "a person can ask for recommendations about themselves")

        let name = "Прыжок \(stamp())"
        addMetric(name, value: "12,5")
        changeAndDelete(name)
    }

    func testACoachSeesTheTeamsNumbers() throws {
        try openTeam()
        XCTAssertTrue(element("team.stats").waitForExistence(timeout: 15))
        element("team.stats").tap()
        XCTAssertTrue(app.navigationBars["Статистика"].waitForExistence(timeout: 10), "the team statistics did not open")
        XCTAssertTrue(element("stats.tile").waitForExistence(timeout: 15) || element("teamStats.empty").exists, "neither numbers nor the empty note")
        scrollUntilVisible(element("teamStats.summary"))
        XCTAssertTrue(element("teamStats.summary").exists && element("teamStats.attendanceAnalysis").exists && element("teamStats.reportAnalysis").exists)
    }

    /// A player of the team reads its numbers like on the site, without the AI analyses (the server gives those to the coaching staff only).
    func testAPlayerSeesTheTeamsNumbersButNotTheCoachesAnalyses() throws {
        try launchSignedIn()
        guard app.staticTexts["Твой прогресс"].waitForExistence(timeout: 10) else { throw XCTSkip("This needs a player account in a team.") }
        app.mainTabBar.buttons["Команды"].tap()
        XCTAssertTrue(app.navigationBars["Команды"].waitForExistence(timeout: 10))
        let teams = app.buttons.matching(identifier: "teams.team")
        let row = env["SAG_TEAM_NAME"].map { teams.matching(NSPredicate(format: "label CONTAINS %@", $0)).firstMatch } ?? teams.firstMatch
        guard row.waitForExistence(timeout: 15) else { throw XCTSkip("The player is in no team.") }
        scrollUntilVisible(row)  // a player's list has more above the team than a coach's
        row.tap()
        XCTAssertTrue(element("team.chat").waitForExistence(timeout: 15), "the team did not open")
        scrollUntilVisible(element("team.stats"))
        XCTAssertTrue(element("team.stats").waitForExistence(timeout: 15), "a player does not see the statistics button")
        element("team.stats").tap()
        XCTAssertTrue(app.navigationBars["Статистика"].waitForExistence(timeout: 10), "the team statistics did not open")
        XCTAssertTrue(element("stats.tile").waitForExistence(timeout: 15) || element("teamStats.empty").exists, "neither numbers nor the empty note")
        XCTAssertFalse(element("teamStats.summary").exists, "a player is offered the coach's AI summary")
        XCTAssertFalse(element("teamStats.attendanceAnalysis").exists)
        XCTAssertFalse(element("teamStats.reportAnalysis").exists)
    }

    func testACoachOpensAPlayerOfTheTeamAndAddsAMeasuredValue() throws {
        try openTeam()
        let member = app.buttons["team.member"].firstMatch
        scrollUntilVisible(member)
        XCTAssertTrue(member.waitForExistence(timeout: 15), "no player to open")
        member.tap()
        XCTAssertTrue(element("playerStats.addMetric").waitForExistence(timeout: 15), "the player's statistics did not open")

        let name = "Выносливость \(stamp())"
        addMetric(name, value: "7,5")
        changeAndDelete(name)
    }
}
