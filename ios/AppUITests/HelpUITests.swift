import XCTest

/// «Помощь» from the profile: the reference opens, its sections are there to be scrolled to, and the tour can be started from it.
final class HelpUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func openHelp() {
        profileTab.tap()
        let link = element("profile.help")
        scrollUntilVisible(link)
        XCTAssertTrue(link.waitForExistence(timeout: 10), "no «Помощь» in the profile")
        link.tap()
    }

    func testTheReferenceOpensAndItsLastSectionCanBeReached() throws {
        try launchSignedIn()
        openHelp()
        XCTAssertTrue(app.navigationBars["О приложении"].waitForExistence(timeout: 10), "the reference has no title")
        XCTAssertTrue(app.staticTexts["Главная"].firstMatch.waitForExistence(timeout: 10), "the first section is missing")
        let last = app.staticTexts["Вход и доступ"].firstMatch
        scrollUntilVisible(last, attempts: 20)
        XCTAssertTrue(last.exists, "the last section cannot be reached by scrolling")
    }

    func testTheTourStartsFromTheReferenceAndComesBack() throws {
        try launchSignedIn()
        openHelp()
        let tour = element("profile.guide")
        XCTAssertTrue(tour.waitForExistence(timeout: 10), "the tour is not offered in the reference")
        tour.tap()
        XCTAssertTrue(element("welcome.guide").waitForExistence(timeout: 10), "the tour did not open")
        element("welcome.close").tap()
        XCTAssertTrue(app.navigationBars["О приложении"].waitForExistence(timeout: 10), "closing the tour should leave the reference")
    }
}
