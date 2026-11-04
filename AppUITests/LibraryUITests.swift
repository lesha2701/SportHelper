import XCTest

/// The coach's library (exercises, plans, task templates) and what a team reads of it, against the local server. The coach tests need
/// a coach account with a coach profile (SAG_TEAM_NAME picks the team); the player test needs SAG_EXERCISE / SAG_PLAN, an exercise and a
/// plan the coach has opened to the team.
final class LibraryUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }
    private var env: [String: String] { ProcessInfo.processInfo.environment }
    private func stamp() -> String { String(Int(Date().timeIntervalSince1970)) }

    private func openLibrary(_ section: String? = nil) throws {
        try launchSignedIn()
        let tab = app.tabBars.buttons["Библиотека"]
        guard tab.waitForExistence(timeout: 8) else { throw XCTSkip("The library is for a coach.") }
        tab.tap()
        XCTAssertTrue(app.navigationBars["Библиотека"].waitForExistence(timeout: 10))
        if let section { chooseSection(section) }
    }

    private func chooseSection(_ section: String) {
        let button = app.segmentedControls.buttons[section]
        XCTAssertTrue(button.waitForExistence(timeout: 10), "no section «\(section)»")
        button.tap()
    }

    /// The list builds only the rows near the screen: scroll until the text is on screen.
    private func reveal(_ title: String) -> XCUIElement {
        let row = app.staticTexts[title].firstMatch
        _ = row.waitForExistence(timeout: 15)
        scrollUntilVisible(row, attempts: 20)
        return row
    }

    private func type(_ text: String, into id: String) {
        let field = app.textFields[id]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "no field \(id)")
        field.tap()
        field.typeText(text + "\n")  // the return key closes the keyboard, which would cover the rest of the form
    }

    private func createExercise(_ name: String) {
        element("library.add").tap()
        type(name, into: "exerciseForm.name")
        XCTAssertTrue(element("exerciseForm.save").isEnabled, "a coach's own sport should be filled in; the form says: \(element("exerciseForm.error").exists ? element("exerciseForm.error").label : "-")")
        element("exerciseForm.save").tap()
        XCTAssertTrue(reveal(name).exists, "the new exercise is not in the list")
    }

    private func confirmDelete() {
        app.buttons["Удалить"].tap()
        app.buttons["Удалить"].tap()  // the confirmation
    }

    func testACoachAddsAnExerciseOpensItToATeamAndDeletesIt() throws {
        try openLibrary()
        let name = "Тест-упражнение \(stamp())"
        createExercise(name)
        reveal(name).tap()
        XCTAssertTrue(element("exercise.name").waitForExistence(timeout: 10))
        XCTAssertEqual(element("exercise.name").label, name)

        let toggle = app.switches["share.team"].firstMatch
        scrollUntilVisible(toggle)
        if toggle.exists {
            toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
            let on = NSPredicate(format: "value == '1'")
            XCTAssertTrue(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: on, object: toggle)], timeout: 10) == .completed, "the exercise should be open to the team")
        }
        element("exercise.actions").tap()
        confirmDeleteFromMenu()
        XCTAssertTrue(app.navigationBars["Библиотека"].waitForExistence(timeout: 10), "deleting should go back to the library")
        XCTAssertFalse(app.staticTexts[name].waitForExistence(timeout: 3), "the deleted exercise is still listed")
    }

    private func confirmDeleteFromMenu() { confirmDelete() }

    func testACoachBuildsAPlanFromExercisesCopiesItAndDeletesBoth() throws {
        try openLibrary()
        let exercise = "Тест-упражнение \(stamp())"
        createExercise(exercise)
        chooseSection("Планы")
        let plan = "Тест-план \(stamp())"
        element("library.add").tap()
        type(plan, into: "planForm.name")
        XCTAssertTrue(element("planForm.save").isEnabled, "the sport should be filled in")
        element("planForm.save").tap()
        reveal(plan).tap()
        XCTAssertTrue(element("plan.name").waitForExistence(timeout: 10))

        let add = element("plan.add.main")
        scrollUntilVisible(add)
        add.tap()
        XCTAssertTrue(element("planItem.save").waitForExistence(timeout: 10))
        XCTAssertTrue(element("planItem.save").isEnabled, "an exercise is chosen from the library")
        element("planItem.save").tap()
        XCTAssertTrue(element("plan.item").waitForExistence(timeout: 10), "the exercise should be in the plan")

        element("plan.actions").tap()
        app.buttons["Сделать копию"].tap()
        XCTAssertTrue(element("plan.notice").waitForExistence(timeout: 10))
        XCTAssertTrue(element("plan.notice").label.contains("Копия"), element("plan.notice").label)

        element("plan.actions").tap()
        confirmDelete()
        XCTAssertTrue(app.navigationBars["Библиотека"].waitForExistence(timeout: 10))
        // the copy is named «… (копия)»
        let copy = reveal("\(plan) (копия)")
        XCTAssertTrue(copy.exists, "the copy is not in the list")
        copy.tap()
        XCTAssertTrue(element("plan.actions").waitForExistence(timeout: 10))
        element("plan.actions").tap()
        confirmDelete()
        XCTAssertTrue(app.navigationBars["Библиотека"].waitForExistence(timeout: 10))
        chooseSection("Упражнения")
        reveal(exercise).tap()
        element("exercise.actions").tap()
        confirmDelete()
        XCTAssertFalse(app.staticTexts[exercise].waitForExistence(timeout: 3))
    }

    func testATemplateIsKeptAndOffersItselfWhenGivingATask() throws {
        try openLibrary("Задания")
        let name = "Тест-шаблон \(stamp())"
        element("library.add").tap()
        type(name, into: "taskForm.title")
        element("taskForm.save").tap()
        XCTAssertTrue(reveal(name).exists, "the new template is not in the list")

        app.tabBars.buttons["Команды"].tap()
        if let team = env["SAG_TEAM_NAME"] {
            XCTAssertTrue(app.staticTexts[team].waitForExistence(timeout: 15))
            app.staticTexts[team].tap()
        } else {
            XCTAssertTrue(app.buttons["teams.team"].firstMatch.waitForExistence(timeout: 15))
            app.buttons["teams.team"].firstMatch.tap()
        }
        XCTAssertTrue(element("team.tasks").waitForExistence(timeout: 15))
        element("team.tasks").tap()
        element("tasks.add").tap()
        let picker = element("taskForm.template")
        XCTAssertTrue(picker.waitForExistence(timeout: 10), "a saved template should be offered")
        picker.tap()
        app.buttons[name].firstMatch.tap()
        let title = app.textFields["taskForm.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertEqual(title.value as? String, name, "the form should be filled in from the template")
        app.buttons["Отмена"].tap()

        app.tabBars.buttons["Библиотека"].tap()
        reveal(name).tap()
        XCTAssertTrue(element("template.title").waitForExistence(timeout: 10))
        element("template.actions").tap()
        confirmDelete()
        XCTAssertTrue(app.navigationBars["Библиотека"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts[name].waitForExistence(timeout: 3), "the deleted template is still listed")
    }

    func testAPlayerReadsWhatTheCoachOpenedToTheTeamAndHasNoLibraryTab() throws {
        guard let exercise = env["SAG_EXERCISE"], let plan = env["SAG_PLAN"] else { throw XCTSkip("Set TEST_RUNNER_SAG_EXERCISE and TEST_RUNNER_SAG_PLAN.") }
        try launchSignedIn()
        if app.tabBars.buttons["Библиотека"].waitForExistence(timeout: 4) { throw XCTSkip("This needs a player, the account is a coach.") }
        app.tabBars.buttons["Команды"].tap()
        if let team = env["SAG_TEAM_NAME"] {
            XCTAssertTrue(app.staticTexts[team].waitForExistence(timeout: 15))
            app.staticTexts[team].tap()
        } else {
            XCTAssertTrue(app.buttons["teams.team"].firstMatch.waitForExistence(timeout: 15))
            app.buttons["teams.team"].firstMatch.tap()
        }
        XCTAssertTrue(element("team.library").waitForExistence(timeout: 15))
        element("team.library").tap()
        XCTAssertTrue(reveal(exercise).exists, "the exercise opened to the team should be listed")
        reveal(exercise).tap()
        XCTAssertTrue(element("exercise.name").waitForExistence(timeout: 10))
        XCTAssertFalse(element("exercise.actions").exists, "a player cannot change it")
        app.navigationBars.buttons.firstMatch.tap()
        chooseSection("Планы")
        XCTAssertTrue(reveal(plan).exists, "the plan opened to the team should be listed")
        reveal(plan).tap()
        XCTAssertTrue(element("plan.name").waitForExistence(timeout: 10))
        XCTAssertTrue(text(containing: "3 × 10").waitForExistence(timeout: 5), "the plan should show how the exercise is done")
        XCTAssertFalse(element("plan.actions").exists || element("plan.add.main").exists)
    }
}
