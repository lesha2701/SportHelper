import XCTest

/// A person's own training against the local server: made from the calendar, read back in the same words the site writes, held,
/// and deleted. Any account works (a coach has personal trainings too).
final class PersonalTrainingUITests: PersonalTrainingUITestCase {
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

        XCTAssertTrue(text(containing: "1. Приседания — 3 подх. × 15 повт.").exists, "the first exercise is not read as the site reads it")
        XCTAssertTrue(text(containing: "2. Бег — 3 км").exists, "the run is not read as a distance")
        XCTAssertTrue(text(containing: "Пометки: Заметка \(stamp)").exists)
        XCTAssertTrue(text(containing: "Личная тренировка").exists)
        deleteOpenTraining()
    }

    func testAnExerciseWithoutANameIsNamedInTheFormAndBlocksSaving() throws {
        try openForm()
        typeText("Приседания", into: field("personal.exercise"))
        scrollUntilVisible(element("personal.addRow"))
        element("personal.addRow").tap()
        // the new line is empty: the form says so under the field and does not let the training be created
        XCTAssertTrue(element("personal.exerciseError").waitForExistence(timeout: 5), "the empty exercise is not pointed out")
        XCTAssertFalse(element("personal.save").isEnabled, "a training with an unnamed exercise can be created")
        // an unwanted line is removed with its button, and the form is fine again
        element("personal.removeRow").firstMatch.tap()
        XCTAssertFalse(element("personal.exerciseError").exists)
        XCTAssertTrue(element("personal.save").isEnabled)
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

    func testTheDatePickerSpeaksRussian() throws {
        try openForm()
        let date = app.datePickers["trainingForm.date"].firstMatch
        scrollUntilVisible(date)
        // the compact picker shows the date itself: a Russian month, never an English one
        date.buttons.firstMatch.tap()
        let shown = app.descendants(matching: .any).allElementsBoundByIndex.prefix(150).map { "\($0.label)|\(($0.value as? String) ?? "")" }.joined(separator: " ; ")
        let months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря",
                      "янв", "февр", "мар", "апр", "июн", "июл", "авг", "сент", "окт", "нояб", "дек"]
        XCTAssertTrue(months.contains { shown.lowercased().contains($0) }, "the date is not in Russian: \(shown)")
        XCTAssertFalse(["January", "February", "March", "April", "May ", "June", "July", "August", "September", "October", "November", "December"]
            .contains { shown.contains($0) }, "an English month on the calendar: \(shown)")
    }
}
