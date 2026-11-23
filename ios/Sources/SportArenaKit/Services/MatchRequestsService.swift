import Foundation

/// «Подобрать тренера»: the person describes what they are looking for and follows what happens with it. The administrators pick the
/// trainers; the person's contacts are not given to anybody.
public final class MatchRequestsService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    public func create(_ draft: MatchRequestDraft) async throws -> MatchRequest {
        try await client.send(.post, "/api/match-requests", body: draft.body)
    }

    public func mine() async throws -> [MatchRequest] {
        try await client.send(.get, "/api/match-requests/mine")
    }

    /// Withdraws a request that nobody has finished yet.
    public func cancel(_ id: UUID) async throws -> MatchRequest {
        try await client.send(.post, "/api/match-requests/\(id.uuidString.lowercased())/cancel")
    }

    /// The person chooses this trainer: the request becomes «Тренер выбран» and the other offers are taken back.
    public func accept(offer id: UUID) async throws -> MatchRequest {
        try await client.send(.post, "/api/match-requests/offers/\(id.uuidString.lowercased())/accept")
    }

    /// The person does not want this trainer; the request stays with the administrators.
    public func decline(offer id: UUID) async throws -> MatchRequest {
        try await client.send(.post, "/api/match-requests/offers/\(id.uuidString.lowercased())/decline")
    }
}
