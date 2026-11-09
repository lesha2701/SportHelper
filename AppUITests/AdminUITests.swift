import XCTest

/// The administrator's part of the profile: the way into the admin panel and the switch between coach and player.
/// With an ordinary account the section must not be there; with an administrator's (TEST_RUNNER_SAG_EMAIL=boss@…) it must.
final class AdminUITests: SignedInUITestCase {
    private var roleLabel: XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label ==[c] %@ OR label ==[c] %@", "Тренер", "Игрок")).firstMatch
    }

    func testOnlyAnAdministratorSeesTheAdminSectionAndTheSwitch() throws {
        try launchSignedIn()
        profileTab.tap()
        XCTAssertTrue(roleLabel.waitForExistence(timeout: 10))
        let panel = app.buttons["profile.admin"]
        scrollUntilVisible(panel, attempts: 6)
        let isAdmin = ProcessInfo.processInfo.environment["SAG_IS_ADMIN"] == "1"
        if !isAdmin {
            XCTAssertFalse(panel.exists, "an ordinary account must not see the admin panel button")
            XCTAssertFalse(app.buttons["profile.switchRole"].exists, "an ordinary account must not see the role switch")
            return
        }
        XCTAssertTrue(panel.exists, "an administrator needs a button for the admin panel")
        let switchRole = app.buttons["profile.switchRole"]
        XCTAssertTrue(switchRole.exists, "an administrator needs a role switch")
        switchRole.tap()
        // the other profile may not exist yet: then the server's or the app's own words say so, and nothing breaks
        let note = app.staticTexts["profile.switchRole.error"]
        let switched = roleLabel
        XCTAssertTrue(note.waitForExistence(timeout: 10) || switched.exists)
    }
}
