import XCTest

/// The notification feed and its switches against the local server (the seeded accounts have notifications of their own).
final class NotificationsUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    /// Polls the element's value: a switch is saved on the server before it settles.
    private func waitForValue(of id: String, timeout: TimeInterval = 10, _ matches: (String?) -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if matches(element(id).value as? String) { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        }
        return false
    }

    private func openFeedFromProfile() {
        profileTab.tap()
        let entry = element("profile.notifications")
        scrollUntilVisible(entry)
        XCTAssertTrue(entry.waitForExistence(timeout: 10), "no «Уведомления» in the profile")
        entry.tap()
        XCTAssertTrue(element("notifications.list").waitForExistence(timeout: 15) || element("notifications.empty").exists, "the feed did not open")
    }

    func testTheFeedOpensFromTheHomeBellAndFromTheProfile() throws {
        try launchSignedIn()
        let bell = element("notifications.bell")
        XCTAssertTrue(bell.waitForExistence(timeout: 15), "no bell on the home screen")
        bell.tap()
        XCTAssertTrue(element("notifications.list").waitForExistence(timeout: 15), "the feed did not open from the bell")
        XCTAssertTrue(element("notifications.row").waitForExistence(timeout: 5), "the feed is empty, but the seeded account has notifications")

        app.navigationBars.buttons.firstMatch.tap()
        openFeedFromProfile()
        XCTAssertTrue(element("notifications.row").waitForExistence(timeout: 10))
    }

    func testOpeningAnUnreadNotificationMarksItRead() throws {
        try launchSignedIn()
        openFeedFromProfile()
        let unread = app.buttons.matching(identifier: "notifications.row").matching(NSPredicate(format: "value == %@", "Не прочитано")).firstMatch
        guard unread.waitForExistence(timeout: 10) else { throw XCTSkip("everything is read already: seed again") }
        let title = unread.staticTexts.firstMatch.label
        unread.tap()

        // whatever it opens (a screen, or the form of a personal training as a sheet), coming back shows the same notification as read
        if !element("notifications.list").waitForExistence(timeout: 3) {
            if app.navigationBars.buttons.firstMatch.exists { app.navigationBars.buttons.firstMatch.tap() }
            if !element("notifications.list").waitForExistence(timeout: 5) { app.swipeDown(velocity: .fast) }
            XCTAssertTrue(element("notifications.list").waitForExistence(timeout: 10), "did not come back to the feed")
        }
        let read = app.buttons.matching(identifier: "notifications.row")
            .matching(NSPredicate(format: "label CONTAINS %@ AND value == %@", title, "Прочитано")).firstMatch
        XCTAssertTrue(read.waitForExistence(timeout: 10), "«\(title)» is still shown as unread")
    }

    func testASwitchIsSavedAndRestored() throws {
        try launchSignedIn()
        openFeedFromProfile()
        element("notifications.settings").tap()
        let chat = element("notificationSettings.chat_team")
        XCTAssertTrue(chat.waitForExistence(timeout: 15), "no switch for the team chat")
        XCTAssertFalse(element("notificationSettings.payment_update").exists, "money notifications have no switch")
        let before = chat.value as? String

        chat.switches.firstMatch.tap()  // the row itself is combined with its switch: the tap must land on the switch
        XCTAssertTrue(waitForValue(of: "notificationSettings.chat_team") { $0 != before }, "the switch did not change")

        // it is kept on the server: leave the screen and come back
        app.navigationBars.buttons.firstMatch.tap()
        element("notifications.settings").tap()
        let again = element("notificationSettings.chat_team")
        XCTAssertTrue(again.waitForExistence(timeout: 15))
        XCTAssertNotEqual(again.value as? String, before, "the switch was not saved")

        again.switches.firstMatch.tap()  // put it back for the next run
        XCTAssertTrue(waitForValue(of: "notificationSettings.chat_team") { $0 == before }, "the switch was not put back")
    }
}
