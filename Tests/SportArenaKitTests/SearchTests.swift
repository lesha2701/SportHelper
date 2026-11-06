import Foundation
import Testing
@testable import SportArenaKit

private let host = URL(string: "https://sportarenaglobal.ru")!

struct SearchTests {
    private func make(_ handler: @escaping MockServer.Handler) -> SearchService {
        SearchService(client: APIClient(baseURL: host, session: MockServer.session(handler)))
    }

    private let found = """
    [{"type":"team","id":"11111111-2222-4333-8444-555555555501","title":"Спартак","subtitle":"Футбол",
      "team_id":"11111111-2222-4333-8444-555555555501","on_date":null},
     {"type":"exercise","id":"11111111-2222-4333-8444-555555555502","title":"Планка","subtitle":"Футбол","team_id":null,"on_date":null},
     {"type":"training","id":"11111111-2222-4333-8444-555555555503","title":"Игровая тренировка","subtitle":"Стадион",
      "team_id":"11111111-2222-4333-8444-555555555501","on_date":"2026-11-12"},
     {"type":"hologram","id":"11111111-2222-4333-8444-555555555504","title":"Что-то новое","subtitle":null,"team_id":null,"on_date":null}]
    """

    @Test func aQuestionIsTrimmedCutAndTooShortAQuestionIsNotAsked() {
        #expect(SearchLogic.question("  ан ") == "ан")
        #expect(SearchLogic.question("а") == nil && SearchLogic.question("   ") == nil && SearchLogic.question(" а ") == nil)
        #expect(SearchLogic.question(String(repeating: "я", count: 150))?.count == 100)
    }

    @Test func theQuestionGoesToTheServerAndTheKindsAreRead() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json(found) }
        let results = try await service.search(" спарт ")
        let request = try #require(seen.all.first)
        #expect(request.url?.path == "/api/search" && request.url?.query?.contains("q=%D1%81%D0%BF%D0%B0%D1%80%D1%82") == true)
        #expect(results.map(\.type) == [.team, .exercise, .training, .other])
        #expect(results[2].onDate == LocalDate(year: 2026, month: 11, day: 12) && results[2].teamId == results[0].id)
    }

    @Test func aShortQuestionMakesNoRequest() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json("[]") }
        #expect(try await service.search("а").isEmpty)
        #expect(seen.all.isEmpty)
    }

    @Test func groupsFollowTheSitesOrderAndAPlayerIsNotShownExercises() throws {
        let results = try APIClient.decoder.decode([SearchResult].self, from: Data(found.utf8))
        let forCoach = SearchLogic.groups(results, isCoach: true)
        #expect(forCoach.map(\.kind) == [.team, .training, .exercise])
        let forPlayer = SearchLogic.groups(results, isCoach: false)
        #expect(forPlayer.map(\.kind) == [.team, .training])
        #expect(forPlayer[0].kind.title == "Команды" && forPlayer[1].kind.title == "Тренировки")
    }

    @Test func theSameIdAsATeamAndAsAPlayerAreTwoResults() {
        let id = UUID()
        #expect(SearchResult(type: .team, id: id, title: "а").key != SearchResult(type: .player, id: id, title: "а").key)
    }
}
