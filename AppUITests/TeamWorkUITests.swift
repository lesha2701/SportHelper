import XCTest

/// Tasks and matches of a team, against the local server. The coach tests need a coach of a team (SAG_TEAM_NAME picks the team),
/// the player tests a player of it. Seeded data comes from the environment: SAG_REVIEW_TASK (a task already handed in, to be reviewed),
/// SAG_TODO_TASK (a task waiting for the player) and SAG_OPPONENT (a match with the player in the squad).
final class TeamWorkUITests: SignedInUITestCase {
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }
    private var env: [String: String] { ProcessInfo.processInfo.environment }
    private func stamp() -> String { String(Int(Date().timeIntervalSince1970)) }

    private func openTeam() throws {
        try launchSignedIn()
        app.mainTabBar.buttons["Команды"].tap()
        XCTAssertTrue(app.navigationBars["Команды"].waitForExistence(timeout: 10))
        if let name = env["SAG_TEAM_NAME"] {
            let row = app.staticTexts[name]
            XCTAssertTrue(row.waitForExistence(timeout: 15), "the team \(name) is not in the list")
            row.tap()
        } else {
            let row = app.buttons["teams.team"].firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 15), "no team in the list")
            row.tap()
        }
    }

    private func openTasks() throws {
        try openTeam()
        XCTAssertTrue(element("team.tasks").waitForExistence(timeout: 15))
        element("team.tasks").tap()
        XCTAssertTrue(app.navigationBars["Задания"].waitForExistence(timeout: 10), "the tasks did not open")
    }

    private func openMatches() throws {
        try openTeam()
        XCTAssertTrue(element("team.matches").waitForExistence(timeout: 15))
        element("team.matches").tap()
        XCTAssertTrue(app.navigationBars["Матчи"].waitForExistence(timeout: 10), "the matches did not open")
    }

    /// The list builds only the rows near the screen: scroll until the text is on screen.
    private func reveal(_ title: String) -> XCUIElement {
        let row = app.staticTexts[title].firstMatch
        _ = row.waitForExistence(timeout: 15)
        scrollUntilVisible(row, attempts: 20)
        return row
    }

    /// Waits until the element's label contains the text (a status changes after the server has answered).
    private func waitForLabel(_ target: XCUIElement, containing text: String, timeout: TimeInterval = 10) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if target.exists, target.label.contains(text) { return true }
            Thread.sleep(forTimeInterval: 0.3)
        }
        return false
    }

    private func requireCoach(_ id: String) throws {
        guard element(id).waitForExistence(timeout: 8) else { throw XCTSkip("This needs a coach of the team.") }
    }

    private func requirePlayer(_ id: String) throws {
        if element(id).waitForExistence(timeout: 4) { throw XCTSkip("This needs a player, the account is a coach.") }
    }

    // MARK: coach - tasks

    func testACoachGivesATaskToTheWholeTeamAndDeletesIt() throws {
        try openTasks()
        try requireCoach("tasks.add")
        element("tasks.add").tap()
        let title = "Тест-задание \(stamp())"
        let field = app.textFields["taskForm.title"]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the form did not open")
        field.tap()
        field.typeText(title + "\n")
        element("taskForm.save").tap()
        let row = reveal(title)
        XCTAssertTrue(row.exists, "the new task is not in the list: \(element("taskForm.error").exists ? element("taskForm.error").label : "")")
        row.tap()
        XCTAssertTrue(element("task.title").waitForExistence(timeout: 10))
        XCTAssertEqual(element("task.title").label, title)
        XCTAssertTrue(element("task.assignment").waitForExistence(timeout: 10), "the task should be given to the players of the team")
        element("task.actions").tap()
        app.buttons["Удалить"].tap()
        app.buttons["Удалить"].tap()  // the confirmation
        XCTAssertTrue(app.navigationBars["Задания"].waitForExistence(timeout: 10), "deleting should go back to the list")
        XCTAssertFalse(app.staticTexts[title].waitForExistence(timeout: 3), "the deleted task is still listed")
    }

    func testACoachAcceptsASubmittedTask() throws {
        guard let title = env["SAG_REVIEW_TASK"] else { throw XCTSkip("Set TEST_RUNNER_SAG_REVIEW_TASK (a task handed in by a player).") }
        try openTasks()
        try requireCoach("tasks.add")
        let row = reveal(title)
        XCTAssertTrue(row.exists, "the task \(title) is not in the list")
        row.tap()
        XCTAssertTrue(element("task.assignment").waitForExistence(timeout: 10))
        element("task.assignment").tap()
        XCTAssertTrue(element("review.status").waitForExistence(timeout: 10))
        XCTAssertTrue(element("review.status").label.contains("Ждёт проверки"), element("review.status").label)
        XCTAssertTrue(text(containing: "Всё сделал").exists, "what the player wrote should be shown")
        let comment = element("review.comment")
        comment.tap()
        comment.typeText("Отлично")
        element("review.accept").tap()
        XCTAssertTrue(element("task.assignment").waitForExistence(timeout: 10), "accepting should go back to the task")
        XCTAssertTrue(text(containing: "Принято").waitForExistence(timeout: 10), "the part should now be accepted")
    }

    // MARK: coach - matches

    func testACoachAddsAMatchEntersTheScoreNamesTheSquadAndDeletesIt() throws {
        try openMatches()
        try requireCoach("matches.add")
        element("matches.add").tap()
        let opponent = "Тест-соперник \(stamp())"
        let field = app.textFields["matchForm.opponent"]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "the form did not open")
        field.tap()
        field.typeText(opponent + "\n")
        element("matchForm.save").tap()
        let row = reveal("против \(opponent)")
        XCTAssertTrue(row.exists, "the new match is not in the list: \(element("matchForm.error").exists ? element("matchForm.error").label : "")")
        row.tap()
        XCTAssertTrue(element("match.opponent").waitForExistence(timeout: 10))

        element("match.result").tap()
        let ours = app.textFields["matchResult.ours"]
        XCTAssertTrue(ours.waitForExistence(timeout: 10))
        ours.tap()
        ours.typeText("3")
        let theirs = app.textFields["matchResult.theirs"]
        theirs.tap()
        theirs.typeText("1")
        element("matchResult.save").tap()
        XCTAssertTrue(element("match.score").waitForExistence(timeout: 10))
        XCTAssertEqual(element("match.score").label, "3:1")
        XCTAssertEqual(element("match.outcome").label, "Победа")

        element("match.squad").tap()
        let player = element("squad.player")
        guard player.waitForExistence(timeout: 10) else { throw XCTSkip("The team has no players to name.") }
        player.tap()
        element("squad.save").tap()
        XCTAssertTrue(element("match.player").waitForExistence(timeout: 10), "the named player should be in the squad")

        element("match.actions").tap()
        app.buttons["Удалить"].tap()
        app.buttons["Удалить"].tap()  // the confirmation
        XCTAssertTrue(app.navigationBars["Матчи"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["против \(opponent)"].waitForExistence(timeout: 3), "the deleted match is still listed")
    }

    // MARK: player

    func testAPlayerDoesATaskFromTheProfile() throws {
        guard let title = env["SAG_TODO_TASK"] else { throw XCTSkip("Set TEST_RUNNER_SAG_TODO_TASK (a task waiting for the player).") }
        try launchSignedIn()
        profileTab.tap()
        scrollUntilVisible(element("profile.myTasks"))
        element("profile.myTasks").tap()
        let row = reveal(title)
        XCTAssertTrue(row.exists, "the task \(title) is not in My tasks")
        row.tap()
        XCTAssertTrue(element("task.status").waitForExistence(timeout: 10))
        XCTAssertFalse(element("task.coachComment").exists)
        element("task.start").tap()
        XCTAssertTrue(waitForLabel(element("task.status"), containing: "Выполняется"), "the task should be in progress: \(element("task.status").label)")

        element("task.submit").tap()
        let sets = app.textFields["submit.sets"]
        XCTAssertTrue(sets.waitForExistence(timeout: 10), "the task asks for sets and reps")
        XCTAssertFalse(element("submit.send").isEnabled, "nothing is filled in yet")
        sets.tap()
        sets.typeText("3")
        let reps = app.textFields["submit.reps"]
        reps.tap()
        reps.typeText("12")
        let comment = element("submit.comment")
        comment.tap()
        comment.typeText("Сделал")
        XCTAssertTrue(element("submit.send").isEnabled, "everything the task asks for is filled in")
        element("submit.send").tap()
        XCTAssertTrue(waitForLabel(element("task.status"), containing: "Ждёт проверки"), "the task should wait for the coach: \(element("task.status").label)")
        XCTAssertTrue(text(containing: "3 × 12").exists, "the handed-in values should be shown")
        XCTAssertFalse(element("task.submit").exists, "a handed-in task cannot be handed in again")
    }

    func testAPlayerSeesTheirMatchWithTheSquadAndCannotManageAnything() throws {
        guard let opponent = env["SAG_OPPONENT"] else { throw XCTSkip("Set TEST_RUNNER_SAG_OPPONENT (a match of the team).") }
        try openMatches()
        try requirePlayer("matches.add")
        let row = reveal("против \(opponent)")
        XCTAssertTrue(row.exists, "the match is not in the list")
        row.tap()
        XCTAssertTrue(element("match.opponent").waitForExistence(timeout: 10))
        XCTAssertTrue(element("match.player").waitForExistence(timeout: 10), "the squad should be shown")
        XCTAssertFalse(element("match.result").exists || element("match.squad").exists || element("match.actions").exists)
    }

    func testAPlayerHasNoWayToGiveTasks() throws {
        try openTasks()
        try requirePlayer("tasks.add")
        XCTAssertTrue(element("tasks.list").waitForExistence(timeout: 10))
    }
}
