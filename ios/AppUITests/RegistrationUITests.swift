import XCTest

/// Signing up and recovering a password against the local server. Nobody signs in: the new accounts stay unconfirmed (the letter goes
/// nowhere in the test), which is exactly what the sign-in screen must then explain.
final class RegistrationUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }
    private func field(_ id: String) -> XCUIElement { app.textFields[id].firstMatch }

    private func type(_ text: String, into field: XCUIElement) {
        scrollUntilVisible(field)
        field.tap()
        field.typeText(text)
    }

    /// Passwords are typed with the eye on: a secure field reports only bullets.
    private func typePassword(_ text: String, id: String) {
        let hidden = app.secureTextFields[id]
        scrollUntilVisible(hidden.exists ? hidden : field(id))
        let toggle = element(id + ".toggle")
        if toggle.exists, app.secureTextFields[id].exists { toggle.tap() }
        let shown = field(id)
        shown.tap()
        shown.typeText(text)
    }

    private func openRegistration() {
        launchSignedOut()
        XCTAssertTrue(element("login.register").waitForExistence(timeout: 10), "no way to create an account on the sign-in screen")
        element("login.register").tap()
        XCTAssertTrue(element("register.role.player").waitForExistence(timeout: 10), "the sign-up form did not open")
    }

    func testAnEmptyFormNamesEveryProblem() throws {
        openRegistration()
        scrollUntilVisible(element("register.submit"))
        element("register.submit").tap()

        XCTAssertTrue(app.staticTexts["Укажите имя."].waitForExistence(timeout: 5), "no complaint about the name")
        XCTAssertTrue(app.staticTexts["Выберите, кто вы: игрок или тренер."].exists, "no complaint about the role")
        XCTAssertTrue(app.staticTexts["Введите email полностью, например name@example.com."].exists)
    }

    func testTheBoxesBelongToTheRoleAndNothingIsTickedInAdvance() throws {
        openRegistration()
        element("register.role.player").tap()
        XCTAssertTrue(element("register.consent.terms").waitForExistence(timeout: 5))
        XCTAssertFalse(element("register.consent.coach_offer").exists)
        XCTAssertEqual(element("register.consent.terms").value as? String, "Не отмечено")

        element("register.consent.terms").tap()
        XCTAssertEqual(element("register.consent.terms").value as? String, "Отмечено")

        // another role starts the boxes over: coaches have three, and nothing carries over
        element("register.role.coach").tap()
        XCTAssertTrue(element("register.consent.data_dissemination").waitForExistence(timeout: 5))
        XCTAssertFalse(element("register.consent.terms").exists)
        XCTAssertEqual(element("register.consent.personal_data").value as? String, "Не отмечено")
    }

    func testAFilledFormWithoutTheBoxesAsksForThem() throws {
        openRegistration()
        element("register.role.player").tap()
        type("Олег", into: field("register.firstName"))
        type("ios-\(Int(Date().timeIntervalSince1970))@example.com", into: field("register.email"))
        typePassword("a long passphrase here", id: "register.password")
        typePassword("a long passphrase here", id: "register.passwordConfirm")
        scrollUntilVisible(element("register.submit"))
        element("register.submit").tap()

        XCTAssertTrue(element("register.consent.missing").waitForExistence(timeout: 5), "the unticked boxes are not pointed out")
        XCTAssertFalse(element("checkEmail.text").exists, "an account must not be created without the consents")
    }

    func testSigningUpLeadsToTheMailScreenAndTheSignInExplainsAnUnconfirmedAddress() throws {
        openRegistration()
        let address = "ios-\(Int(Date().timeIntervalSince1970))@example.com"
        element("register.role.player").tap()
        type("Олег", into: field("register.firstName"))
        type(address, into: field("register.email"))
        typePassword("a long passphrase here", id: "register.password")
        typePassword("a long passphrase here", id: "register.passwordConfirm")
        scrollUntilVisible(element("register.consent.terms"))
        element("register.consent.terms").tap()
        scrollUntilVisible(element("register.consent.personal_data"))
        element("register.consent.personal_data").tap()
        scrollUntilVisible(element("register.submit"))
        element("register.submit").tap()

        let text = element("checkEmail.text")
        let why = element("register.error").exists ? element("register.error").label : ""
        XCTAssertTrue(text.waitForExistence(timeout: 15), "no «check your mail» screen: \(why)")
        XCTAssertTrue(text.label.contains(address), "the screen does not name the address: \(text.label)")

        // «Я подтвердил — войти» returns to the sign-in with the address filled in; the server then says it is not confirmed
        element("checkEmail.signIn").tap()
        let email = app.textFields["login.email"]
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        XCTAssertEqual(email.value as? String, address, "the address should be carried to the sign-in")
        app.buttons["login.togglePassword"].tap()
        let password = app.textFields["login.password"]
        XCTAssertTrue(password.waitForExistence(timeout: 5))
        password.tap()
        password.typeText("a long passphrase here")
        app.buttons["login.submit"].tap()

        XCTAssertTrue(app.staticTexts["login.error"].waitForExistence(timeout: 10), "no explanation for an unconfirmed address")
        XCTAssertTrue(element("login.confirmEmail").waitForExistence(timeout: 5), "no way to ask for the letter again")
    }

    func testAnAddressThatIsTakenOffersToSignInOrRecoverThePassword() throws {
        let (existing, _) = try credentials()
        openRegistration()
        element("register.role.player").tap()
        type("Олег", into: field("register.firstName"))
        type(existing, into: field("register.email"))
        typePassword("a long passphrase here", id: "register.password")
        typePassword("a long passphrase here", id: "register.passwordConfirm")
        scrollUntilVisible(element("register.consent.terms"))
        element("register.consent.terms").tap()
        scrollUntilVisible(element("register.consent.personal_data"))
        element("register.consent.personal_data").tap()
        scrollUntilVisible(element("register.submit"))
        element("register.submit").tap()

        XCTAssertTrue(element("register.toLogin").waitForExistence(timeout: 15), "no offer to sign in instead")
        XCTAssertTrue(element("register.toForgot").exists)
    }

    func testAForgottenPasswordIsAnsweredWithoutRevealingWhetherTheAddressExists() throws {
        launchSignedOut()
        XCTAssertTrue(element("login.forgot").waitForExistence(timeout: 10))
        element("login.forgot").tap()
        let email = field("forgot.email")
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        XCTAssertFalse(element("forgot.send").isEnabled, "nothing to send yet")
        email.tap()
        email.typeText("nobody-\(UUID().uuidString.prefix(8))@example.com")
        element("forgot.send").tap()
        let why = element("forgot.error").exists ? element("forgot.error").label : ""
        XCTAssertTrue(element("forgot.answer").waitForExistence(timeout: 15), "no answer: \(why)")
    }
}
