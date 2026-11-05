import XCTest

/// A video handed in with a task and played back, against the local server (which has a pretend disk). The player test needs a task that
/// asks for a video: TEST_RUNNER_SAG_VIDEO_TASK. The simulator needs a video in its photo library (`xcrun simctl addmedia`).
final class VideoUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }
    private var env: [String: String] { ProcessInfo.processInfo.environment }

    /// Picks the first video of the photo library in the system picker.
    func pickFirstVideo(from picker: XCUIElement) {
        XCTAssertTrue(picker.waitForExistence(timeout: 10), "the picker button is missing")
        picker.tap()
        // the system picker lists the library as grid cells; the first one that is a video (its label starts with «Видео» or «Video»)
        let video = app.images.matching(NSPredicate(format: "identifier == 'PXGGridLayout-Info' AND (label BEGINSWITH 'Видео' OR label BEGINSWITH 'Video')")).firstMatch
        XCTAssertTrue(video.waitForExistence(timeout: 15), "no video in the photo library")
        video.tap()
    }

    func testAPlayerHandsInAVideoAndPlaysItBack() throws {
        guard let title = env["SAG_VIDEO_TASK"] else { throw XCTSkip("Set TEST_RUNNER_SAG_VIDEO_TASK (a task that asks for a video).") }
        try launchSignedIn()
        profileTab.tap()
        scrollUntilVisible(element("profile.myTasks"))
        element("profile.myTasks").tap()
        let row = app.staticTexts[title].firstMatch
        _ = row.waitForExistence(timeout: 15)
        scrollUntilVisible(row, attempts: 20)
        row.tap()
        XCTAssertTrue(element("task.status").waitForExistence(timeout: 10))
        if element("task.start").waitForExistence(timeout: 3) { element("task.start").tap() }  // a task begun in an earlier run is already going
        XCTAssertTrue(element("task.submit").waitForExistence(timeout: 10))
        element("task.submit").tap()

        XCTAssertTrue(element("submit.video").waitForExistence(timeout: 10), "the task asks for a video, the form must offer it")
        XCTAssertFalse(element("submit.send").isEnabled, "the video is still missing")
        pickFirstVideo(from: element("submit.video"))
        XCTAssertTrue(element("video.picked").waitForExistence(timeout: 60), "the picked video was not prepared: \(element("submit.error").exists ? element("submit.error").label : "")")
        XCTAssertTrue(element("video.picked").label.contains("МБ"), element("video.picked").label)
        XCTAssertTrue(element("submit.send").isEnabled, "the video is all the task asks for")
        element("submit.send").tap()

        let status = element("task.status")
        let waiting = NSPredicate(format: "label CONTAINS %@", "Ждёт проверки")
        XCTAssertEqual(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: waiting, object: status)], timeout: 60), .completed,
                       "the task should wait for the coach: \(status.label) \(element("submit.error").exists ? element("submit.error").label : "")")

        // the video plays back from the server
        scrollUntilVisible(element("video.watch"))
        element("video.watch").tap()
        XCTAssertTrue(element("video.close").waitForExistence(timeout: 20), "the player did not open")
        XCTAssertFalse(element("video.failed").waitForExistence(timeout: 6), "the video could not be loaded")
        element("video.close").tap()
        XCTAssertTrue(element("video.watch").waitForExistence(timeout: 5))
    }

    /// A coach shows an exercise on video: picked in the form, uploaded after the exercise is saved, played from the exercise, and gone with it.
    func testACoachAttachesAVideoToAnExerciseAndPlaysIt() throws {
        try launchSignedIn()
        let tab = app.tabBars.buttons["Библиотека"]
        guard tab.waitForExistence(timeout: 8) else { throw XCTSkip("The library is for a coach.") }
        tab.tap()
        XCTAssertTrue(app.navigationBars["Библиотека"].waitForExistence(timeout: 10))
        element("library.add").tap()

        let name = "Видео-упражнение \(Int(Date().timeIntervalSince1970))"
        let field = app.textFields["exerciseForm.name"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText(name + "\n")
        scrollUntilVisible(element("exerciseForm.video"))
        pickFirstVideo(from: element("exerciseForm.video"))
        XCTAssertTrue(element("video.picked").waitForExistence(timeout: 60), "the picked video was not prepared")
        XCTAssertTrue(element("video.picked").label.contains("МБ"), element("video.picked").label)
        XCTAssertTrue(element("exerciseForm.save").isEnabled, "the form says: \(element("exerciseForm.error").exists ? element("exerciseForm.error").label : "-")")
        element("exerciseForm.save").tap()

        let row = app.staticTexts[name].firstMatch
        _ = row.waitForExistence(timeout: 30)
        scrollUntilVisible(row, attempts: 20)
        row.tap()
        XCTAssertTrue(element("exercise.name").waitForExistence(timeout: 10))
        XCTAssertFalse(element("exercise.notice").exists, "the video was not attached: \(element("exercise.notice").exists ? element("exercise.notice").label : "")")
        scrollUntilVisible(element("video.watch"))
        element("video.watch").tap()
        XCTAssertTrue(element("video.close").waitForExistence(timeout: 20), "the player did not open")
        XCTAssertFalse(element("video.failed").waitForExistence(timeout: 6), "the video could not be loaded")
        element("video.close").tap()

        // the exercise goes, and with it the test's leftovers
        element("exercise.actions").tap()
        app.buttons["Удалить"].tap()
        app.buttons["Удалить"].tap()
        XCTAssertTrue(app.navigationBars["Библиотека"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts[name].waitForExistence(timeout: 3), "the deleted exercise is still listed")
    }
}
