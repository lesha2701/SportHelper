import XCTest

/// The person's own gallery of achievements: add a photo from the library, see it, take it out. (The simulator's library needs at
/// least one picture: `xcrun simctl addmedia booted <file>`.) What the test adds it removes again.
final class AchievementsUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func openGallery() {
        profileTab.tap()
        let link = element("profile.achievements")
        scrollUntilVisible(link)
        XCTAssertTrue(link.waitForExistence(timeout: 10), "no «Мои достижения» in the profile")
        link.tap()
        XCTAssertTrue(element("achievements.addPhoto").waitForExistence(timeout: 10))
    }

    /// Waits until the number of items is `matches`, up to `timeout` seconds.
    private func waitForCount(_ matches: (Int) -> Bool, timeout: TimeInterval) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if matches(items.count) { return true }
            Thread.sleep(forTimeInterval: 0.5)
        }
        return matches(items.count)
    }

    private var items: XCUIElementQuery { app.descendants(matching: .any).matching(identifier: "achievements.item") }

    func testThePhotoCanBeAddedSeenAndTakenOut() throws {
        try launchSignedIn()
        openGallery()
        XCTAssertTrue(element("achievements.addVideo").exists)
        XCTAssertTrue(text(containing: "не длиннее 60 секунд").exists, "the video limits are told before the choice")
        let before = items.count

        element("achievements.addPhoto").tap()
        let picture = app.images["PXGGridLayout-Info"].firstMatch  // the system picker: its first picture
        XCTAssertTrue(picture.waitForExistence(timeout: 20), "the library picker did not show a picture")
        picture.tap()
        let add = app.buttons["Add"].exists ? app.buttons["Add"] : app.buttons["Добавить"]
        if add.waitForExistence(timeout: 3) { add.tap() }

        XCTAssertTrue(waitForCount({ $0 > before }, timeout: 30), "the photo did not appear in the gallery")
        XCTAssertFalse(element("achievements.error").exists, "an error is shown after the upload")

        items.firstMatch.press(forDuration: 1.2)
        let remove = app.buttons["Удалить"].firstMatch
        XCTAssertTrue(remove.waitForExistence(timeout: 5), "the menu of the item has no «Удалить»")
        remove.tap()
        let confirm = app.buttons["Удалить"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        XCTAssertTrue(waitForCount({ $0 == before }, timeout: 15), "the photo is still in the gallery")
    }
}
