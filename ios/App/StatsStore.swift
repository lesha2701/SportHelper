import Foundation
import Observation
import SportArenaKit

/// The numbers of a team and of a player, the measured values and the written analyses. Nothing is kept here - every screen asks again.
@MainActor
@Observable
final class StatsStore {
    private let service: StatsService

    init(client: APIClient) { service = StatsService(client: client) }

    func team(_ id: UUID) async -> Result<TeamStats, APIError> { await run { try await self.service.team(id) } }
    func player(_ id: UUID) async -> Result<PlayerStats, APIError> { await run { try await self.service.player(id) } }

    func addMetric(_ input: MetricInput, for user: UUID) async -> Result<Metric, APIError> { await run { try await self.service.addMetric(input, for: user) } }
    func updateMetric(_ id: UUID, _ input: MetricInput) async -> Result<Metric, APIError> { await run { try await self.service.updateMetric(id, input) } }
    func deleteMetric(_ id: UUID) async -> Result<Void, APIError> { await run { try await self.service.deleteMetric(id) } }

    func progressAnalysis() async -> Result<String, APIError> { await run { try await self.service.progressAnalysis() } }
    func teamSummary(_ team: UUID) async -> Result<String, APIError> { await run { try await self.service.teamSummary(team) } }
    func attendanceAnalysis(_ team: UUID) async -> Result<String, APIError> { await run { try await self.service.attendanceAnalysis(team) } }
    func reportAnalysis(_ team: UUID) async -> Result<String, APIError> { await run { try await self.service.reportAnalysis(team) } }

    private func run<Value: Sendable>(_ work: @escaping @Sendable () async throws -> Value) async -> Result<Value, APIError> {
        await apiResult(translate: Self.russian, work)
    }

    nonisolated static func russian(_ error: APIError) -> APIError {
        let text: String? = switch error.code {
        case "forbidden":
            error.message.contains("team statistics") ? "Статистика команды доступна тренерскому составу."
                : "Нет доступа к данным этого игрока."
        case "not_found": "Показатель не найден: возможно, его уже удалили."
        case "player_profile_required": "Рекомендации ИИ доступны только с заполненным профилем игрока."
        case "coach_profile_required": "Разборы ИИ доступны тренеру с заполненным профилем."
        // A server without the AI keys names its settings in the message: that is for the one who runs it, not for the person.
        case "ai_unavailable" where error.message.contains("YANDEX"): "ИИ сейчас недоступен. Попробуйте позже."
        default: nil
        }
        return text.map(error.saying) ?? error
    }
}
