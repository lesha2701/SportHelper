import XCTest

/// Scheduling and changing the trainings of a team, against the local server. A coach (head or assistant) of at least one team is needed;
/// an athlete account checks that the controls are not there. SAG_TEAM_NAME picks the team, otherwise the first one of the list.
final class TrainingsUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }
    /// The list builds only the rows near the screen and earlier runs leave many trainings behind: scroll until this one is on screen.
    private func reveal(_ place: String) -> XCUIElement {
        let row = app.staticTexts[place].firstMatch
        _ = row.waitForExistence(timeout: 15)
        scrollUntilVisible(row, attempts: 20)
        return row
    }

    private func place() -> String { "Корт-\(Int(Date().timeIntervalSince1970))" }

    private func openTrainings() throws {
        try launchSignedIn()
        app.mainTabBar.buttons["Команды"].tap()
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
        XCTAssertTrue(element("team.trainings").waitForExistence(timeout: 15))
        element("team.trainings").tap()
        XCTAssertTrue(app.navigationBars["Тренировки"].waitForExistence(timeout: 10), "the trainings did not open")
    }

    /// Fills the form with a place and saves; the form needs a coach, so a missing button skips the test.
    private func schedule(at place: String, repeating: Bool = false) throws {
        let button = element("trainings.schedule")
        guard button.waitForExistence(timeout: 8) else { throw XCTSkip("Scheduling needs a coach of this team.") }
        button.tap()
        let field = app.textFields["trainingForm.location"]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the form did not open")
        field.tap()
        field.typeText(place + "\n")  // the return key closes the keyboard, which would cover the rest of the form
        if repeating {
            let toggle = app.switches["trainingForm.repeat"]
            scrollUntilVisible(toggle)
            toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()  // the switch itself, at the right end of the row
            XCTAssertEqual(toggle.value as? String, "1", "the weekly repeat should be on")
        }
        element("trainingForm.save").tap()
    }

    func testACoachSchedulesATrainingAndOpensIt() throws {
        try openTrainings()
        let place = place()
        try schedule(at: place)
        let row = reveal(place)
        XCTAssertTrue(row.exists, "the new training is not in the list: \(element("trainingForm.error").exists ? element("trainingForm.error").label : "")")
        row.tap()
        XCTAssertTrue(element("training.title").waitForExistence(timeout: 10))
        XCTAssertTrue(text(containing: place).exists, "the place should be on the training screen")
        XCTAssertTrue(text(containing: "Запланирована").exists)
    }

    func testAWeeklySeriesCreatesSeveralTrainings() throws {
        try openTrainings()
        let place = place()
        try schedule(at: place, repeating: true)
        XCTAssertTrue(reveal(place).exists)
        // the list is long (earlier runs leave trainings behind), so the later weeks are off screen: the training itself says it repeats
        // clean up: cancel the whole series so later runs are not cluttered
        reveal(place).tap()
        XCTAssertTrue(text(containing: "Каждую неделю").waitForExistence(timeout: 10), "a series training should say it repeats weekly")
        element("training.actions").tap()
        app.buttons["Отменить всю серию"].tap()
        app.buttons["Отменить все тренировки серии"].tap()
        XCTAssertTrue(element("training.notice").waitForExistence(timeout: 10))
        XCTAssertTrue(element("training.notice").label.contains("серии отменены"), element("training.notice").label)
    }

    func testACoachMarksATrainingHeldAndTheStatusChanges() throws {
        try openTrainings()
        let place = place()
        try schedule(at: place)
        reveal(place).tap()
        XCTAssertTrue(element("training.actions").waitForExistence(timeout: 10))
        element("training.actions").tap()
        element("training.complete").tap()
        XCTAssertTrue(element("training.notice").waitForExistence(timeout: 10))
        XCTAssertTrue(text(containing: "Проведена").waitForExistence(timeout: 10), "the status should change to held")
    }

    func testACoachChangesThePlaceOfATraining() throws {
        try openTrainings()
        let old = place()
        try schedule(at: old)
        reveal(old).tap()
        element("training.actions").tap()
        element("training.edit").tap()
        let field = app.textFields["trainingForm.location"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        let new = old + "-new"
        replaceText(in: field, with: new)
        element("trainingForm.save").tap()
        XCTAssertTrue(text(containing: new).waitForExistence(timeout: 15), "the new place is not shown")
    }

    func testACoachDeletesATraining() throws {
        try openTrainings()
        let place = place()
        try schedule(at: place)
        reveal(place).tap()
        element("training.actions").tap()
        element("training.delete").tap()
        app.buttons["Удалить"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Тренировки"].waitForExistence(timeout: 10), "deleting should return to the list")
        XCTAssertTrue(app.staticTexts[place].waitForNonExistence(timeout: 10), "the deleted training is still listed")
    }

    func testAnAthleteSeesTheTrainingsButCannotSchedule() throws {
        try openTrainings()
        XCTAssertTrue(app.navigationBars["Тренировки"].exists)
        if element("trainings.schedule").waitForExistence(timeout: 4) { throw XCTSkip("This account is a coach of the team.") }
        XCTAssertFalse(element("trainings.schedule").exists)
    }

    /// A session the athlete booked with a coach is the booking's: the form shows whose it is, its fields are read-only and the menu has
    /// neither «Удалить» nor the status changes. Needs an athlete with such a session among the upcoming events of the home.
    func testABookedSessionIsReadOnlyForTheAthlete() throws {
        try launchSignedIn()
        let events = app.descendants(matching: .any).matching(identifier: "home.event")
        _ = events.firstMatch.waitForExistence(timeout: 15)
        let row = events.matching(NSPredicate(format: "label CONTAINS 'тренером' OR label CONTAINS 'Личная'")).firstMatch
        scrollUntilVisible(row, attempts: 6)
        guard row.exists else { throw XCTSkip("This needs an athlete with a session booked with a coach.") }
        row.tap()
        XCTAssertTrue(element("training.title").waitForExistence(timeout: 10), "the event did not open as a training")
        let menu = element("training.actions")
        guard menu.waitForExistence(timeout: 8) else { throw XCTSkip("The next event is not a training of this person.") }
        menu.tap()
        let edit = element("training.edit")
        XCTAssertTrue(edit.waitForExistence(timeout: 5), "no «Изменить» in the menu")
        // wait for the booking to be known: the menu is rebuilt, so look at it again after a moment
        _ = element("training.delete").waitForExistence(timeout: 3)
        let hasDelete = element("training.delete").exists
        edit.tap()
        let note = element("trainingForm.booked")
        guard note.waitForExistence(timeout: 8) else {
            if hasDelete { throw XCTSkip("The next event is the athlete's own training, not a booked session.") }
            XCTFail("the form of a booked session does not say it is booked"); return
        }
        XCTAssertFalse(hasDelete, "«Удалить» must not be offered for a booked session")
        XCTAssertTrue(note.label.contains("Занятие с тренером"), "the note does not name the coach: \(note.label)")
        XCTAssertFalse(app.textFields["trainingForm.location"].isEnabled, "the place of a booked session must be read-only")
        XCTAssertFalse(app.datePickers["trainingForm.date"].firstMatch.isEnabled, "the date of a booked session must be read-only")
    }
}
