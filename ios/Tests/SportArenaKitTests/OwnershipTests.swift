import Foundation
import Testing
@testable import SportArenaKit

private let host = URL(string: "https://sportarenaglobal.ru")!
private let teamId = UUID(uuidString: "11111111-2222-4333-8444-555555555555")!

private func member(_ first: String, _ last: String?, role: String = "player", id: String = "AAAAAAAA-2222-4333-8444-555555555555") throws -> TeamMember {
    let lastField = last.map { "\"\($0)\"" } ?? "null"
    let json = """
    {"user_id":"\(id)","first_name":"\(first)","last_name":\(lastField),"username":null,"photo_url":null,"role":"\(role)","position":null,
     "joined_at":"2026-09-01T10:00:00Z"}
    """
    return try APIClient.decoder.decode(TeamMember.self, from: Data(json.utf8))
}

struct OwnershipTransferTests {
    @Test func thePhraseIsTheSitesWordForWord() throws {
        let anna = try member("Анна", "Петрова")
        #expect(OwnershipTransfer.phrase(teamName: "Орлы", to: anna) == "Я передаю роль главного тренера команды «Орлы» пользователю Анна Петрова")
    }

    @Test func aMissingLastNameLeavesNoTrailingSpace() throws {
        let ivan = try member("Иван", nil)
        #expect(OwnershipTransfer.phrase(teamName: "Орлы", to: ivan).hasSuffix("пользователю Иван"))
    }

    @Test func theRoleCanGoToAnyoneButTheHeadCoach() throws {
        let people = [
            try member("Борис", "Яковлев", role: "player", id: "BBBBBBBB-2222-4333-8444-555555555555"),
            try member("Глава", "Тренеров", role: "head_coach", id: "CCCCCCCC-2222-4333-8444-555555555555"),
            try member("Анна", "Петрова", role: "assistant_coach", id: "DDDDDDDD-2222-4333-8444-555555555555"),
        ]
        #expect(OwnershipTransfer.candidates(in: people).map(\.firstName) == ["Анна", "Борис"], "no head coach, sorted by name")
        #expect(OwnershipTransfer.candidates(in: []).isEmpty)
    }

    @Test func serverTextsAreSaidInRussianAndOthersKept() {
        #expect(OwnershipTransfer.russian(APIError(status: 403, code: "forbidden", message: "only the head coach")).message.contains("только главный тренер"))
        #expect(OwnershipTransfer.russian(APIError(status: 404, code: "not_found", message: "x")).message.contains("нет в команде"))
        #expect(OwnershipTransfer.russian(APIError(status: 400, code: "confirmation_mismatch", message: "x")).message.contains("обновите экран"))
        #expect(OwnershipTransfer.russian(APIError(status: 500, code: "boom", message: "Сбой")).message == "Сбой")
    }
}

struct OwnershipServiceTests {
    @Test func theTransferPostsTheMemberAndThePhrase() async throws {
        let seen = RequestLog()
        let api = APIClient(baseURL: host, session: MockServer.session { request in seen.add(request); return (204, [:], Data()) })
        let service = TeamsService(client: api)
        let anna = try member("Анна", "Петрова")
        try await service.transferOwnership(of: teamId, to: anna, teamName: "Орлы")
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "POST" && request.url?.path == "/api/teams/11111111-2222-4333-8444-555555555555/transfer-ownership")
        #expect((request.bodyJSON?["to_user_id"] as? String)?.lowercased() == "aaaaaaaa-2222-4333-8444-555555555555")
        #expect(request.bodyJSON?["confirmation_phrase"] as? String == "Я передаю роль главного тренера команды «Орлы» пользователю Анна Петрова")
    }
}
