import Foundation

/// Other people's profiles: a coach's page, a player's page (for their coaches) and the gallery of achievements.
public final class PublicProfilesService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    private func id(_ value: UUID) -> String { value.uuidString.lowercased() }

    public func coach(_ coachUserId: UUID) async throws -> CoachPublicProfile {
        try await client.send(.get, "/api/coaches/\(id(coachUserId))/profile")
    }

    /// The offers the coach has published.
    public func listings(ofCoach coachUserId: UUID) async throws -> [CoachListingCard] {
        try await client.send(.get, "/api/coaches/\(id(coachUserId))/listings")
    }

    /// A player's profile. «Игрок ещё не заполнил профиль» is the server's `not_found`; a coach with no tie to the player gets 403.
    public func player(_ playerUserId: UUID) async throws -> PlayerPublicProfile {
        try await client.send(.get, "/api/players/\(id(playerUserId))/profile")
    }

    /// What coaches wrote about the player; 403 unless the reader is a coach who has a booking with them.
    public func reviews(ofPlayer playerUserId: UUID) async throws -> PlayerReviews {
        try await client.send(.get, "/api/players/\(id(playerUserId))/reviews")
    }

    public func media(of userId: UUID) async throws -> [ProfileMedia] {
        try await client.send(.get, "/api/profile/media/\(id(userId))")
    }
}
