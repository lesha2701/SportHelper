import Foundation

/// The numbers of a team and of a player, the measured values of a player, and the written analyses.
public final class StatsService: Sendable {
    private let client: APIClient

    /// An analysis is written by a language model, which takes a while.
    static let analysisTimeout: TimeInterval = 120

    public init(client: APIClient) { self.client = client }

    private func team(_ id: UUID, _ tail: String) -> String { "/api/teams/\(id.uuidString.lowercased())\(tail)" }

    /// For the coaching staff of the team only.
    public func team(_ team: UUID) async throws -> TeamStats {
        try await client.send(.get, self.team(team, "/stats"))
    }

    /// The person's own numbers, or those of a player of the coach's team.
    public func player(_ user: UUID) async throws -> PlayerStats {
        try await client.send(.get, "/api/players/\(user.uuidString.lowercased())/stats")
    }

    // MARK: measured values

    public func addMetric(_ input: MetricInput, for user: UUID) async throws -> Metric {
        try await client.send(.post, "/api/players/\(user.uuidString.lowercased())/metrics", body: MetricBody(input))
    }

    /// Only the one who recorded the value may change it.
    public func updateMetric(_ id: UUID, _ input: MetricInput) async throws -> Metric {
        try await client.send(.put, "/api/metrics/\(id.uuidString.lowercased())", body: MetricBody(input))
    }

    public func deleteMetric(_ id: UUID) async throws {
        try await client.sendIgnoringResponse(.delete, "/api/metrics/\(id.uuidString.lowercased())")
    }

    // MARK: analyses (a player asks for their own, the staff for the team's)

    /// Recommendations on the person's own progress. Needs a player profile (409 `player_profile_required`).
    public func progressAnalysis() async throws -> String {
        let answer: AIText = try await client.send(.post, "/api/ai/progress-analysis", timeout: Self.analysisTimeout)
        return answer.text
    }

    public func teamSummary(_ team: UUID) async throws -> String { try await analysis(team, "team-summary") }
    public func attendanceAnalysis(_ team: UUID) async throws -> String { try await analysis(team, "attendance-analysis") }
    public func reportAnalysis(_ team: UUID) async throws -> String { try await analysis(team, "report-analysis") }

    private func analysis(_ id: UUID, _ kind: String) async throws -> String {
        let answer: AIText = try await client.send(.post, team(id, "/ai/\(kind)"), timeout: Self.analysisTimeout)
        return answer.text
    }
}
