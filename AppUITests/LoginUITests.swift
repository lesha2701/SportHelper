import XCTest

/// Signs in against a REAL server (the one the Debug build points at, `http://localhost:8010`), so these tests need that server
/// running with a test account. The credentials come from the environment, never from the repository:
///   TEST_RUNNER_SAG_EMAIL=... TEST_RUNNER_SAG_PASSWORD=... xcodebuild test ...
final class LoginUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments += ["-uiTesting"]
    }

    private func credentials() throws -> (email: String, password: String) {
        let env = ProcessInfo.processInfo.environment
        guard let email = env["SAG_EMAIL"], let password = env["SAG_PASSWORD"] else {
            throw XCTSkip("Set TEST_RUNNER_SAG_EMAIL and TEST_RUNNER_SAG_PASSWORD (a test account on the local server).")
        }
        return (email, password)
    }

    /// Launches the app on the sign-in screen. The session is kept between launches (that is the point of the app), so a previous run
    /// may have left the person signed in: sign out first.
    private func launchSignedOut() {
        app.launch()
        if app.navigationBars["Профиль"].waitForExistence(timeout: 4) {
            app.buttons["main.logout"].tap()
        }
    }

    private func signIn(email: String, password: String) {
        let emailField = app.textFields["login.email"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 10), "the sign-in screen did not appear")
        emailField.tap()
        emailField.typeText(email)
        // The password is typed with the "show password" switch on: a secure field reports only bullets, so what was really typed
        // could not be checked there. (It also exercises the switch.)
        app.buttons["login.togglePassword"].tap()
        let passwordField = app.textFields["login.password"]
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5), "the password became visible")
        passwordField.tap()
        passwordField.typeText(password)
        XCTAssertEqual(passwordField.value as? String, password, "the password field should hold exactly what was typed")
        app.buttons["login.submit"].tap()
    }

    func testSigningInShowsThePersonsProfile() throws {
        let (email, password) = try credentials()
        launchSignedOut()
        signIn(email: email, password: password)

        let opened = app.navigationBars["Профиль"].waitForExistence(timeout: 10)
        let shown = app.staticTexts["login.error"].exists ? app.staticTexts["login.error"].label : "(no error shown)"
        XCTAssertTrue(opened, "the app did not open after signing in; the form says: \(shown)")
        // The list reads "Email" and the address as one element, so look for the address inside the label.
        let row = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", email)).firstMatch
        XCTAssertTrue(row.exists, "the profile should show the signed-in address")
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
        let (email, password) = try credentials()
        launchSignedOut()
        signIn(email: email, password: password)
        XCTAssertTrue(app.navigationBars["Профиль"].waitForExistence(timeout: 10))

        app.buttons["main.logout"].tap()

        XCTAssertTrue(app.textFields["login.email"].waitForExistence(timeout: 10), "sign-out should return to the sign-in screen")
    }
}
