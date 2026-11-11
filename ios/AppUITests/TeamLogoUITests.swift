import XCTest

/// The head coach sets the team's logo from the photo library. Needs a coach of a team (SAG_TEAM_NAME picks the team) and at least one
/// picture in the simulator's library (`xcrun simctl addmedia booted <file>`).
final class TeamLogoUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    func testTheCoachSetsTheLogoOfTheTeam() throws {
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
        let logo = element("team.logo")
        guard logo.waitForExistence(timeout: 10) else { throw XCTSkip("This needs a coach of the team.") }
        logo.tap()
        let picture = app.images["PXGGridLayout-Info"].firstMatch  // the system picker: its first picture
        XCTAssertTrue(picture.waitForExistence(timeout: 20), "the library picker did not show a picture")
        picture.tap()
        XCTAssertTrue(element("team.notice").waitForExistence(timeout: 30), "no answer after the upload")
        XCTAssertTrue(text(containing: "Логотип команды обновлён").exists, "the logo was not accepted: \(element("team.notice").label)")
        XCTAssertTrue(text(containing: "Сменить логотип").exists, "once there is a logo the row offers to change it")
    }
}
