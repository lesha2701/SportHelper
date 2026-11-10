import Foundation

/// The matches of a team: the schedule, the squad and the score (changed by the coaching staff).
public final class MatchesService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    private func path(_ id: UUID, _ tail: String = "") -> String { "/api/matches/\(id.uuidString.lowercased())\(tail)" }

    /// The team's matches, the nearest first. They come without the squad; ask for one match to get it.
    public func matches(of team: UUID) async throws -> [TeamMatch] {
        try await client.send(.get, "/api/teams/\(team.uuidString.lowercased())/matches")
    }

    public func match(_ id: UUID) async throws -> TeamMatch { try await client.send(.get, path(id)) }

    public func create(_ input: MatchInput, for team: UUID) async throws -> TeamMatch {
        try await client.send(.post, "/api/teams/\(team.uuidString.lowercased())/matches", body: MatchCreateBody(input))
    }

    public func update(_ id: UUID, _ input: MatchInput, status: MatchStatus) async throws -> TeamMatch {
        try await client.send(.put, path(id), body: MatchUpdateBody(input: input, status: status.rawValue))
    }

    public func delete(_ id: UUID) async throws { try await client.sendIgnoringResponse(.delete, path(id)) }

    /// Names who plays (replaces the whole squad).
    public func setRoster(_ id: UUID, players: [UUID]) async throws -> TeamMatch {
        try await client.send(.put, path(id, "/roster"), body: MatchRosterBody(userIds: players))
    }

    /// Enters the score; the server then counts the match as played.
    public func setResult(_ id: UUID, _ result: MatchResultInput) async throws -> TeamMatch {
        try await client.send(.post, path(id, "/result"), body: MatchResultBody(input: result))
    }
}
