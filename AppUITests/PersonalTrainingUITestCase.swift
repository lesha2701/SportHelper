import XCTest

/// Steps shared by the tests of personal trainings: open the form from the calendar, fill it, save, find the new training, delete it.
class PersonalTrainingUITestCase: SignedInUITestCase {
    func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }
    func stamp() -> String { String(Int(Date().timeIntervalSince1970)) }

    func openForm() throws {
        try launchSignedIn()
        app.tabBars.buttons["Календарь"].tap()
        let add = element("calendar.addPersonal")
        XCTAssertTrue(add.waitForExistence(timeout: 10), "no button to add a personal training")
        add.tap()
        XCTAssertTrue(app.navigationBars["Моя тренировка"].waitForExistence(timeout: 10), "the form did not open")
    }

    func typeText(_ text: String, into field: XCUIElement) {
        scrollUntilVisible(field)
        field.tap()
        field.typeText(text)
        if element("keyboard.done").exists { element("keyboard.done").tap() }
    }

    func field(_ id: String, _ index: Int = 0) -> XCUIElement { app.textFields.matching(identifier: id).element(boundBy: index) }

    /// Saves the form and opens the new training from the calendar list: the one with the stamp in its description.
    func saveAndOpen(_ stamp: String) {
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

    func deleteOpenTraining() {
        element("training.actions").tap()
        element("training.delete").tap()
        app.buttons["Удалить"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Календарь"].waitForExistence(timeout: 10), "deleting should return to the calendar")
    }
}
