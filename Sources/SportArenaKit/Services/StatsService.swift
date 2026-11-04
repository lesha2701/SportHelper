import Foundation

/// The numbers of the home screen.
public final class StatsService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    /// For the coaching staff of the team only.
    public func team(_ team: UUID) async throws -> TeamStats {
        try await client.send(.get, "/api/teams/\(team.uuidString.lowercased())/stats")
    }

    /// The person's own numbers.
    public func player(_ user: UUID) async throws -> PlayerStats {
        try await client.send(.get, "/api/players/\(user.uuidString.lowercased())/stats")
    }
}
