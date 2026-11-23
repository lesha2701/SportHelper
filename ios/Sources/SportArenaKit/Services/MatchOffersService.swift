import Foundation

/// «Подбор клиентов» of a trainer: switch the matching on after reading the terms, read the offers of the administrators, answer them.
/// The server answers 409 `coach_profile_required` to anyone without a coach profile.
public final class MatchOffersService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    public func settings() async throws -> MatchOfferSettings {
        try await client.send(.get, "/api/match-offers/settings")
    }

    /// Switching on sends the version of the terms the trainer has read; switching off sends none.
    public func setEnabled(_ enabled: Bool, termsVersion: String?) async throws -> MatchOfferSettings {
        try await client.send(.put, "/api/match-offers/settings", body: MatchOfferSettingsBody(enabled: enabled, acceptTermsVersion: enabled ? termsVersion : nil))
    }

    public func incoming() async throws -> [CoachOffer] {
        try await client.send(.get, "/api/match-offers/incoming")
    }

    public func accept(_ id: UUID) async throws -> CoachOffer {
        try await client.send(.post, "/api/match-offers/\(id.uuidString.lowercased())/accept")
    }

    public func decline(_ id: UUID, reason: String?) async throws -> CoachOffer {
        let clean = reason?.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return try await client.send(.post, "/api/match-offers/\(id.uuidString.lowercased())/decline", body: DeclineOfferBody(reason: clean?.isEmpty == false ? clean : nil))
    }
}
