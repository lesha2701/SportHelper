import XCTest

/// Other people's pages against the local server: a coach's page from their offer (an athlete's account) and a player's page from a
/// coach's list of sessions (a coach's account).
final class PublicProfilesUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    func testAnAthleteOpensTheCoachsPageFromTheOfferAndCanReportIt() throws {
        try launchSignedIn()
        let coaches = app.mainTabBar.buttons["Тренеры"]
        guard coaches.waitForExistence(timeout: 10) else { throw XCTSkip("This test needs an athlete account.") }
        coaches.tap()
        let listing = app.buttons["coaches.listing"].firstMatch
        XCTAssertTrue(listing.waitForExistence(timeout: 15), "no coach listing in the catalogue")
        listing.tap()

        let link = element("listing.coachProfile")
        XCTAssertTrue(link.waitForExistence(timeout: 15), "the offer does not lead to the coach's page")
        link.tap()
        XCTAssertTrue(element("coachProfile.list").waitForExistence(timeout: 15), "the coach's page did not open")
        XCTAssertTrue(element("profilePage.name").exists, "no name on the coach's page")

        let report = element("profilePage.report")
        scrollUntilVisible(report)
        XCTAssertTrue(report.exists, "no way to report the coach")
        report.tap()
        XCTAssertTrue(element("report.reason.spam").waitForExistence(timeout: 5), "the complaint dialog did not open")
        element("report.close").tap()
    }

    func testTheCoachsOffersOnTheirPageOpenTheOffer() throws {
        try launchSignedIn()
        let coaches = app.mainTabBar.buttons["Тренеры"]
        guard coaches.waitForExistence(timeout: 10) else { throw XCTSkip("This test needs an athlete account.") }
        coaches.tap()
        let listing = app.buttons["coaches.listing"].firstMatch
        XCTAssertTrue(listing.waitForExistence(timeout: 15))
        listing.tap()
        element("listing.coachProfile").tap()
        let offer = element("coachProfile.listing")
        scrollUntilVisible(offer)
        XCTAssertTrue(offer.waitForExistence(timeout: 15), "the coach's page lists no offers")
        offer.tap()
        XCTAssertTrue(element("listing.book").waitForExistence(timeout: 15), "the offer did not open")
    }

    func testACoachOpensAPlayersPageFromTheSessionsAndSeesTheirAchievements() throws {
        try launchSignedIn()
        profileTab.tap()
        let sessions = element("profile.coachBookings")
        scrollUntilVisible(sessions)
        guard sessions.waitForExistence(timeout: 10) else { throw XCTSkip("This test needs a coach account.") }
        sessions.tap()
        XCTAssertTrue(element("coachBookings.list").waitForExistence(timeout: 15))

        let open = element("booking.playerProfile")
        scrollUntilVisible(open)
        XCTAssertTrue(open.waitForExistence(timeout: 10), "no way to the player's page from a session")
        open.tap()
        XCTAssertTrue(element("playerProfile.list").waitForExistence(timeout: 15), "the player's page did not open")
        XCTAssertTrue(element("profilePage.name").exists)

        // the coach has a booking with this player: what coaches wrote about them is shown
        let achievements = element("achievements.item")
        scrollUntilVisible(achievements)
        if achievements.exists {
            achievements.tap()
            XCTAssertTrue(element("photo.close").waitForExistence(timeout: 10), "the photo did not open")
            element("photo.close").tap()
        }
        element("profilePage.close").tap()
        XCTAssertTrue(element("coachBookings.list").waitForExistence(timeout: 10), "the sheet did not close")
    }

    func testACoachOpensAPlayersPageFromARequestBeforeAnswering() throws {
        try launchSignedIn()
        profileTab.tap()
        let inbox = element("profile.requests")
        scrollUntilVisible(inbox)
        guard inbox.waitForExistence(timeout: 10) else { throw XCTSkip("This test needs a coach account.") }
        inbox.tap()
        let open = element("requests.playerProfile")
        guard open.waitForExistence(timeout: 10) else { throw XCTSkip("No requests waiting; an athlete has to send one first.") }
        open.tap()
        XCTAssertTrue(element("playerProfile.list").waitForExistence(timeout: 15), "the player's page did not open from the request")
        element("profilePage.close").tap()
        XCTAssertTrue(element("requests.card").waitForExistence(timeout: 10), "the request is gone after looking at the player")
    }
}
