import XCTest

/// The report of an independent training against the local server. It needs a training held by a team of coach1 whose responsible
/// player is player1: SAG_REPORT_PLACE (its place) and SAG_TEAM_NAME say which one. The player writes the report, the coach answers it.
final class TrainingReportUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func openReport() throws {
        let env = ProcessInfo.processInfo.environment
        guard let place = env["SAG_REPORT_PLACE"], let team = env["SAG_TEAM_NAME"] else {
            throw XCTSkip("Set TEST_RUNNER_SAG_REPORT_PLACE and TEST_RUNNER_SAG_TEAM_NAME (an independent training that has passed).")
        }
        try launchSignedIn()
        app.mainTabBar.buttons["Команды"].tap()
        let row = app.staticTexts[team]
        XCTAssertTrue(row.waitForExistence(timeout: 15), "the team \(team) is not in the list")
        row.tap()
        XCTAssertTrue(element("team.trainings").waitForExistence(timeout: 15))
        element("team.trainings").tap()
        let training = app.staticTexts[place].firstMatch
        _ = training.waitForExistence(timeout: 15)
        scrollUntilVisible(training, attempts: 20)
        training.tap()
        let link = element("training.report")
        scrollUntilVisible(link)
        XCTAssertTrue(link.waitForExistence(timeout: 10), "a training that has passed has a report")
        link.tap()
    }

    private func status() -> String { element("report.status").label }

    func testThePlayerWritesAndRewritesTheReport() throws {
        try openReport()
        guard element("report.text").waitForExistence(timeout: 10) else { throw XCTSkip("This needs the responsible player.") }
        let submit = element("report.submit")
        XCTAssertFalse(submit.isEnabled, "an empty report cannot be sent")

        let field = element("report.text")
        field.tap()
        field.typeText("Пришли все, кроме двоих. Отработали подачу.")
        XCTAssertTrue(submit.isEnabled)
        submit.tap()
        XCTAssertTrue(element("report.status").waitForExistence(timeout: 15), "no status after sending")
        XCTAssertEqual(status(), "На проверке")
        XCTAssertTrue(app.buttons["Обновить отчёт"].exists, "a sent report is updated, not sent again")
        // photo and video can be attached only once the text is there
        XCTAssertTrue(element("report.pickPhoto").waitForExistence(timeout: 5))
        XCTAssertTrue(element("report.pickVideo").exists)

        field.tap()
        field.typeText(" Всё прошло хорошо.")
        app.buttons["Обновить отчёт"].tap()
        XCTAssertTrue(text(containing: "Отчёт отправлен").waitForExistence(timeout: 10))
    }

    func testTheCoachSendsTheReportBackAndThenAcceptsIt() throws {
        try openReport()
        guard element("report.accept").waitForExistence(timeout: 10) else {
            // not a coach of the team: the report is only read
            XCTAssertTrue(element("report.body").exists || element("report.empty").exists)
            throw XCTSkip("This needs the coach of the team.")
        }
        XCTAssertTrue(element("report.body").exists, "the player has not written a report yet (run the player test first)")
        XCTAssertFalse(element("report.text").exists, "the coach does not write the report")

        let comment = element("report.comment")
        comment.tap()
        comment.typeText("Добавьте, кто отсутствовал.")
        element("report.revise").tap()
        XCTAssertTrue(text(containing: "возвращён на доработку").waitForExistence(timeout: 10))
        XCTAssertEqual(status(), "Нужно доработать")
        XCTAssertEqual(element("report.coachComment").label, "Добавьте, кто отсутствовал.")

        element("report.accept").tap()
        XCTAssertTrue(text(containing: "Отчёт принят").waitForExistence(timeout: 10))
        XCTAssertEqual(status(), "Принят")
    }
}
