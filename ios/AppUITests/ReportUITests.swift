import XCTest

/// «Пожаловаться» against the local server: on a coach's listing (an athlete's account) and on a member of a team (a coach's account;
/// the team's name is SAG_TEAM_NAME). The server answers a second complaint about the same thing with «уже отправили», which is as good
/// as a first one for what is checked here: the person is told the outcome in words.
final class ReportUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    /// The dialog ends in either the thanks or the server's explanation (an earlier complaint of this test run is still open).
    private func assertOutcomeIsTold() {
        let done = element("report.done")
        let refused = element("report.error")
        let seen = done.waitForExistence(timeout: 15) || refused.waitForExistence(timeout: 2)
        XCTAssertTrue(seen, "the person is told nothing")
        if refused.exists, !done.exists {
            XCTAssertTrue(refused.label.contains("уже отправили") || refused.label.contains("нерассмотренных"), "unexpected refusal: \(refused.label)")
        }
    }

    func testAListingCanBeReportedWithAReason() throws {
        try launchSignedIn()
        profileTab.tap()
        guard app.buttons["profile.myBookings"].waitForExistence(timeout: 10) else { throw XCTSkip("This test needs an athlete account.") }
        app.mainTabBar.buttons["Тренеры"].tap()
        let listing = app.buttons["coaches.listing"].firstMatch
        XCTAssertTrue(listing.waitForExistence(timeout: 15), "no coach listing in the catalogue")
        listing.tap()

        let more = element("listing.more")
        XCTAssertTrue(more.waitForExistence(timeout: 15), "no menu on the listing")
        more.tap()
        let report = element("listing.report")
        XCTAssertTrue(report.waitForExistence(timeout: 5), "no «Пожаловаться на объявление»")
        report.tap()

        XCTAssertTrue(element("report.reason.spam").waitForExistence(timeout: 5), "the dialog did not open")
        XCTAssertFalse(element("report.send").isEnabled, "nothing can be sent before a reason is chosen")
        element("report.reason.spam").tap()
        XCTAssertTrue(element("report.send").isEnabled)
        element("report.send").tap()
        assertOutcomeIsTold()
    }

    func testAMemberOfTheTeamCanBeReportedAndOtherNeedsWords() throws {
        try launchSignedIn()
        app.mainTabBar.buttons["Команды"].tap()
        if let name = ProcessInfo.processInfo.environment["SAG_TEAM_NAME"] {
            let row = app.staticTexts[name]
            XCTAssertTrue(row.waitForExistence(timeout: 15), "the team \(name) is not in the list")
            row.tap()
        } else {
            let row = app.buttons["teams.team"].firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 15), "no team in the list")
            row.tap()
        }
        XCTAssertTrue(element("team.member").waitForExistence(timeout: 15), "no member listed")

        // a member who is not the signed-in person: the report button is on the swipe of the row. The list builds its rows lazily, so
        // each row is looked for by its role and scrolled to; the signed-in person's own row has no such button and is passed over.
        var opened = false
        for role in ["Игрок", "Капитан", "Помощник тренера", "Главный тренер"] {
            let row = app.descendants(matching: .any).matching(identifier: "team.member")
                .matching(NSPredicate(format: "label CONTAINS %@", role)).firstMatch
            scrollUntilVisible(row)
            guard row.exists else { continue }
            row.swipeLeft()
            // swipe actions are found by their label: a subscript looks at identifiers only
            let report = app.buttons.matching(NSPredicate(format: "label == %@", "Пожаловаться")).firstMatch
            if report.waitForExistence(timeout: 2) {
                report.tap()
                opened = true
                break
            }
        }
        guard opened else { throw XCTSkip("the team has nobody but the signed-in person") }

        XCTAssertTrue(element("report.reason.other").waitForExistence(timeout: 5), "the dialog did not open")
        element("report.reason.other").tap()
        XCTAssertFalse(element("report.send").isEnabled, "«Другая причина» needs a few words")
        let comment = element("report.comment")
        comment.tap()
        comment.typeText("тест жалобы")
        XCTAssertTrue(element("report.send").isEnabled)
        element("report.send").tap()
        assertOutcomeIsTold()
    }

    func testTheOwnersOwnMessageHasNoReportInItsMenu() throws {
        try launchSignedIn()
        app.mainTabBar.buttons["Команды"].tap()
        let row = ProcessInfo.processInfo.environment["SAG_TEAM_NAME"].map { app.staticTexts[$0] } ?? app.buttons["teams.team"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "no team in the list")
        row.tap()
        let chat = element("team.chat")
        XCTAssertTrue(chat.waitForExistence(timeout: 15))
        chat.tap()

        let field = element("chat.input")
        XCTAssertTrue(field.waitForExistence(timeout: 15), "no field to write in")
        let text = "report-\(Int(Date().timeIntervalSince1970))"
        field.tap()
        field.typeText(text)
        element("chat.send").tap()
        let mine = app.staticTexts[text]
        XCTAssertTrue(mine.waitForExistence(timeout: 15), "the message did not appear")

        mine.press(forDuration: 1.2)
        XCTAssertTrue(app.buttons["Копировать"].waitForExistence(timeout: 5), "the message menu did not open")
        XCTAssertFalse(app.buttons["Пожаловаться на автора"].exists, "one can report oneself")
    }
}
