import Foundation
import Testing
@testable import SportArenaKit

private let host = URL(string: "https://sportarenaglobal.ru")!
private let team = UUID(uuidString: "11111111-2222-4333-8444-555555555555")!
private let person = UUID(uuidString: "AAAAAAAA-2222-4333-8444-555555555555")!

struct RosterRulesTests {
    @Test func theHeadCoachCanDoEverythingWithAPlayer() {
        #expect(RosterAction.available(actor: .headCoach, target: .player, isSelf: false) == [.makeCaptain, .makeAssistant, .remove, .block])
    }

    @Test func theHeadCoachCanTakeTheCaptainOrAnAssistantBackToPlayer() {
        #expect(RosterAction.available(actor: .headCoach, target: .captain, isSelf: false) == [.removeCaptain, .makeAssistant, .remove, .block])
        #expect(RosterAction.available(actor: .headCoach, target: .assistantCoach, isSelf: false) == [.makeCaptain, .removeAssistant, .remove, .block])
    }

    @Test func anAssistantManagesPlayersButNeitherAssistantsNorBlocks() {
        #expect(RosterAction.available(actor: .assistantCoach, target: .player, isSelf: false) == [.makeCaptain, .remove])
        #expect(RosterAction.available(actor: .assistantCoach, target: .captain, isSelf: false) == [.removeCaptain, .remove])
        #expect(RosterAction.available(actor: .assistantCoach, target: .assistantCoach, isSelf: false).isEmpty)
    }

    @Test func nobodyTouchesTheHeadCoachOrThemselvesAndPlayersManageNobody() {
        #expect(RosterAction.available(actor: .headCoach, target: .headCoach, isSelf: true).isEmpty)
        #expect(RosterAction.available(actor: .assistantCoach, target: .headCoach, isSelf: false).isEmpty)
        #expect(RosterAction.available(actor: .headCoach, target: .player, isSelf: true).isEmpty)
        #expect(RosterAction.available(actor: .captain, target: .player, isSelf: false).isEmpty)
        #expect(RosterAction.available(actor: .player, target: .player, isSelf: false).isEmpty)
        #expect(RosterAction.available(actor: nil, target: .player, isSelf: false).isEmpty)
    }

    @Test func theRoleActionsNameTheRoleTheServerTakes() {
        #expect(RosterAction.makeCaptain.newRole == "captain" && RosterAction.makeAssistant.newRole == "assistant_coach")
        #expect(RosterAction.removeCaptain.newRole == "player" && RosterAction.removeAssistant.newRole == "player")
        #expect(RosterAction.remove.newRole == nil && RosterAction.block.newRole == nil)
    }

    @Test func onlyRemovingAndBlockingAskFirstAndBlockingSaysItCannotBeUndone() throws {
        #expect(RosterAction.makeCaptain.confirmation(for: "Анна") == nil && RosterAction.removeAssistant.confirmation(for: "Анна") == nil)
        let remove = try #require(RosterAction.remove.confirmation(for: "Анна Петрова"))
        #expect(remove.title == "Удалить Анна Петрова из команды?")
        let block = try #require(RosterAction.block.confirmation(for: "Анна"))
        #expect(block.message.contains("не отменить") && RosterAction.block.isDestructive && !RosterAction.makeCaptain.isDestructive)
    }

    @Test func serverTextsAreSaidInRussianAndOthersKept() {
        let captain = RosterAction.russian(APIError(status: 409, code: "captain_already_assigned", message: "the team already has a captain"))
        #expect(captain.message.contains("уже есть капитан") && captain.code == "captain_already_assigned" && captain.status == 409)
        #expect(RosterAction.russian(APIError(status: 403, code: "forbidden", message: "only the head coach")).message == "Это действие вам недоступно.")
        #expect(RosterAction.russian(APIError(status: 404, code: "not_found", message: "Не найдено")).message == "Не найдено")
    }
}

struct RosterServiceTests {
    private func make(_ handler: @escaping MockServer.Handler) -> (TeamsService, APIClient) {
        let api = APIClient(baseURL: host, session: MockServer.session(handler))
        return (TeamsService(client: api), api)
    }

    @Test func aRoleIsPatchedToTheMembersPathWithOnlyTheRole() async throws {
        let seen = RequestLog()
        let (service, api) = make { request in seen.add(request); return (204, [:], Data()) }
        await api.setCSRFToken("csrf-r")
        try await service.setRole("captain", of: person, in: team)
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "PATCH" && request.url?.path == "/api/teams/11111111-2222-4333-8444-555555555555/members/aaaaaaaa-2222-4333-8444-555555555555")
        #expect(request.value(forHTTPHeaderField: "X-CSRF-Token") == "csrf-r")
        #expect(request.bodyJSON as? [String: String] == ["role": "captain"], "the position must stay as it is")
    }

    @Test func removingIsADeleteAndBlockingAPost() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in seen.add(request); return (204, [:], Data()) }
        try await service.remove(person, from: team)
        try await service.block(person, in: team)
        #expect(seen.all.map(\.httpMethod) == ["DELETE", "POST"])
        #expect(seen.all[0].url?.path.hasSuffix("/members/aaaaaaaa-2222-4333-8444-555555555555") == true)
        #expect(seen.all[1].url?.path.hasSuffix("/members/aaaaaaaa-2222-4333-8444-555555555555/block") == true)
        #expect(seen.all[0].httpBody == nil && seen.all[0].bodyData == nil)
    }

    @Test func aRefusalCarriesTheServersCode() async {
        let (service, _) = make { _ in
            (409, ["Content-Type": "application/json"], Data(#"{"error":{"code":"captain_already_assigned","message":"the team already has a captain"}}"#.utf8))
        }
        do {
            try await service.setRole("captain", of: person, in: team)
            Issue.record("a refused change must throw")
        } catch let error as APIError {
            #expect(error.code == "captain_already_assigned" && error.status == 409)
        } catch {
            Issue.record("unexpected \(error)")
        }
    }
}
