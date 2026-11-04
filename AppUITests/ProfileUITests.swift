import XCTest

/// The tabs and the profile, for the coach test account the local scenario creates (Анна Тренер, большой теннис, 7 лет опыта).
final class ProfileUITests: SignedInUITestCase {
    func testTheSameFiveSectionsAsTheSiteAreThere() throws {
        try launchSignedIn()
        for title in ["Главная", "Команды", "Календарь", "Тренеры", "Профиль"] {
            XCTAssertTrue(app.tabBars.buttons[title].exists, "no «\(title)» tab")
        }
    }

    func testTheProfileShowsWhoIsSignedInAndTheirDetails() throws {
        try launchSignedIn()
        profileTab.tap()

        XCTAssertTrue(app.staticTexts["Анна Тренер"].waitForExistence(timeout: 10), "the name should be shown")
        XCTAssertTrue(app.staticTexts["Тренер"].exists, "the role should be shown")
        XCTAssertTrue(text(containing: "Большой теннис").exists, "the sport should be shown")
        XCTAssertTrue(text(containing: "7 лет").exists, "the experience should agree with the number in Russian")
        XCTAssertTrue(app.buttons["profile.edit"].exists)
    }

    func testEditingTheProfileSavesTheChange() throws {
        try launchSignedIn()
        profileTab.tap()
        app.buttons["profile.edit"].tap()

        let about = app.textFields["edit.about"]
        XCTAssertTrue(about.waitForExistence(timeout: 10), "the edit form did not open")
        let note = "Проверка \(Int(Date().timeIntervalSince1970) % 100_000)"
        replaceText(in: about, with: note)
        app.buttons["edit.save"].tap()

        XCTAssertTrue(text(containing: note).waitForExistence(timeout: 10), "the saved text should appear on the profile")
        // The text was REPLACED: only the new note is there, not the notes of earlier runs or the original text.
        let shown = text(containing: note).label
        XCTAssertEqual(shown.components(separatedBy: "Проверка").count - 1, 1, "old text was kept: \(shown)")
        XCTAssertFalse(shown.contains("Работаю"), "old text was kept: \(shown)")
        XCTAssertFalse(app.textFields["edit.about"].exists, "the form should close after saving")
    }

    func testTheFormRefusesAnImpossibleValueWithoutLeaving() throws {
        try launchSignedIn()
        profileTab.tap()
        app.buttons["profile.edit"].tap()

        let experience = app.textFields["edit.experience"]
        XCTAssertTrue(experience.waitForExistence(timeout: 10))
        replaceText(in: experience, with: "99")
        app.buttons["edit.save"].tap()

        let error = app.staticTexts["edit.error"]
        XCTAssertTrue(error.waitForExistence(timeout: 5), "no message shown")
        XCTAssertTrue(error.label.contains("Опыт"), "unexpected message: \(error.label)")
        XCTAssertTrue(app.textFields["edit.experience"].exists, "the form should stay open")
    }
}
