import Foundation
import Observation
import SportArenaKit

/// Matches of a team: the schedule, the squad and the score. Nothing is kept here - every screen asks the server again.
@MainActor
@Observable
final class MatchesStore {
    private let service: MatchesService

    init(client: APIClient) { service = MatchesService(client: client) }

    func matches(of team: UUID) async -> Result<[TeamMatch], APIError> { await run { try await self.service.matches(of: team) } }
    func match(_ id: UUID) async -> Result<TeamMatch, APIError> { await run { try await self.service.match(id) } }
    func create(_ input: MatchInput, for team: UUID) async -> Result<TeamMatch, APIError> { await run { try await self.service.create(input, for: team) } }

    func update(_ id: UUID, _ input: MatchInput, status: MatchStatus) async -> Result<TeamMatch, APIError> {
        await run { try await self.service.update(id, input, status: status) }
    }

    func delete(_ id: UUID) async -> Result<Void, APIError> { await run { try await self.service.delete(id) } }
    func setRoster(_ id: UUID, players: [UUID]) async -> Result<TeamMatch, APIError> { await run { try await self.service.setRoster(id, players: players) } }
    func setResult(_ id: UUID, _ result: MatchResultInput) async -> Result<TeamMatch, APIError> { await run { try await self.service.setResult(id, result) } }

    private func run<Value: Sendable>(_ work: @escaping @Sendable () async throws -> Value) async -> Result<Value, APIError> {
        await apiResult(translate: Self.russian, work)
    }

    nonisolated static func russian(_ error: APIError) -> APIError {
        let text: String? = switch error.code {
        case "forbidden": "Матчами управляет тренерский состав команды."
        case "not_found": "Матч не найден: возможно, его удалили."
        default: nil
        }
        return text.map(error.saying) ?? error
    }
}
