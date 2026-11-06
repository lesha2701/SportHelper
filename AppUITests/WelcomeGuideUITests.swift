import XCTest

/// «Знакомство с приложением» against the local server: opened by hand from the profile it walks through every page and closes without
/// touching the account. (The tour that a new person is shown by itself needs an account whose tour is still due — the second test.)
final class WelcomeGuideUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    func testTheTourIsOpenedFromTheProfileWalkedThroughAndClosed() throws {
        try launchSignedIn()
        profileTab.tap()
        let link = element("profile.guide")
        scrollUntilVisible(link)
        XCTAssertTrue(link.waitForExistence(timeout: 10), "no «Знакомство с приложением» in the profile")
        link.tap()

        let title = element("welcome.title")
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        XCTAssertTrue(element("welcome.close").exists, "opened by hand it has a cross, not «Пропустить»")
        XCTAssertFalse(element("welcome.skip").exists)
        XCTAssertFalse(element("welcome.back").exists, "no «Назад» on the first page")

        var seen: Set<String> = [title.label]
        var pages = 1
        while element("welcome.next").label != "Готово", pages < 20 {
            element("welcome.next").tap()
            pages += 1
            let deadline = Date().addingTimeInterval(5)
            while seen.contains(element("welcome.title").label), Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.2)) }
            seen.insert(element("welcome.title").label)
        }
        XCTAssertEqual(seen.count, pages, "every page has its own title")
        XCTAssertGreaterThanOrEqual(pages, 8)
        XCTAssertTrue(element("welcome.back").exists)
        XCTAssertTrue(app.staticTexts["Ваша роль"].exists, "the last page marks the person's own role")

        element("welcome.next").tap()  // «Готово»
        XCTAssertTrue(link.waitForExistence(timeout: 10), "closing returns to the profile")
        XCTAssertFalse(element("welcome.guide").exists)
    }

    /// Needs SAG_FRESH=1 and an account whose tour is due (the seed script `seed_account.py --tour` makes one): skipping must let the person in.
    func testANewPersonIsShownTheTourByItselfAndCanSkipIt() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["SAG_FRESH"] == "1", "needs an account whose tour is still due")
        try launchSignedIn()
        XCTAssertTrue(element("welcome.guide").waitForExistence(timeout: 20), "the tour should be shown by itself")
        element("welcome.skip").tap()
        XCTAssertTrue(app.mainTabBar.buttons["Главная"].waitForExistence(timeout: 10))
        XCTAssertFalse(element("welcome.guide").exists)
    }
}
