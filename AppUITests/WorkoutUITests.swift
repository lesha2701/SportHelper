import XCTest

/// The guided workout of a personal training against the local server: made in the form, done set by set, saved with the training,
/// read back, and deleted. Any account works.
final class WorkoutUITests: PersonalTrainingUITestCase {
    private func button(_ id: String) -> XCUIElement { app.buttons[id].firstMatch }

    /// A training of two exercises: «Жим» 2 sets of 10 repetitions, and «Планка» (timed) 1 set of 20 seconds.
    private func makeTraining(_ stamp: String) throws {
        try openForm()
        typeText("Жим", into: field("personal.exercise"))
        typeText("10", into: field("personal.reps"))
        typeText("2", into: field("personal.sets"))
        scrollUntilVisible(element("personal.addRow"))
        element("personal.addRow").tap()
        typeText("Планка", into: field("personal.exercise", 1))
        typeText("20", into: field("personal.seconds"))
        typeText("1", into: field("personal.sets", 1))
        typeText("Тренировка \(stamp)", into: field("personal.notes"))
        saveAndOpen(stamp)
    }

    private func startWorkout() {
        scrollUntilVisible(button("training.startWorkout"))
        button("training.startWorkout").tap()
        XCTAssertTrue(element("workout.exercise").waitForExistence(timeout: 10), "the workout did not open")
    }

    /// The label of a button changes a moment after a screen above it closes: wait for it instead of reading it at once.
    private func waitForLabel(of element: XCUIElement, toContain text: String, timeout: TimeInterval = 8) -> Bool {
        let predicate = NSPredicate(format: "label CONTAINS %@", text)
        return XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: element)], timeout: timeout) == .completed
    }

    private func typeNumber(_ value: String, into field: XCUIElement) {
        field.tap()
        field.typeText(value)
        if button("workout.keyboardDone").waitForExistence(timeout: 2) { button("workout.keyboardDone").tap() }
    }

    func testAWorkoutIsDoneSavedAndReadBackOnTheTraining() throws {
        let stamp = stamp()
        try makeTraining(stamp)
        XCTAssertTrue(text(containing: "1. Жим — 2 подх. × 10 повт.").exists, "the plan is not read as the site reads it")
        XCTAssertTrue(text(containing: "2. Планка — 1 подх. × 0:20").exists)

        startWorkout()
        XCTAssertEqual(element("workout.exercise").label, "Жим")
        XCTAssertTrue(text(containing: "План: 2 подх. × 10 повт.").exists)
        XCTAssertTrue(element("workout.progress").label.contains("подходов 0 из 3"), "progress: \(element("workout.progress").label)")

        // the weight typed once carries over to the next set
        typeNumber("20", into: app.textFields["workout.weight.0"])
        button("workout.done.0").tap()
        XCTAssertTrue(element("workout.restBar").waitForExistence(timeout: 5), "a rest should start after a set")
        button("workout.restSkip").tap()
        XCTAssertFalse(element("workout.restBar").exists)
        XCTAssertEqual(app.textFields["workout.weight.1"].value as? String, "20", "the weight did not carry over to the next set")
        button("workout.done.1").tap()
        // two of three sets are done and the plank is still ahead: the rest starts again
        XCTAssertTrue(element("workout.restBar").waitForExistence(timeout: 5))
        XCTAssertTrue(element("workout.progress").label.contains("подходов 2 из 3"), "progress: \(element("workout.progress").label)")

        // the next exercise is timed: the time is stepped by five seconds, and the last set needs no rest
        button("workout.next").tap()
        XCTAssertEqual(element("workout.exercise").label, "Планка")
        XCTAssertFalse(element("workout.restBar").exists, "the rest belonged to the exercise just left")
        app.buttons["Больше времени"].firstMatch.tap()
        XCTAssertEqual(element("workout.time.0").label, "Время, подход 1")
        XCTAssertEqual(element("workout.time.0").value as? String, "0:25", "20 seconds and one step of five make 0:25")
        button("workout.done.0").tap()
        XCTAssertFalse(element("workout.restBar").waitForExistence(timeout: 1), "the last set of the workout needs no rest")

        button("workout.finishLast").tap()
        XCTAssertTrue(button("workout.save").waitForExistence(timeout: 5), "no summary")
        let recap = app.descendants(matching: .any).matching(identifier: "workout.recap")
        XCTAssertEqual(recap.count, 2)
        XCTAssertTrue(recap.element(boundBy: 0).label.contains("10 × 20 кг, 10 × 20 кг"), "the first exercise: \(recap.element(boundBy: 0).label)")
        XCTAssertTrue(recap.element(boundBy: 1).label.contains("0:25"), "the plank: \(recap.element(boundBy: 1).label)")
        button("workout.save").tap()
        let problem = element("workout.error").exists ? element("workout.error").label : ""
        XCTAssertTrue(text(containing: "Тренировка записана").waitForExistence(timeout: 15), "the result was not saved: \(problem)")
        button("workout.done").tap()

        // on the training: the result, and the plan is marked as held
        XCTAssertTrue(element("training.workoutSummary").waitForExistence(timeout: 10), "no result on the training")
        XCTAssertTrue(element("training.workoutSummary").label.contains("3 из 3 подходов"), element("training.workoutSummary").label)
        XCTAssertTrue(element("training.workoutSummary").label.contains("400 кг тоннаж"), element("training.workoutSummary").label)
        XCTAssertTrue(text(containing: "Проведена").waitForExistence(timeout: 10), "doing the workout should mark the training as held")
        XCTAssertTrue(waitForLabel(of: button("training.startWorkout"), toContain: "Тренироваться снова"), button("training.startWorkout").label)
        deleteOpenTraining()
    }

    func testAnUnfinishedWorkoutIsKeptAndContinued() throws {
        let stamp = stamp()
        try makeTraining(stamp)
        startWorkout()
        button("workout.done.0").tap()
        button("workout.close").tap()
        button("workout.leave.keep").tap()
        XCTAssertTrue(button("training.startWorkout").waitForExistence(timeout: 5))
        XCTAssertTrue(waitForLabel(of: button("training.startWorkout"), toContain: "Продолжить тренировку"), button("training.startWorkout").label)

        button("training.startWorkout").tap()
        XCTAssertTrue(element("workout.progress").waitForExistence(timeout: 10))
        XCTAssertTrue(element("workout.progress").label.contains("подходов 1 из 3"), "the set done before was lost: \(element("workout.progress").label)")

        // leave and throw it away: the training starts afresh next time
        button("workout.close").tap()
        button("workout.leave.discard").tap()
        XCTAssertTrue(button("training.startWorkout").waitForExistence(timeout: 5))
        XCTAssertTrue(waitForLabel(of: button("training.startWorkout"), toContain: "Начать тренировку"), button("training.startWorkout").label)
        deleteOpenTraining()
    }

    func testAWorkoutWithNothingDoneCannotBeSaved() throws {
        let stamp = stamp()
        try makeTraining(stamp)
        startWorkout()
        button("workout.finish").tap()
        XCTAssertTrue(button("workout.save").waitForExistence(timeout: 5))
        XCTAssertFalse(button("workout.save").isEnabled, "nothing is done, so there is nothing to save")
        button("workout.discard").tap()
        button("workout.discard.confirm").tap()
        XCTAssertTrue(button("training.startWorkout").waitForExistence(timeout: 5))
        deleteOpenTraining()
    }

    func testADistanceTakesTypedMetersAndTime() throws {
        let stamp = stamp()
        try openForm()
        typeText("Бег", into: field("personal.exercise"))
        typeText("3000", into: field("personal.meters"))
        typeText("Бег \(stamp)", into: field("personal.notes"))
        saveAndOpen(stamp)

        startWorkout()
        XCTAssertTrue(text(containing: "План: 3 км").exists, "the plan is not said in kilometers")
        XCTAssertEqual(app.textFields["workout.meters.0"].value as? String, "3000", "the distance should start at the plan, without a thousands separator")
        // a double tap selects the number (the field is too narrow to put the cursor at its end), and typing replaces it
        app.textFields["workout.meters.0"].doubleTap()
        app.textFields["workout.meters.0"].typeText("2500")
        if button("workout.keyboardDone").waitForExistence(timeout: 2) { button("workout.keyboardDone").tap() }
        typeNumber("12:30", into: app.textFields["workout.seconds.0"])
        button("workout.done.0").tap()
        XCTAssertEqual(app.textFields["workout.meters.0"].value as? String, "2500")
        XCTAssertEqual(app.textFields["workout.seconds.0"].value as? String, "12:30")

        button("workout.finishLast").tap()
        let recap = app.descendants(matching: .any).matching(identifier: "workout.recap").element(boundBy: 0)
        XCTAssertTrue(recap.waitForExistence(timeout: 5))
        XCTAssertTrue(recap.label.contains("2,5 км за 12:30"), "the run: \(recap.label)")
        button("workout.discard").tap()
        button("workout.discard.confirm").tap()
        XCTAssertTrue(button("training.startWorkout").waitForExistence(timeout: 5))
        deleteOpenTraining()
    }

    func testACircuitRunsOnTheClockAndSkipsToTheEnd() throws {
        try openForm()
        let stamp = stamp()
        let style = app.segmentedControls["personal.style"]
        scrollUntilVisible(style)
        style.buttons["Круговая"].tap()
        typeText("Берпи", into: field("personal.exercise"))
        typeText("30", into: field("personal.seconds"))
        typeText("Круг \(stamp)", into: field("personal.notes"))
        saveAndOpen(stamp)

        scrollUntilVisible(button("training.startWorkout"))
        button("training.startWorkout").tap()
        XCTAssertTrue(element("circuit.exercise").waitForExistence(timeout: 10), "the circuit did not start")
        XCTAssertEqual(element("circuit.exercise").label, "Берпи")
        XCTAssertTrue(text(containing: "Круг 1 из 3").exists)
        button("circuit.pause").tap()
        XCTAssertTrue(button("circuit.pause").label.contains("Продолжить"))
        let frozen = element("circuit.seconds").label
        sleep(2)
        XCTAssertEqual(element("circuit.seconds").label, frozen, "the clock runs while paused")
        button("circuit.pause").tap()

        // exercise, rest, exercise, rest, exercise: five steps
        button("circuit.skip").tap()
        XCTAssertTrue(element("circuit.rest").waitForExistence(timeout: 5), "a rest should follow the exercise")
        for _ in 0..<4 { button("circuit.skip").tap() }
        XCTAssertTrue(button("circuit.done").waitForExistence(timeout: 5), "the circuit did not finish")
        button("circuit.done").tap()
        XCTAssertTrue(button("training.startWorkout").waitForExistence(timeout: 5))
        deleteOpenTraining()
    }
}
