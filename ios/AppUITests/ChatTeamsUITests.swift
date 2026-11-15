import XCTest

/// Chats and teams, against the local server. The data comes from the local seed script (`seed_ios_chat.py`): a team the test accounts
/// belong to, an invitation token for a second athlete (SAG_INVITE), the new team's name (SAG_TEAM_NAME) and a paid upcoming session.
final class ChatTeamsUITests: SignedInUITestCase {
    private var teamsTab: XCUIElement { app.mainTabBar.buttons["Команды"] }
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }
    private func env(_ key: String) -> String? { ProcessInfo.processInfo.environment[key] }

    private func openTeams() throws {
        try launchSignedIn()
        teamsTab.tap()
        XCTAssertTrue(app.navigationBars["Команды"].waitForExistence(timeout: 10), "the teams screen did not open")
    }

    /// Opens the team named in SAG_TEAM_NAME, or the first one of the list.
    private func openTeam() throws {
        try openTeams()
        if let name = env("SAG_TEAM_NAME") {
            let row = app.staticTexts[name]
            XCTAssertTrue(row.waitForExistence(timeout: 15), "the team \(name) is not in the list")
            row.tap()
        } else {
            let row = app.buttons["teams.team"].firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 15), "no team in the list")
            row.tap()
        }
    }

    private func write(_ text: String) {
        let input = element("chat.input")
        XCTAssertTrue(input.waitForExistence(timeout: 10), "the message field did not appear")
        input.tap()
        input.typeText(text)
        element("chat.send").tap()
    }

    // MARK: team chat

    func testTheTeamChatSendsAMessageAndKeepsItAfterReopening() throws {
        try openTeam()
        XCTAssertTrue(element("team.chat").waitForExistence(timeout: 15), "the team screen has no chat row")
        element("team.chat").tap()

        let text = "ios-\(Int(Date().timeIntervalSince1970))"
        write(text)
        XCTAssertTrue(app.staticTexts[text].waitForExistence(timeout: 15), "the message did not appear in the chat")
        XCTAssertFalse(element("chat.failed").exists, "the message should not have failed")
        XCTAssertFalse(app.staticTexts["Отправляется…"].waitForExistence(timeout: 1), "the message stays unconfirmed")

        // leave the chat and come back: the message must have reached the server, not only the screen
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(element("team.chat").waitForExistence(timeout: 10))
        element("team.chat").tap()
        XCTAssertTrue(app.staticTexts[text].waitForExistence(timeout: 15), "the message is gone after reopening the chat")
    }

    func testTheTeamScreenShowsThePeopleAndTheRole() throws {
        try openTeam()
        // the people are under the tiles: below the first screen, so the page is scrolled to them
        scrollUntilVisible(element("team.member"))
        XCTAssertTrue(element("team.member").waitForExistence(timeout: 15), "no member listed")
        XCTAssertTrue(text(containing: "Состав").exists)
        // the role is a pill under the team's name (in capitals, so compared without case)
        let roles = ["Главный тренер", "Помощник тренера", "Капитан", "Игрок"]
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label IN[c] %@", roles)).firstMatch.exists, "the person's role is not shown")
    }

    // MARK: personal training chat

    func testThePaidSessionHasAChatThatSends() throws {
        try launchSignedIn()
        profileTab.tap()
        let myBookings = app.buttons["profile.myBookings"]
        let coachBookings = app.buttons["profile.coachBookings"]
        // the rows are below the profile details: scroll until the one for this kind of account is on screen
        var swipes = 0
        while !(myBookings.isHittable || coachBookings.isHittable), swipes < 8 { app.swipeUp(); swipes += 1 }
        (myBookings.isHittable ? myBookings : coachBookings).tap()

        let chat = app.buttons["booking.chat"].firstMatch
        scrollUntilVisible(chat, attempts: 6)
        guard chat.waitForExistence(timeout: 15) else { throw XCTSkip("No paid session with a chat for this account (run the seed script).") }
        chat.tap()

        let text = "session-\(Int(Date().timeIntervalSince1970))"
        write(text)
        XCTAssertTrue(app.staticTexts[text].waitForExistence(timeout: 15), "the message did not appear in the session chat")
        XCTAssertFalse(element("chat.failed").exists)
    }

    // MARK: teams

    func testACoachCreatesATeamAndItAppearsInTheList() throws {
        try openTeams()
        element("teams.add").tap()
        let create = app.buttons["teams.create"]
        guard create.waitForExistence(timeout: 5) else { throw XCTSkip("Creating a team needs a coach account.") }
        create.tap()

        let name = "Тест \(Int(Date().timeIntervalSince1970))"
        let nameField = app.textFields["teamForm.name"]
        XCTAssertTrue(nameField.waitForExistence(timeout: 5))
        nameField.tap()
        nameField.typeText(name)
        // The sport is chosen from the list (the same one as in the profile), not typed.
        let sport = app.buttons["teamForm.sport"]
        XCTAssertTrue(sport.waitForExistence(timeout: 5), "the sport is not a choice from a list")
        sport.tap()
        let football = app.buttons["Футбол"]
        XCTAssertTrue(football.waitForExistence(timeout: 5), "the list of sports has no football")
        football.tap()
        app.buttons["teamForm.save"].tap()

        XCTAssertTrue(app.staticTexts[name].waitForExistence(timeout: 15), "the new team is not in the list")
    }

    func testAnAthleteAppliesWithAnInvitationAndTheCoachAccepts() throws {
        guard let token = env("SAG_INVITE") else { throw XCTSkip("Set TEST_RUNNER_SAG_INVITE (a fresh invitation token) for this test.") }
        try openTeams()
        element("teams.add").tap()
        let entry = app.buttons["teams.join"]
        XCTAssertTrue(entry.waitForExistence(timeout: 5), "the menu has no way to join")
        entry.tap()

        let input = element("join.input")
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap()
        input.typeText("https://sportarenaglobal.ru/?invite=\(token)")
        app.buttons["join.find"].tap()
        XCTAssertTrue(element("join.teamName").waitForExistence(timeout: 15), "the invitation did not lead to a team: \(element("join.error").exists ? element("join.error").label : "")")
        app.buttons["join.apply"].tap()
        XCTAssertTrue(element("join.pending").waitForExistence(timeout: 15) || element("join.joined").exists, "no result of applying")
    }

    func testACoachSeesAndAcceptsAnApplication() throws {
        guard env("SAG_TEAM_NAME") != nil else { throw XCTSkip("Set TEST_RUNNER_SAG_TEAM_NAME (the team the athlete applied to).") }
        try openTeam()
        let accept = element("team.accept")
        guard accept.waitForExistence(timeout: 15) else { throw XCTSkip("No application waiting; an athlete has to apply first.") }
        accept.tap()
        XCTAssertTrue(element("team.notice").waitForExistence(timeout: 10))
        XCTAssertTrue(element("team.notice").label.contains("теперь в команде"), element("team.notice").label)
    }

    func testACoachCreatesAnInvitationLink() throws {
        try openTeam()
        guard element("team.createInvite").waitForExistence(timeout: 15) else { throw XCTSkip("Invitations are created by the coaching staff.") }
        scrollUntilVisible(element("team.createInvite"))
        element("team.createInvite").tap()
        let link = element("team.inviteLink")
        XCTAssertTrue(link.waitForExistence(timeout: 10), "no link was shown")
        XCTAssertTrue(link.label.contains("invite="), link.label)
    }
}
