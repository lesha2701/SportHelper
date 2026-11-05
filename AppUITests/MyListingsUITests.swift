import XCTest

/// «Мои объявления» against the local server (a coach's account): a draft, a published offer with a schedule, the checks before
/// publishing, and deleting. Each test removes what it made.
final class MyListingsUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func openMyListings() throws {
        try launchSignedIn()
        profileTab.tap()
        let entry = element("profile.myListings")
        scrollUntilVisible(entry)
        guard entry.waitForExistence(timeout: 10) else { throw XCTSkip("This test needs a coach account.") }
        entry.tap()
        XCTAssertTrue(element("myListings.list").waitForExistence(timeout: 15), "the offers did not open")
    }

    /// The form is a long lazy list: look down the page, then up it, and leave the element clear of the bars at the top and bottom.
    private func reveal(_ element: XCUIElement) {
        scrollUntilVisible(element)
        var up = 8
        while !element.exists, up > 0 {
            app.swipeDown()
            up -= 1
        }
        let screen = app.frame
        var nudges = 4
        while element.exists, element.frame.minY < 160, nudges > 0 {
            let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
            from.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.65)))
            nudges -= 1
        }
        nudges = 4
        while element.exists, element.frame.maxY > screen.height - 140, nudges > 0 {
            let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.65))
            from.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45)))
            nudges -= 1
        }
    }

    private func type(_ text: String, into id: String) {
        let field = element(id)
        reveal(field)
        field.tap()
        field.typeText(text)
        // the «Готово» of the keyboard's bar comes a moment after the keyboard itself (a number pad has no return key)
        if app.keyboards.count > 0, element("keyboard.done").waitForExistence(timeout: 2) { element("keyboard.done").tap() }
    }

    private func tapSwitch(_ id: String) {
        let row = element(id)
        reveal(row)
        row.switches.firstMatch.tap()
    }

    private func newListing(titled title: String) {
        element("myListings.new").tap()
        XCTAssertTrue(element("listingForm.title").waitForExistence(timeout: 10), "the form did not open")
        type(title, into: "listingForm.title")
    }

    private func row(_ title: String) -> XCUIElement {
        app.buttons.matching(identifier: "myListings.row").matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
    }

    private func why() -> String { element("listingForm.error").exists ? element("listingForm.error").label : "no error shown" }

    private func save() {
        element("listingForm.save").tap()
    }

    private func delete(_ title: String) {
        let target = row(title)
        scrollUntilVisible(target)
        XCTAssertTrue(target.waitForExistence(timeout: 10), "«\(title)» is not in the list")
        target.swipeLeft()
        let button = app.buttons.matching(NSPredicate(format: "label == %@", "Удалить")).firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 5), "no «Удалить» on the swipe")
        button.tap()
        element("myListings.confirmDelete").tap()
        XCTAssertTrue(target.waitForNonExistence(timeout: 15), "«\(title)» is still listed after deleting")
    }

    func testADraftNeedsOnlyATitleAndCanBeDeleted() throws {
        try openMyListings()
        let title = "Черновик \(Int(Date().timeIntervalSince1970))"
        newListing(titled: title)
        save()
        XCTAssertTrue(element("listingForm.title").waitForNonExistence(timeout: 20), "the form stayed open: \(why())")
        let created = row(title)
        XCTAssertTrue(created.waitForExistence(timeout: 15), "the new offer is not in the list")
        XCTAssertTrue(created.label.contains("Черновик"), "a new offer must be a draft: \(created.label)")
        delete(title)
    }

    func testPublishingAsksForWhatIsMissingAndThenWorksWithASchedule() throws {
        try openMyListings()
        let title = "Публикация \(Int(Date().timeIntervalSince1970))"
        newListing(titled: title)
        tapSwitch("listingForm.listed")

        // nothing else is filled in: the form says what is missing and does not close
        save()
        let problem = element("listingForm.error")
        scrollUntilVisible(problem)  // the form is a lazy list: the message at its end is not there until it is scrolled to
        XCTAssertTrue(problem.waitForExistence(timeout: 10), "no explanation of what is missing")
        XCTAssertTrue(problem.label.contains("формат"), "unexpected explanation: \(problem.label)")
        XCTAssertTrue(element("listingForm.save").exists, "the form must stay open")

        tapSwitch("listingForm.online")
        type("2500", into: "listingForm.price")
        let add = element("listingForm.addWindow")
        reveal(add)
        XCTAssertTrue(add.waitForExistence(timeout: 10), "no way to add a window of the schedule")
        add.tap()
        XCTAssertTrue(element("listingForm.window").waitForExistence(timeout: 5), "the window was not added")
        save()

        XCTAssertTrue(element("listingForm.title").waitForNonExistence(timeout: 30), "the form stayed open: \(why())")
        let created = row(title)
        XCTAssertTrue(created.waitForExistence(timeout: 15), "the offer is not in the list")
        XCTAssertTrue(created.label.contains("Опубликовано"), "the offer was not published: \(created.label)")
        delete(title)
    }

    func testTheScheduleOfAnOldOfferIsKeptWhenOnlyItsTitleChanges() throws {
        try openMyListings()
        let title = "Расписание \(Int(Date().timeIntervalSince1970))"
        newListing(titled: title)
        let add = element("listingForm.addWindow")
        scrollUntilVisible(add)
        add.tap()
        save()
        XCTAssertTrue(element("listingForm.title").waitForNonExistence(timeout: 20))

        // open it again: the window is there, and a save without touching it keeps it
        let created = row(title)
        XCTAssertTrue(created.waitForExistence(timeout: 15))
        created.tap()
        XCTAssertTrue(element("listingForm.title").waitForExistence(timeout: 10))
        let window = element("listingForm.window")
        scrollUntilVisible(window)
        XCTAssertTrue(window.waitForExistence(timeout: 15), "the saved schedule was not loaded back")
        save()
        XCTAssertTrue(element("listingForm.title").waitForNonExistence(timeout: 20))

        row(title).tap()
        XCTAssertTrue(element("listingForm.title").waitForExistence(timeout: 10))
        scrollUntilVisible(element("listingForm.window"))
        XCTAssertTrue(element("listingForm.window").waitForExistence(timeout: 15), "saving again lost the schedule")
        app.buttons["Отмена"].tap()
        delete(title)
    }
}
