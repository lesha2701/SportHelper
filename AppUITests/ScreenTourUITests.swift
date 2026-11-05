import XCTest

/// Walks through the main screens and keeps a screenshot of each as a test attachment (for looking at the design, not for checking
/// behaviour). Export them with `xcrun xcresulttool export attachments`. Set TEST_RUNNER_SAG_TOUR=1 to run it.
final class ScreenTourUITests: SignedInUITestCase {
    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testTour() throws {
        guard ProcessInfo.processInfo.environment["SAG_TOUR"] != nil else { throw XCTSkip("Set TEST_RUNNER_SAG_TOUR=1 to take the screenshots.") }
        if ProcessInfo.processInfo.environment["SAG_DARK"] != nil { app.launchArguments += ["-sag.appearance", "dark"] }
        launchSignedOut()
        sleep(1)
        shot("01-login")
        let (email, password) = try credentials()
        signIn(email: email, password: password)
        XCTAssertTrue(app.mainTabBar.waitForExistence(timeout: 10))
        sleep(2)
        shot("02-home")
        app.swipeUp()
        sleep(1)
        shot("03-home-2")
        app.mainTabBar.buttons["Команды"].tap()
        sleep(2)
        shot("04-teams")
        if let name = ProcessInfo.processInfo.environment["SAG_TEAM_NAME"], app.staticTexts[name].waitForExistence(timeout: 5) {
            app.staticTexts[name].tap()
            sleep(2)
            shot("05-team")
            if app.buttons["team.trainings"].exists {
                app.buttons["team.trainings"].tap()
                sleep(2)
                shot("05b-team-trainings")
                app.navigationBars.buttons.firstMatch.tap()
            }
            app.navigationBars.buttons.firstMatch.tap()
        }
        app.mainTabBar.buttons["Календарь"].tap()
        sleep(2)
        shot("06-calendar")
        profileTab.tap()
        sleep(2)
        shot("07-profile")
        app.swipeUp()
        sleep(1)
        shot("08-profile-2")
    }
}
