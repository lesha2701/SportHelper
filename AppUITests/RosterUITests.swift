import XCTest

/// Roles of the people of a team, against the local server: the head coach makes a player captain and takes it back. Needs the head
/// coach's account and a team with a player (the seed script `seed_ios_chat.py`; the team's name is SAG_TEAM_NAME). Removing and blocking
/// are not run here: they would take the test player out of the team.
final class RosterUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }
    /// Swipe actions are found by their label: a subscript looks at identifiers only.
    private func action(_ title: String) -> XCUIElement { app.buttons.matching(NSPredicate(format: "label == %@", title)).firstMatch }
    private func button(_ id: String) -> XCUIElement { app.buttons[id].firstMatch }

    private func openTeam() throws {
        try launchSignedIn()
        app.tabBars.buttons["Команды"].tap()
        if let name = ProcessInfo.processInfo.environment["SAG_TEAM_NAME"] {
            let row = app.staticTexts[name]
            XCTAssertTrue(row.waitForExistence(timeout: 15), "the team \(name) is not in the list")
            row.tap()
        } else {
            let row = app.buttons["teams.team"].firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 15), "no team in the list")
            row.tap()
        }
        XCTAssertTrue(element("team.member").waitForExistence(timeout: 15), "no member listed")
    }

    private func member(withRole role: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "team.member").matching(NSPredicate(format: "label CONTAINS %@", role)).firstMatch
    }

    /// The row is scrolled out from under the tab bar and swiped: «Ещё» shows behind its trailing edge and opens the list of actions.
    /// A row with no actions (the head coach) has no «Ещё», and nothing opens.
    private func revealActions(of row: XCUIElement) {
        scrollUntilVisible(row)
        row.swipeLeft()
        let more = button("team.member.more")
        if more.waitForExistence(timeout: 2) { more.tap() }
    }

    func testTheHeadCoachMakesAPlayerCaptainAndTakesItBack() throws {
        try openTeam()
        guard element("team.edit").waitForExistence(timeout: 5) else { throw XCTSkip("needs the account of a coach of the team") }
        let head = member(withRole: "Главный тренер")
        XCTAssertTrue(head.waitForExistence(timeout: 5))

        // the head coach has nothing to do with themselves: no actions at all
        revealActions(of: head)
        XCTAssertFalse(action("Удалить из команды").waitForExistence(timeout: 1), "the head coach can be removed")
        XCTAssertFalse(action("Заблокировать").exists)

        // a captain left over from an interrupted run goes back to being a player first
        if !member(withRole: "Игрок").exists, member(withRole: "Капитан").exists {
            revealActions(of: member(withRole: "Капитан"))
            action("Снять с капитана").tap()
            XCTAssertTrue(member(withRole: "Игрок").waitForExistence(timeout: 10))
        }
        let player = member(withRole: "Игрок")
        guard player.waitForExistence(timeout: 5) else { throw XCTSkip("the team has no plain player") }
        revealActions(of: player)
        XCTAssertTrue(action("Назначить капитаном").waitForExistence(timeout: 5), "no «make captain» on a player")
        XCTAssertTrue(action("Назначить помощником").isHittable && action("Удалить из команды").isHittable && action("Заблокировать").isHittable,
                      "the head coach should see every action")
        action("Назначить капитаном").tap()
        XCTAssertTrue(element("team.notice").waitForExistence(timeout: 10))
        XCTAssertTrue(element("team.notice").label.contains("теперь капитан"), element("team.notice").label)
        XCTAssertTrue(member(withRole: "Капитан").waitForExistence(timeout: 10), "the role did not change in the list")

        revealActions(of: member(withRole: "Капитан"))
        XCTAssertTrue(action("Снять с капитана").waitForExistence(timeout: 5))
        action("Снять с капитана").tap()
        XCTAssertTrue(member(withRole: "Игрок").waitForExistence(timeout: 10), "the captain did not become a player again")
        XCTAssertFalse(member(withRole: "Капитан").exists)
    }

    func testRemovingAsksFirstAndCanBeCancelled() throws {
        try openTeam()
        guard element("team.edit").waitForExistence(timeout: 5) else { throw XCTSkip("needs the account of a coach of the team") }
        let player = member(withRole: "Игрок")
        guard player.waitForExistence(timeout: 5) else { throw XCTSkip("the team has no plain player") }
        revealActions(of: player)
        action("Удалить из команды").tap()
        XCTAssertTrue(button("team.member.confirm").waitForExistence(timeout: 5), "no question before removing")
        // cancel: nothing was removed
        let cancel = app.buttons.matching(NSPredicate(format: "label IN %@", ["Cancel", "Отмена"])).firstMatch
        if cancel.exists { cancel.tap() } else { app.otherElements["PopoverDismissRegion"].firstMatch.tap() }
        XCTAssertTrue(member(withRole: "Игрок").waitForExistence(timeout: 5), "the player must still be in the team")
    }
}
