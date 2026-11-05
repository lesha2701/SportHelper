import Foundation

/// The catalogue of trainers' offers and their free hours.
public final class CoachesService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    public func listings(filter: CoachFilter = CoachFilter()) async throws -> [CoachListingCard] {
        try await client.send(.get, "/api/coach-listings", query: filter.queryItems)
    }

    public func listing(id: UUID) async throws -> CoachListingProfile {
        try await client.send(.get, "/api/coach-listings/\(id.uuidString.lowercased())")
    }

    /// The coach's reviews, newest first (up to 50).
    public func reviews(ofCoach id: UUID) async throws -> [CoachReview] {
        try await client.send(.get, "/api/coaches/\(id.uuidString.lowercased())/reviews")
    }

    /// Free hours between two days (inclusive).
    public func slots(listingId: UUID, from: LocalDate, to: LocalDate) async throws -> [OpenSlot] {
        try await client.send(.get, "/api/coach-listings/\(listingId.uuidString.lowercased())/slots", query: [
            URLQueryItem(name: "from_date", value: from.iso), URLQueryItem(name: "to_date", value: to.iso),
        ])
    }
}
