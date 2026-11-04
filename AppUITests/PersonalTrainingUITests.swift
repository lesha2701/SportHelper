import XCTest

/// A person's own training against the local server: made from the calendar, read back in the same words the site writes, held,
/// and deleted. Any account works (a coach has personal trainings too).
final class PersonalTrainingUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }
    private func stamp() -> String { String(Int(Date().timeIntervalSince1970)) }

    private func openForm() throws {
        try launchSignedIn()
        app.tabBars.buttons["Календарь"].tap()
        let add = element("calendar.addPersonal")
        XCTAssertTrue(add.waitForExistence(timeout: 10), "no button to add a personal training")
        add.tap()
        XCTAssertTrue(app.navigationBars["Моя тренировка"].waitForExistence(timeout: 10), "the form did not open")
    }

    private func typeText(_ text: String, into field: XCUIElement) {
        scrollUntilVisible(field)
        field.tap()
        field.typeText(text)
        if element("keyboard.done").exists { element("keyboard.done").tap() }
    }

    private func field(_ id: String, _ index: Int = 0) -> XCUIElement { app.textFields.matching(identifier: id).element(boundBy: index) }

    /// Saves the form and opens the new training from the calendar list: the one with the stamp in its description.
    private func saveAndOpen(_ stamp: String) {
        element("personal.save").tap()
        XCTAssertTrue(app.navigationBars["Календарь"].waitForExistence(timeout: 15), "the form did not close: \(element("trainingForm.error").exists ? element("trainingForm.error").label : "")")
        // The list holds earlier trainings too and builds only the rows near the screen: the week is short, and today is in it.
        app.buttons["Неделя"].tap()
        let mine = NSPredicate(format: "label CONTAINS 'Личная тренировка' AND label CONTAINS '18:00'")
        let candidates = app.buttons.matching(identifier: "calendar.training").matching(mine)
        _ = candidates.firstMatch.waitForExistence(timeout: 15)
        scrollUntilVisible(candidates.firstMatch, attempts: 12)
        for index in 0..<min(candidates.count, 6) {
            candidates.element(boundBy: index).tap()
            if text(containing: stamp).waitForExistence(timeout: 4) { return }
            app.navigationBars.buttons.firstMatch.tap()
        }
        XCTFail("the new training is not in the calendar")
    }

    private func deleteOpenTraining() {
        element("training.actions").tap()
        element("training.delete").tap()
        app.buttons["Удалить"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Календарь"].waitForExistence(timeout: 10), "deleting should return to the calendar")
    }

    func testARepsTrainingIsWrittenLikeOnTheSiteAndCanBeDeleted() throws {
        try openForm()
        let stamp = stamp()
        typeText("Приседания", into: field("personal.exercise"))
        typeText("15", into: field("personal.reps"))
        typeText("3", into: field("personal.sets"))
        scrollUntilVisible(element("personal.addRow"))
        element("personal.addRow").tap()
        typeText("Бег", into: field("personal.exercise", 1))
        // «Бег» is a distance by its name: the meters field appears without choosing anything
        typeText("3000", into: field("personal.meters"))
        typeText("Заметка \(stamp)", into: field("personal.notes"))
        saveAndOpen(stamp)

        XCTAssertTrue(text(containing: "1. Приседания — 3 подх. x 15 повт.").exists, "the first exercise is not written as the site writes it")
        XCTAssertTrue(text(containing: "2. Бег — 3000 м").exists, "the run is not written as a distance")
        XCTAssertTrue(text(containing: "Пометки: Заметка \(stamp)").exists)
        XCTAssertTrue(text(containing: "Личная тренировка").exists)
        deleteOpenTraining()
    }

    func testACircuitKeepsItsRoundsAndRestAndCanBeHeld() throws {
        try openForm()
        let stamp = stamp()
        let style = app.segmentedControls["personal.style"]
        scrollUntilVisible(style)
        style.buttons["Круговая"].tap()
        typeText("Берпи", into: field("personal.exercise"))
        typeText("40", into: field("personal.seconds"))
        typeText("Круг \(stamp)", into: field("personal.notes"))
        saveAndOpen(stamp)

        XCTAssertTrue(text(containing: "1. Берпи — 40 сек").exists)
        XCTAssertTrue(text(containing: "Кругов: 3 · Отдых между подходами и кругами: 60 сек").exists, "the circuit's rounds and rest are not written")
        element("training.actions").tap()
        element("training.complete").tap()
        XCTAssertTrue(text(containing: "Проведена").waitForExistence(timeout: 10), "the status should change to held")
        deleteOpenTraining()
    }

    func testTheAssistantAnswersOrExplainsWhyNot() throws {
        try openForm()
        element("personal.aiOpen").tap()
        XCTAssertTrue(element("personal.aiRun").waitForExistence(timeout: 5))
        element("personal.aiRun").tap()
        // The local server has no AI keys, so the answer is an explanation, never the name of a server setting.
        let error = element("personal.aiError")
        XCTAssertTrue(error.waitForExistence(timeout: 60), "neither a suggestion nor an explanation")
        XCTAssertFalse(error.label.contains("YANDEX"), "a server setting is shown to the person: \(error.label)")
    }
}
