import XCTest

/// Attendance of a held team training and a task for those who were not there, against the local server. Needs a coach of a team
/// with at least one player (SAG_TEAM_NAME picks the team). Everything the test makes is deleted at the end.
final class AttendanceUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }
    private func stamp() -> String { String(Int(Date().timeIntervalSince1970)) }

    private func openTeam() throws {
        try launchSignedIn()
        app.tabBars.buttons["Команды"].tap()
        XCTAssertTrue(app.navigationBars["Команды"].waitForExistence(timeout: 10))
        if let name = ProcessInfo.processInfo.environment["SAG_TEAM_NAME"] {
            let row = app.staticTexts[name]
            XCTAssertTrue(row.waitForExistence(timeout: 15), "the team \(name) is not in the list")
            row.tap()
        } else {
            let row = app.buttons["teams.team"].firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 15), "no team in the list")
            row.tap()
        }
    }

    private func back() { app.navigationBars.buttons.firstMatch.tap() }

    private func missed(_ summary: String) -> Int? {
        // "Были 3 из 4": the number of those who were there is the first number
        summary.split(separator: " ").compactMap { Int($0) }.first
    }

    func testAbsenteesAreMarkedOnAHeldTrainingAndGetATask() throws {
        try openTeam()
        guard element("team.trainings").waitForExistence(timeout: 15), element("team.edit").waitForExistence(timeout: 5) else {
            throw XCTSkip("This needs a coach of the team.")
        }

        // a training, marked as held
        element("team.trainings").tap()
        let place = "Корт-\(stamp())"
        element("trainings.schedule").tap()
        let location = app.textFields["trainingForm.location"]
        XCTAssertTrue(location.waitForExistence(timeout: 10))
        location.tap()
        location.typeText(place + "\n")
        element("trainingForm.save").tap()
        let row = app.staticTexts[place].firstMatch
        _ = row.waitForExistence(timeout: 15)
        scrollUntilVisible(row, attempts: 20)
        row.tap()
        element("training.actions").tap()
        element("training.complete").tap()
        XCTAssertTrue(text(containing: "Проведена").waitForExistence(timeout: 10))

        // everyone is counted as present until the coach says otherwise
        let toggle = element("training.attendance")
        scrollUntilVisible(toggle)
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), "no attendance on a held training")
        XCTAssertEqual(toggle.value as? String, "1", "a held training counts everyone present")
        let summary = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Были ")).firstMatch
        if !summary.exists { app.swipeDown() }  // the line above the first toggle may be scrolled out of the list
        XCTAssertTrue(summary.waitForExistence(timeout: 5), "no summary of the attendance")
        let before = try XCTUnwrap(missed(summary.label), summary.label)
        app.swipeUp()  // the row may sit under the tab bar, which would take the tap
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        let flipped = NSPredicate(format: "value == %@", "0")
        XCTAssertEqual(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: flipped, object: toggle)], timeout: 10), .completed,
                       "the toggle did not turn off: \(String(describing: toggle.value))")
        if !summary.exists { app.swipeDown() }
        XCTAssertTrue(summary.waitForExistence(timeout: 5), "the summary disappeared")
        XCTAssertEqual(missed(summary.label), before - 1, "marking one absent should change the count: \(summary.label)")

        // a task for those who were not there
        back()
        back()
        element("team.tasks").tap()
        element("tasks.add").tap()
        let title = "Догнать \(stamp())"
        let field = app.textFields["taskForm.title"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText(title + "\n")
        let audience = app.segmentedControls["taskForm.audience"]
        scrollUntilVisible(audience)
        audience.buttons["Не были"].tap()
        let picker = element("taskForm.training")
        scrollUntilVisible(picker)
        picker.tap()
        // the menu names the trainings by their date, time and place: the one made above
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", place)).firstMatch.tap()
        element("taskForm.save").tap()
        let task = app.staticTexts[title].firstMatch
        XCTAssertTrue(task.waitForExistence(timeout: 15), "the task was not given: \(element("taskForm.error").exists ? element("taskForm.error").label : "")")
        scrollUntilVisible(task, attempts: 20)
        task.tap()
        XCTAssertTrue(element("task.assignment").waitForExistence(timeout: 10), "the absent player should have the task")
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "task.assignment").count, 1, "only the absent one gets it")

        // clean up
        element("task.actions").tap()
        app.buttons["Удалить"].tap()
        app.buttons["Удалить"].tap()
        XCTAssertTrue(app.navigationBars["Задания"].waitForExistence(timeout: 10))
        back()
        element("team.trainings").tap()
        let again = app.staticTexts[place].firstMatch
        _ = again.waitForExistence(timeout: 15)
        scrollUntilVisible(again, attempts: 20)
        again.tap()
        element("training.actions").tap()
        element("training.delete").tap()
        app.buttons["Удалить"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Тренировки"].waitForExistence(timeout: 10))
    }
}
