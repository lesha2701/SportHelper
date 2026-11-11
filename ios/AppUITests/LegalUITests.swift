import XCTest

/// The legal documents are read inside the app: the list in the profile, a document with its headings and its edition.
final class LegalUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    func testTheDocumentsAreListedAndOneIsReadInThePlace() throws {
        try launchSignedIn()
        profileTab.tap()
        let link = element("profile.legal")
        scrollUntilVisible(link)
        XCTAssertTrue(link.waitForExistence(timeout: 10), "no «Правовые документы» in the profile")
        link.tap()
        for key in ["terms", "privacy", "coach-offer", "service-terms", "consent-player", "consent-coach", "consent-coach-dissemination"] {
            let row = element("legal.\(key)")
            scrollUntilVisible(row, attempts: 4)
            XCTAssertTrue(row.exists, "the list lacks \(key)")
        }
        let privacy = element("legal.privacy")
        scrollUntilVisible(privacy, attempts: 4)
        privacy.tap()
        XCTAssertTrue(element("legal.text").waitForExistence(timeout: 10), "the text must open in the app")
        XCTAssertTrue(text(containing: "персональных данных").exists)
        XCTAssertTrue(text(containing: "Редакция от").exists, "the edition is part of the text")
        // The table of the policy (purposes and data) is long: it must be reachable by scrolling and its column names kept.
        let site = element("legal.openOnSite")
        scrollUntilVisible(site, attempts: 40)
        XCTAssertTrue(site.exists, "the end of the document with the link to the site")
    }
}
