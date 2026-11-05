import XCTest

/// A plan for a booking's session and for a team training, against the local server. Needs a coach with a plan in the library
/// (the tests use the first one of the list) and, for the booking, a confirmed session that is not held yet.
final class PlanChoiceUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }
    private func stamp() -> String { String(Int(Date().timeIntervalSince1970)) }

    func testACoachChoosesAPlanForABookedSessionAndTakesItOff() throws {
        try launchSignedIn()
        profileTab.tap()
        let coachBookings = app.buttons["profile.coachBookings"]
        var swipes = 0
        while !coachBookings.isHittable, swipes < 8 { app.swipeUp(); swipes += 1 }
        guard coachBookings.isHittable else { throw XCTSkip("This needs a coach.") }
        coachBookings.tap()

        let plan = element("booking.plan")
        scrollUntilVisible(plan, attempts: 6)
        guard plan.waitForExistence(timeout: 15) else { throw XCTSkip("No confirmed session that is not held yet.") }
        guard plan.isEnabled else { throw XCTSkip("The coach has no plan in the library.") }
        let before = plan.label
        plan.tap()
        // the menu lists «Без плана» and the coach's plans: take the first plan
        let options = app.buttons.matching(NSPredicate(format: "label != %@ AND label != %@", "Без плана", before))
        let choice = options.matching(NSPredicate(format: "label == %@", "План iOS")).firstMatch
        XCTAssertTrue(choice.waitForExistence(timeout: 5), "the plan «План iOS» is not offered")
        choice.tap()
        let chosen = NSPredicate(format: "label == %@", "План: План iOS")
        XCTAssertEqual(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: chosen, object: plan)], timeout: 10), .completed,
                       "the plan was not shown on the session: \(plan.label)")

        plan.tap()
        app.buttons["Без плана"].tap()
        let off = NSPredicate(format: "label == %@", "Выбрать план тренировки")
        XCTAssertEqual(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: off, object: plan)], timeout: 10), .completed,
                       "the plan was not taken off: \(plan.label)")
    }

    func testATrainingScheduledWithAPlanShowsItAndTheCoachCanTakeItOff() throws {
        try launchSignedIn()
        app.mainTabBar.buttons["Команды"].tap()
        if let name = ProcessInfo.processInfo.environment["SAG_TEAM_NAME"] {
            let row = app.staticTexts[name]
            XCTAssertTrue(row.waitForExistence(timeout: 15))
            row.tap()
        } else {
            let row = app.buttons["teams.team"].firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 15))
            row.tap()
        }
        guard element("team.trainings").waitForExistence(timeout: 15), element("team.edit").waitForExistence(timeout: 5) else {
            throw XCTSkip("This needs a coach of the team.")
        }
        element("team.trainings").tap()
        element("trainings.schedule").tap()
        let place = "Корт-\(stamp())"
        let location = app.textFields["trainingForm.location"]
        XCTAssertTrue(location.waitForExistence(timeout: 10))
        location.tap()
        location.typeText(place + "\n")
        let picker = element("trainingForm.plan")
        scrollUntilVisible(picker)
        guard picker.waitForExistence(timeout: 5) else { throw XCTSkip("The coach has no plan in the library.") }
        picker.tap()
        let choice = app.buttons.matching(NSPredicate(format: "label == %@", "План iOS")).firstMatch
        XCTAssertTrue(choice.waitForExistence(timeout: 5), "the plan «План iOS» is not offered")
        choice.tap()
        element("trainingForm.save").tap()

        let row = app.staticTexts[place].firstMatch
        _ = row.waitForExistence(timeout: 15)
        scrollUntilVisible(row, attempts: 20)
        row.tap()
        XCTAssertTrue(element("training.plan").waitForExistence(timeout: 10), "the training does not show its plan")
        XCTAssertTrue(element("training.plan").label.contains("План iOS"), element("training.plan").label)

        // the plan opens
        element("training.plan").tap()
        XCTAssertTrue(element("plan.name").waitForExistence(timeout: 10))
        XCTAssertEqual(element("plan.name").label, "План iOS")
        app.navigationBars.buttons.firstMatch.tap()

        // clean up
        element("training.actions").tap()
        element("training.delete").tap()
        app.buttons["Удалить"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Тренировки"].waitForExistence(timeout: 10))
    }
}
