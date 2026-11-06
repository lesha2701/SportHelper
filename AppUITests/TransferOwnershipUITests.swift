import XCTest

/// Handing the head coach's role over, against the local server. It needs a FRESH team of coach1 with a player in it (SAG_TEAM_NAME):
/// the test really hands the role over, so the team is used up (coach1 stays in it as an assistant coach).
final class TransferOwnershipUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    func testTheHeadCoachHandsTheRoleOverAndStaysAnAssistant() throws {
        guard let team = ProcessInfo.processInfo.environment["SAG_TEAM_NAME"] else { throw XCTSkip("Set TEST_RUNNER_SAG_TEAM_NAME (a fresh team).") }
        try launchSignedIn()
        app.mainTabBar.buttons["Команды"].tap()
        let row = app.staticTexts[team]
        XCTAssertTrue(row.waitForExistence(timeout: 15), "the team \(team) is not in the list")
        row.tap()

        let transfer = element("team.transfer")
        scrollUntilVisible(transfer)
        guard transfer.exists else { throw XCTSkip("This needs the head coach of the team.") }
        transfer.tap()

        // the sheet lists the other members, and the button waits for a choice
        let candidate = element("transfer.candidate")
        XCTAssertTrue(candidate.waitForExistence(timeout: 10), "nobody to hand the role to")
        XCTAssertFalse(element("transfer.submit").isEnabled, "no one is chosen yet")
        candidate.tap()
        XCTAssertTrue(element("transfer.submit").isEnabled)
        element("transfer.submit").tap()
        element("transfer.confirm").tap()

        // the sheet closes, the coach is told, and is no longer the head coach
        let notice = text(containing: "теперь главный тренер")
        var scrolls = 6
        while !notice.waitForExistence(timeout: 3), scrolls > 0 {  // the notice is at the top of a list that was scrolled down
            app.swipeDown()
            scrolls -= 1
        }
        XCTAssertTrue(notice.exists, "no notice about the new head coach")
        XCTAssertFalse(element("team.transfer").waitForExistence(timeout: 3), "the old head coach can no longer hand the role over")
        XCTAssertTrue(app.staticTexts["Помощник тренера"].exists || app.staticTexts["ПОМОЩНИК ТРЕНЕРА"].exists, "the role badge should say assistant")
    }
}
