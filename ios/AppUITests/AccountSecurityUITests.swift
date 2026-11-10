import XCTest

/// Account security against the local server: the devices where the person is signed in, the password, the email. It changes the password
/// of the account it signs in with, so it needs a THROWAWAY account that also has a second session (the seed script makes both; SAG_EMAIL).
final class AccountSecurityUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    /// A password box starts hidden: show what is typed (a secure field reports only bullets), then type.
    private func type(_ text: String, into id: String) {
        let toggle = app.buttons[id + ".toggle"].firstMatch
        if app.secureTextFields[id].exists, toggle.exists { toggle.tap() }
        let field = app.textFields[id].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), "no field \(id)")
        field.tap()
        field.typeText(text)
    }

    private func openSecurity() {
        profileTab.tap()
        let link = element("profile.security")
        scrollUntilVisible(link)
        XCTAssertTrue(link.waitForExistence(timeout: 10), "no «Безопасность аккаунта» in the profile")
        link.tap()
    }

    private func sessions() -> XCUIElementQuery { app.descendants(matching: .any).matching(identifier: "account.session") }

    func testOtherDevicesAreListedAndOneCanBeEnded() throws {
        try launchSignedIn()
        openSecurity()
        XCTAssertTrue(sessions().firstMatch.waitForExistence(timeout: 15), "no devices listed")
        let before = sessions().count
        XCTAssertGreaterThanOrEqual(before, 2, "this device and the one the seed script signed in")
        XCTAssertTrue(text(containing: "это устройство").exists)
        let end = element("account.endSession")
        scrollUntilVisible(end)
        end.tap()
        let deadline = Date().addingTimeInterval(15)
        while sessions().count >= before, Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.5)) }
        XCTAssertEqual(sessions().count, before - 1, "the ended device should disappear from the list")
        XCTAssertTrue(text(containing: "это устройство").exists, "ending another device must keep this one")
    }

    func testTheEmailChangeChecksTheFormAndAsksForTheCurrentPassword() throws {
        let (_, password) = try credentials()
        try launchSignedIn()
        openSecurity()
        element("account.changeEmail").tap()
        element("email.submit").tap()
        XCTAssertTrue(app.staticTexts["Введите email полностью, например name@example.com."].waitForExistence(timeout: 5), "an empty address is not checked")

        type("new-address@example.com", into: "email.new")
        type("not the password", into: "email.password")
        scrollUntilVisible(element("email.submit"))
        element("email.submit").tap()
        XCTAssertTrue(app.staticTexts["Неверный текущий пароль."].waitForExistence(timeout: 15), "a wrong password is not refused")

        let field = app.textFields["email.password"].firstMatch
        replaceText(in: field, with: password)
        scrollUntilVisible(element("email.submit"))
        element("email.submit").tap()
        XCTAssertTrue(element("email.done").waitForExistence(timeout: 15), "no confirmation that the letter went out")
    }

    func testThePasswordIsChangedAndTheNewOneSignsIn() throws {
        let (email, password) = try credentials()
        let fresh = "tennis court lantern \(Int(Date().timeIntervalSince1970))"
        try launchSignedIn()
        openSecurity()
        element("account.changePassword").tap()

        // the form says what is wrong before it asks the server
        element("password.submit").tap()
        XCTAssertTrue(app.staticTexts["Введите текущий пароль."].waitForExistence(timeout: 5))
        type(password, into: "password.current")
        type(fresh, into: "password.new")
        type("something else entirely", into: "password.confirm")
        scrollUntilVisible(element("password.submit"))
        element("password.submit").tap()
        XCTAssertTrue(app.staticTexts["Пароли не совпадают."].waitForExistence(timeout: 5), "mismatch not noticed")

        let confirm = app.textFields["password.confirm"].firstMatch
        replaceText(in: confirm, with: fresh)
        scrollUntilVisible(element("password.submit"))
        element("password.submit").tap()
        XCTAssertTrue(element("password.done").waitForExistence(timeout: 20), "the password was not changed")
        element("password.close").tap()

        // the new password works, the old one does not
        for _ in 0..<2 where !app.buttons["main.logout"].exists { app.navigationBars.buttons.firstMatch.tap() }  // back to the profile
        scrollUntilVisible(app.buttons["main.logout"])
        app.buttons["main.logout"].tap()
        signIn(email: email, password: password)
        XCTAssertTrue(app.staticTexts["login.error"].waitForExistence(timeout: 15), "the old password still signs in")
        app.terminate()
        app.launch()
        signIn(email: email, password: fresh)
        XCTAssertTrue(app.mainTabBar.waitForExistence(timeout: 15), "the new password does not sign in")
    }
}
