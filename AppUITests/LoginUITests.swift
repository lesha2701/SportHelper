import XCTest

final class LoginUITests: SignedInUITestCase {
    func testSigningInOpensTheApp() throws {
        try launchSignedIn()
        XCTAssertTrue(profileTab.exists)
    }

    func testAWrongPasswordShowsTheServersMessageAndStaysOnTheForm() throws {
        _ = try credentials()  // skip together with the other tests when there is no test server
        launchSignedOut()
        // Never the test account itself: the server locks an account after repeated failed sign-ins (and so it should).
        signIn(email: "nobody-\(UUID().uuidString.prefix(8))@example.com", password: "definitely-not-the-password")

        let error = app.staticTexts["login.error"]
        XCTAssertTrue(error.waitForExistence(timeout: 10), "no error message was shown")
        XCTAssertFalse(error.label.isEmpty)
        XCTAssertTrue(app.textFields["login.email"].exists, "should still be on the sign-in form")
    }

    func testSigningOutReturnsToTheSignInScreen() throws {
        try launchSignedIn()
        profileTab.tap()
        app.buttons["main.logout"].tap()
        XCTAssertTrue(app.textFields["login.email"].waitForExistence(timeout: 10), "sign-out should return to the sign-in screen")
    }

    /// The person must not have to sign in again every time the app is closed.
    func testTheSessionSurvivesClosingAndReopeningTheApp() throws {
        try launchSignedIn()
        app.terminate()

        app.launch()

        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 10), "the app should open signed in")
        XCTAssertFalse(app.textFields["login.email"].exists)
    }
}
