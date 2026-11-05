import Foundation
import Testing
@testable import SportArenaKit

private let host = URL(string: "https://sportarenaglobal.ru")!
private let day = LocalDate(year: 2026, month: 11, day: 14)
private let evening = LocalTime(hour: 19, minute: 0)!
private let matchId = UUID(uuidString: "11111111-2222-4333-8444-555555555555")!
private let teamId = UUID(uuidString: "22222222-2222-4333-8444-555555555555")!

private func object(_ body: some Encodable) throws -> [String: Any] {
    try #require(try JSONSerialization.jsonObject(with: APIClient.encoder.encode(body)) as? [String: Any])
}

private func input(
    opponent: String = "Динамо", location: String = "", tournament: String = "", home: Bool = true
) -> MatchInput? {
    MatchInput(opponentName: opponent, date: day, time: evening, location: location, tournament: tournament, isHome: home)
}

private func matchJSON(score: String = #""our_score":null,"opponent_score":null,"result":null"#, status: String = "scheduled", roster: String? = nil) -> String {
    """
    {"id":"11111111-2222-4333-8444-555555555555","team_id":"22222222-2222-4333-8444-555555555555","created_by":"33333333-2222-4333-8444-555555555555",
    "opponent_name":"Динамо","match_date":"2026-11-14","start_time":"19:00:00","location":"Арена","is_home":false,"tournament":null,
    "status":"\(status)",\(score),"comment":null,"created_at":"2026-11-01T10:00:00Z","updated_at":"2026-11-01T10:00:00Z"\(roster.map { ",\"roster\":\($0)" } ?? "")}
    """
}

struct MatchInputTests {
    @Test func theTextIsTrimmedAndEmptyOptionalFieldsAreAbsent() throws {
        let value = try #require(input(opponent: "  Динамо ", location: "  ", tournament: " Кубок "))
        #expect(value.opponentName == "Динамо" && value.location == nil && value.tournament == "Кубок")
    }

    @Test func anOpponentIsRequiredAndLimited() {
        #expect(input(opponent: "   ") == nil)
        #expect(input(opponent: String(repeating: "я", count: 151)) == nil)
        #expect(input(opponent: String(repeating: "я", count: 150)) != nil)
        #expect(MatchInput.problem(opponentName: "", location: "", tournament: "") == "Укажите соперника.")
    }

    @Test func theLimitsOfTheServerAreKept() {
        #expect(input(location: String(repeating: "я", count: 201)) == nil && input(location: String(repeating: "я", count: 200)) != nil)
        #expect(input(tournament: String(repeating: "я", count: 151)) == nil && input(tournament: String(repeating: "я", count: 150)) != nil)
    }

    @Test(arguments: [(0, 0), (3, 1), (999, 999)])
    func aScoreInRangeIsAccepted(ours: Int, theirs: Int) {
        #expect(MatchResultInput(ourScore: ours, opponentScore: theirs) != nil)
    }

    @Test(arguments: [(-1, 0), (0, -1), (1000, 0), (0, 1000)])
    func aScoreOutOfRangeIsRefused(ours: Int, theirs: Int) {
        #expect(MatchResultInput(ourScore: ours, opponentScore: theirs) == nil)
    }

    @Test func theOutcomeFollowsTheScoreLikeOnTheServer() throws {
        #expect(try #require(MatchResultInput(ourScore: 2, opponentScore: 1)).outcome == .win)
        #expect(try #require(MatchResultInput(ourScore: 0, opponentScore: 4)).outcome == .loss)
        #expect(try #require(MatchResultInput(ourScore: 3, opponentScore: 3)).outcome == .draw)
    }

    @Test func aLongCommentIsRefused() {
        #expect(MatchResultInput(ourScore: 1, opponentScore: 0, comment: String(repeating: "я", count: 2001)) == nil)
        #expect(MatchResultInput(ourScore: 1, opponentScore: 0, comment: "  ")?.comment == nil)
    }
}

struct MatchModelTests {
    @Test func aMatchIsReadWithoutAScoreAndWithoutASquad() throws {
        let match = try APIClient.decoder.decode(TeamMatch.self, from: Data(matchJSON().utf8))
        #expect(match.opponentName == "Динамо" && match.matchDate == day && match.startTime == evening && !match.isHome)
        #expect(match.status == .scheduled && match.outcome == nil && match.scoreText == nil && !match.hasScore)
        #expect(match.roster.isEmpty && match.tournament == nil && match.location == "Арена")
    }

    @Test func aPlayedMatchHasAScoreOutcomeAndSquad() throws {
        let score = #""our_score":3,"opponent_score":1,"result":"win""#
        let squad = """
        [{"id":"aaaaaaaa-2222-4333-8444-555555555555","match_id":"11111111-2222-4333-8444-555555555555",
        "user_id":"bbbbbbbb-2222-4333-8444-555555555555","first_name":"Иван","last_name":"Петров","photo_url":null}]
        """
        let match = try APIClient.decoder.decode(TeamMatch.self, from: Data(matchJSON(score: score, status: "completed", roster: squad).utf8))
        #expect(match.scoreText == "3:1" && match.outcome == .win && match.status == .completed)
        #expect(match.roster.map(\.fullName) == ["Иван Петров"])
    }

    @Test func aMatchFromTheServerBecomesTheFormsValuesAgain() throws {
        let match = try APIClient.decoder.decode(TeamMatch.self, from: Data(matchJSON().utf8))
        let value = try #require(match.asInput)
        #expect(value.opponentName == "Динамо" && value.date == day && value.time == evening && value.location == "Арена" && !value.isHome)
    }

    @Test func everyStatusAndOutcomeHasRussianWording() {
        for status in MatchStatus.allCases { #expect(status.title.range(of: "[А-Яа-я]", options: .regularExpression) != nil) }
        #expect(MatchOutcome.win.title == "Победа" && MatchOutcome.loss.title == "Поражение" && MatchOutcome.draw.title == "Ничья")
    }
}

struct MatchBodyTests {
    @Test func addingSendsTheDateTheTimeAndSkipsEmptyFields() throws {
        let body = try object(MatchCreateBody(try #require(input(location: "Арена", home: false))))
        #expect(body["opponent_name"] as? String == "Динамо" && body["match_date"] as? String == "2026-11-14")
        #expect(body["start_time"] as? String == "19:00:00" && body["location"] as? String == "Арена" && body["is_home"] as? Bool == false)
        #expect(body["tournament"] == nil, "an empty field is simply not sent when adding")
    }

    @Test func changingSendsExplicitNullsSoClearedFieldsAreReallyCleared() throws {
        let body = try object(MatchUpdateBody(input: try #require(input()), status: "cancelled"))
        #expect(body["location"] is NSNull && body["tournament"] is NSNull)
        #expect(body["status"] as? String == "cancelled" && body["is_home"] as? Bool == true)
    }

    @Test func theScoreGoesWithAnExplicitNullCommentSoAnOldCommentIsCleared() throws {
        let body = try object(MatchResultBody(input: try #require(MatchResultInput(ourScore: 2, opponentScore: 2))))
        #expect(body["our_score"] as? Int == 2 && body["opponent_score"] as? Int == 2 && body["comment"] is NSNull)
    }
}

struct MatchesServiceTests {
    private func make(_ handler: @escaping MockServer.Handler) -> (MatchesService, APIClient) {
        let api = APIClient(baseURL: host, session: MockServer.session(handler))
        return (MatchesService(client: api), api)
    }

    @Test func theTeamsMatchesAreRead() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in seen.add(request); return json("[\(matchJSON())]") }
        let matches = try await service.matches(of: teamId)
        #expect(matches.count == 1 && seen.all.first?.url?.path == "/api/teams/\(teamId.uuidString.lowercased())/matches")
    }

    @Test func addingPostsToTheTeamWithTheToken() async throws {
        let seen = RequestLog()
        let (service, api) = make { request in seen.add(request); return json(matchJSON()) }
        await api.setCSRFToken("csrf-m")
        _ = try await service.create(try #require(input()), for: teamId)
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "POST" && request.url?.path == "/api/teams/\(teamId.uuidString.lowercased())/matches")
        #expect(request.value(forHTTPHeaderField: "X-CSRF-Token") == "csrf-m")
    }

    @Test func updatingPutsTheMatchWithItsStatus() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in seen.add(request); return json(matchJSON()) }
        _ = try await service.update(matchId, try #require(input()), status: .completed)
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "PUT" && request.url?.path == "/api/matches/\(matchId.uuidString.lowercased())")
        #expect((String(data: try #require(request.bodyData), encoding: .utf8) ?? "").contains("\"status\":\"completed\""))
    }

    @Test func theSquadReplacesWhatWasThereAndTheScoreHasItsOwnPath() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in seen.add(request); return json(matchJSON()) }
        let player = UUID()
        _ = try await service.setRoster(matchId, players: [player])
        _ = try await service.setResult(matchId, try #require(MatchResultInput(ourScore: 1, opponentScore: 0)))
        let calls = seen.all.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" }
        #expect(calls == ["PUT /api/matches/\(matchId.uuidString.lowercased())/roster", "POST /api/matches/\(matchId.uuidString.lowercased())/result"])
        #expect(seen.all[0].bodyJSON?["user_ids"] as? [String] == [player.uuidString])
    }

    @Test func deletingUsesDelete() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in seen.add(request); return (204, [:], Data()) }
        try await service.delete(matchId)
        #expect(seen.all.first?.httpMethod == "DELETE" && seen.all.first?.url?.path == "/api/matches/\(matchId.uuidString.lowercased())")
    }

    @Test func aForbiddenAnswerKeepsItsCode() async throws {
        let (service, _) = make { _ in json(#"{"error":{"code":"forbidden","message":"only the head coach","field":null,"retry_after":null}}"#, status: 403) }
        await #expect(throws: APIError.self) { _ = try await service.create(try #require(input()), for: teamId) }
    }
}
