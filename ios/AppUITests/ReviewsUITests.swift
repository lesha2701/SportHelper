import XCTest

/// Reviews against the local server. The athlete's account reviews a coach after a held session; the coach's account marks a session
/// conducted and reviews the player. Each review is used up (the server takes one per booking), so these need freshly seeded sessions:
/// the one for «Тренировка проведена» is a confirmed booking moved three hours into the past, not yet marked conducted.
final class ReviewsUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func openMyBookings() throws {
        try launchSignedIn()
        profileTab.tap()
        let entry = app.buttons["profile.myBookings"]
        guard entry.waitForExistence(timeout: 10) else { throw XCTSkip("This test needs an athlete account.") }
        entry.tap()
        XCTAssertTrue(element("bookings.list").waitForExistence(timeout: 15), "the bookings did not open")
    }

    private func openCoachBookings() throws {
        try launchSignedIn()
        profileTab.tap()
        let entry = element("profile.coachBookings")
        scrollUntilVisible(entry)
        guard entry.waitForExistence(timeout: 10) else { throw XCTSkip("This test needs a coach account.") }
        entry.tap()
        XCTAssertTrue(element("coachBookings.list").waitForExistence(timeout: 15), "the sessions did not open")
    }

    private func fillAndSend(stars: Int, comment: String) {
        XCTAssertTrue(element("review.send").waitForExistence(timeout: 10), "the review dialog did not open")
        XCTAssertTrue(element("review.send").isEnabled, "five stars are preselected: sending must be possible at once")
        element("review.star.\(stars)").tap()
        let field = element("review.comment")
        field.tap()
        field.typeText(comment)
        element("review.send").tap()
        let why = element("review.error").exists ? element("review.error").label : "no error shown"
        XCTAssertTrue(element("review.send").waitForNonExistence(timeout: 15), "the dialog stayed open: \(why)")
    }

    func testTheDialogCanBeClosedWithoutSendingAnything() throws {
        try openMyBookings()
        let review = element("booking.review")
        scrollUntilVisible(review)
        guard review.waitForExistence(timeout: 10) else { throw XCTSkip("no session left to review: seed again") }
        review.tap()
        XCTAssertTrue(element("review.send").waitForExistence(timeout: 10))
        element("review.skip").tap()
        XCTAssertTrue(element("review.send").waitForNonExistence(timeout: 10))
        XCTAssertTrue(element("booking.review").exists, "closing the dialog must not use the review up")
    }

    func testTheAthleteReviewsTheCoachAndTheCardRemembersIt() throws {
        try openMyBookings()
        let review = element("booking.review")
        scrollUntilVisible(review)
        guard review.waitForExistence(timeout: 10) else { throw XCTSkip("no session left to review: seed again") }
        review.tap()
        fillAndSend(stars: 4, comment: "ревью-тест \(Int(Date().timeIntervalSince1970))")

        scrollUntilVisible(element("booking.reviewed"))
        XCTAssertTrue(element("booking.reviewed").exists, "the card does not say a review was left")
    }

    func testTheCoachMarksASessionConductedAndIsOfferedTheReview() throws {
        try openCoachBookings()
        let complete = element("booking.complete")
        scrollUntilVisible(complete)
        guard complete.waitForExistence(timeout: 10) else { throw XCTSkip("no begun session waiting for «проведена»: seed again") }
        complete.tap()

        // right after the mark the review of the player is offered
        fillAndSend(stars: 5, comment: "игрок молодец")
        scrollUntilVisible(element("booking.playerReviewed"))
        XCTAssertTrue(element("booking.playerReviewed").exists)
    }

    func testTheCoachReviewsAPlayerOfAHeldSessionLater() throws {
        try openCoachBookings()
        let review = element("booking.reviewPlayer")
        scrollUntilVisible(review)
        guard review.waitForExistence(timeout: 10) else { throw XCTSkip("no held session without a review: seed again") }
        review.tap()
        fillAndSend(stars: 3, comment: "")
        scrollUntilVisible(element("booking.playerReviewed"))
        XCTAssertTrue(element("booking.playerReviewed").exists)
    }

    func testAllTheReviewsOfACoachAreListed() throws {
        try launchSignedIn()
        let coaches = app.mainTabBar.buttons["Тренеры"]
        guard coaches.waitForExistence(timeout: 10) else { throw XCTSkip("This test needs an athlete account.") }
        coaches.tap()
        let listing = app.buttons["coaches.listing"].firstMatch
        guard listing.waitForExistence(timeout: 15) else { throw XCTSkip("This test needs an athlete account.") }
        listing.tap()
        let all = element("listing.allReviews")
        scrollUntilVisible(all)
        guard all.waitForExistence(timeout: 5) else { throw XCTSkip("the coach has few reviews: nothing more to list") }
        all.tap()
        XCTAssertTrue(element("reviews.list").waitForExistence(timeout: 15), "the list of reviews did not open")
        XCTAssertTrue(element("review.row").exists)
    }
}
