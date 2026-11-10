import XCTest

/// The team's tournaments and home venue (set in the team's settings) reach the match form; the coach opens exercises and plans to the team.
/// Needs a coach of a team (SAG_TEAM_NAME picks the team); the settings are put back as they were.
final class TeamSettingsUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }
    private var env: [String: String] { ProcessInfo.processInfo.environment }

    private func openTeam() throws {
        try launchSignedIn()
        app.mainTabBar.buttons["Команды"].tap()
        if let name = env["SAG_TEAM_NAME"] {
            let row = app.staticTexts[name]
            XCTAssertTrue(row.waitForExistence(timeout: 15), "the team \(name) is not in the list")
            row.tap()
        } else {
            let row = app.buttons["teams.team"].firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 15), "no team in the list")
            row.tap()
        }
        guard element("team.edit").waitForExistence(timeout: 10) else { throw XCTSkip("This needs a coach of the team.") }
    }

    /// Replaces what is in a field of the settings (an empty text clears it).
    private func write(_ text: String, in field: XCUIElement) {
        scrollUntilVisible(field)
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the settings have no field \(field.identifier)")
        field.tap()
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.9)).tap()  // the caret goes to the end, so the deletes reach all the text
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 600))
        if !text.isEmpty { field.typeText(text) }
    }

    private func setSettings(venue: String, tournaments: String) {
        element("team.edit").tap()
        write(venue, in: app.textFields["teamForm.homeVenue"])
        write(tournaments, in: app.textFields["teamForm.tournaments"])
        element("teamForm.save").tap()
        XCTAssertTrue(element("team.edit").waitForExistence(timeout: 10), "the settings did not save")
    }

    func testTheHomeVenueAndTheTournamentsOfTheTeamAreOfferedInTheMatchForm() throws {
        try openTeam()
        let venue = "Арена-\(Int(Date().timeIntervalSince1970) % 10_000)"
        setSettings(venue: venue, tournaments: "Тестовый кубок")

        element("team.matches").tap()
        element("matches.add").tap()
        let place = app.textFields["matchForm.location"]
        XCTAssertTrue(place.waitForExistence(timeout: 10), "the match form did not open")
        XCTAssertEqual(place.value as? String, venue, "a home match should take the home venue as its place")
        let pick = app.buttons["matchForm.pickTournament"]
        scrollUntilVisible(pick, attempts: 6)
        pick.tap()
        let choice = app.buttons["Тестовый кубок"]
        if !choice.waitForExistence(timeout: 5) {
            let dump = app.debugDescription.split(separator: "\n").filter { $0.contains("Без турнира") || $0.contains("кубок") }
            XCTFail("the team's tournament is not offered: \(dump.joined(separator: "\n"))")
            return
        }
        choice.tap()
        let cup = app.textFields["matchForm.tournament"]
        XCTAssertEqual(cup.value as? String, "Тестовый кубок", "the chosen tournament should be filled in")

        app.segmentedControls.buttons["В гостях"].tap()
        XCTAssertNotEqual(place.value as? String, venue, "an away match is not played at home")
        app.buttons["Отмена"].tap()

        // put the settings back
        app.navigationBars.buttons.firstMatch.tap()
        setSettings(venue: "", tournaments: "")
    }

    func testTheCoachSeesHowToOpenExercisesAndPlansToTheTeam() throws {
        try openTeam()
        XCTAssertTrue(element("team.library").waitForExistence(timeout: 10))
        element("team.library").tap()
        let share = element("teamLibrary.share")
        XCTAssertTrue(share.waitForExistence(timeout: 10), "a coach needs a button that opens materials to the team")
        share.tap()
        XCTAssertTrue(element("teamLibrary.shareDone").waitForExistence(timeout: 10), "the sheet with the coach's own exercises did not open")
        element("teamLibrary.shareDone").tap()
    }
}
