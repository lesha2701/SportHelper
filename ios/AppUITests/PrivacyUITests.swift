import XCTest

/// «Конфиденциальность» against the local server: the AI-analysis switch is read from the server, flipped, kept, and put back.
/// It restores the choice it found, so it can run any number of times with any account.
final class PrivacyUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    /// The row is wide and its text is not the switch: touch where the switch is, at the right end.
    private func flip(_ toggle: XCUIElement) { toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap() }

    private func waitForNotice() -> Bool { element("privacy.notice").waitForExistence(timeout: 15) }

    private func openPrivacy() {
        profileTab.tap()
        let link = element("profile.privacy")
        scrollUntilVisible(link)
        XCTAssertTrue(link.waitForExistence(timeout: 10), "no «Конфиденциальность» in the profile")
        link.tap()
    }

    func testTheAiAnalysisSwitchIsKeptByTheServerAndCanBePutBack() throws {
        try launchSignedIn()
        openPrivacy()
        let toggle = app.switches["privacy.ai"].firstMatch
        XCTAssertTrue(toggle.waitForExistence(timeout: 15), "the switch should appear once the choice is read")
        let before = toggle.value as? String

        flip(toggle)
        XCTAssertTrue(waitForNotice(), "the answer of the server should be shown")
        let flipped = app.switches["privacy.ai"].firstMatch.value as? String
        XCTAssertNotEqual(flipped, before, "the switch should show the new choice")

        // a fresh read shows what the server kept
        app.navigationBars.buttons.firstMatch.tap()
        openPrivacy()
        let reread = app.switches["privacy.ai"].firstMatch
        XCTAssertTrue(reread.waitForExistence(timeout: 15))
        XCTAssertEqual(reread.value as? String, flipped, "the server should have kept the choice")

        flip(reread)
        XCTAssertTrue(waitForNotice())
        XCTAssertEqual(app.switches["privacy.ai"].firstMatch.value as? String, before, "the first choice should be restored")
    }
}
