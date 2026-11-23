import XCTest

/// «Подобрать тренера» against the local server: the form needs only the sport, the sent request appears in the person's list, and an open
/// one can be withdrawn. It withdraws what it sent, so it can run any number of times.
final class MatchRequestUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func openForm() throws {
        try launchSignedIn()
        app.mainTabBar.buttons["Тренеры"].tap()
        let mode = app.segmentedControls["coaches.mode"]
        XCTAssertTrue(mode.waitForExistence(timeout: 15), "the Trainers tab has no switch between the catalogue and the form")
        mode.buttons["Подобрать тренера"].tap()
        XCTAssertTrue(app.textFields["match.sport"].waitForExistence(timeout: 10), "the form did not open")
    }

    func testTheFormNeedsOnlyTheSportAndTheRequestCanBeWithdrawn() throws {
        try openForm()
        let send = app.buttons["match.send"]
        scrollUntilVisible(send)
        XCTAssertFalse(send.isEnabled, "nothing should be sent without the sport")

        app.swipeDown()
        let sport = app.textFields["match.sport"]
        scrollUntilVisible(sport)
        sport.tap()
        sport.typeText("Теннис")
        for chip in ["Любитель", "Вт", "Вечер"] {
            let button = app.buttons["match.chip.\(chip)"]
            scrollUntilVisible(button)
            button.tap()
        }
        scrollUntilVisible(send)
        XCTAssertTrue(send.isEnabled, "the sport alone is enough")
        send.tap()

        XCTAssertTrue(element("match.sent").waitForExistence(timeout: 15), "the request was not accepted: \(element("match.error").exists ? element("match.error").label : "no message")")
        let status = element("match.status")
        XCTAssertTrue(status.waitForExistence(timeout: 10), "the new request should be in the list")
        XCTAssertEqual(status.label, "Отправлена")

        let withdraw = app.buttons["match.withdraw"].firstMatch
        scrollUntilVisible(withdraw)
        withdraw.tap()
        let withdrawn = app.staticTexts.matching(NSPredicate(format: "label == 'Отозвана'")).firstMatch
        XCTAssertTrue(withdrawn.waitForExistence(timeout: 10), "a withdrawn request should say so")
    }
}
