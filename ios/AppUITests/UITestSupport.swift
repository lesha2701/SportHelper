import XCTest

/// Shared steps for the UI tests. They sign in against a REAL server (the one the Debug build points at, `http://localhost:8010`),
/// so they need that server running with a test account. The credentials come from the environment, never from the repository:
///   TEST_RUNNER_SAG_EMAIL=... TEST_RUNNER_SAG_PASSWORD=... xcodebuild test ...
extension XCUIApplication {
    /// The app's own bottom bar (the system's tab bar is hidden: the site's bar is flat).
    var mainTabBar: XCUIElement { otherElements["mainTabBar"].firstMatch }
}

class SignedInUITestCase: XCTestCase {
    var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments += ["-uiTesting"]
    }

    func credentials() throws -> (email: String, password: String) {
        let env = ProcessInfo.processInfo.environment
        guard let email = env["SAG_EMAIL"], let password = env["SAG_PASSWORD"] else {
            throw XCTSkip("Set TEST_RUNNER_SAG_EMAIL and TEST_RUNNER_SAG_PASSWORD (a test account on the local server).")
        }
        return (email, password)
    }

    var profileTab: XCUIElement { app.mainTabBar.buttons["Профиль"] }

    /// Launches the app on the sign-in screen. The session is kept between launches (that is the point of the app), so a previous
    /// run may have left the person signed in: sign out first.
    func launchSignedOut() {
        app.launch()
        if app.mainTabBar.waitForExistence(timeout: 4) {
            profileTab.tap()
            scrollUntilVisible(app.buttons["main.logout"])
            app.buttons["main.logout"].tap()
        }
    }

    /// Long lists build their rows lazily, so what is far down is not on screen (and not tappable) until scrolled to.
    func scrollUntilVisible(_ element: XCUIElement, attempts: Int = 8) {
        var left = attempts
        while !element.exists || !element.isHittable, left > 0 {
            app.swipeUp()
            left -= 1
        }
    }

    func signIn(email: String, password: String) {
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

    /// Launch, sign out if needed, sign in with the test account, wait for the tab bar.
    func launchSignedIn() throws {
        let (email, password) = try credentials()
        launchSignedOut()
        signIn(email: email, password: password)
        let opened = app.mainTabBar.waitForExistence(timeout: 10)
        let shown = app.staticTexts["login.error"].exists ? app.staticTexts["login.error"].label : "(no error shown)"
        XCTAssertTrue(opened, "the app did not open after signing in; the form says: \(shown)")
    }

    /// A text element whose label contains `text` (the system reads "Вид спорта" and its value as one element).
    func text(containing text: String) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    /// Replaces the text of a field. The field's reported value is not always the whole text (a multi-line field reports part of it),
    /// so delete far more characters than there can be instead of counting them.
    func replaceText(in field: XCUIElement, with text: String) {
        // A tap puts the cursor where it lands, and delete removes what is BEFORE the cursor: tap the end of the field first.
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.9)).tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 300))
        field.typeText(text)
    }
}
