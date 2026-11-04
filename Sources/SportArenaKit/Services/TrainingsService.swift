import Foundation

/// Scheduling and changing trainings (for the coaching staff of a team).
public final class TrainingsService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    private func path(_ id: UUID, _ tail: String = "") -> String { "/api/trainings/\(id.uuidString.lowercased())\(tail)" }

    public func teamTrainings(_ team: UUID) async throws -> [Training] {
        try await client.send(.get, "/api/teams/\(team.uuidString.lowercased())/trainings")
    }

    /// One training, or the whole series when the input repeats weekly.
    public func schedule(_ input: TrainingInput, for team: UUID) async throws -> [Training] {
        try await client.send(.post, "/api/teams/\(team.uuidString.lowercased())/trainings", body: TrainingCreateBody(input))
    }

    public func update(_ id: UUID, _ input: TrainingInput, status: TrainingStatus) async throws -> Training {
        try await client.send(.put, path(id), body: TrainingUpdateBody(input: input, status: status.rawValue))
    }

    public func delete(_ id: UUID) async throws { try await client.sendIgnoringResponse(.delete, path(id)) }

    /// Cancels every training of the series this one belongs to.
    public func cancelSeries(of id: UUID) async throws { try await client.sendIgnoringResponse(.post, path(id, "/cancel-series")) }
}
