import Foundation

/// A coach as anyone sees them (`CoachPublicProfileOut`).
public struct CoachPublicProfile: Decodable, Equatable, Sendable {
    public let userId: UUID
    public let fullName: String
    public let sport: String
    public let specialization: String?
    public let experienceYears: Int?
    public let description: String?
    public let avatarFileId: UUID?
    public let averageRating: Double?
    public let reviewCount: Int

    /// «4,8», or nil while there are no reviews.
    public var ratingText: String? {
        guard let averageRating, reviewCount > 0 else { return nil }
        return String(format: "%.1f", averageRating).replacingOccurrences(of: ".", with: ",")
    }

    /// «Теннис · Подача»: the sport and what the coach specialises in.
    public var subtitle: String { [specialization, sport].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ") }
}

/// A player as a coach sees them (`PlayerPublicProfileOut`). The server shows it to a coach who shares a team with the player or has
/// had a booking with them, and to the player themself.
public struct PlayerPublicProfile: Decodable, Equatable, Sendable {
    public let userId: UUID
    public let fullName: String
    public let age: Int?
    public let heightCm: Int?
    public let weightKg: Double?
    public let sport: String
    public let position: String?
    public let level: String?
    public let goals: String?
    public let loadRestrictions: String?
    public let avatarFileId: UUID?

    public var skillLevel: SkillLevel? { level.flatMap(SkillLevel.init(rawValue:)) }
    public var subtitle: String { [position, sport].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ") }
}

/// What a coach wrote about a player after training them (`PlayerReviewOut`).
public struct PlayerReview: Decodable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let coachName: String
    public let rating: Int
    public let text: String?
    public let createdAt: Date
}

/// The coaches' reviews of a player and their average (`PlayerReviewsOut`). Only a coach who has a booking with the player may read it.
public struct PlayerReviews: Decodable, Equatable, Sendable {
    public let average: Double?
    public let count: Int
    public let reviews: [PlayerReview]

    public var averageText: String? {
        average.map { String(format: "%.1f", $0).replacingOccurrences(of: ".", with: ",") }
    }
}

/// One photo or video of a person's gallery of achievements (`ProfileMediaOut`).
public struct ProfileMedia: Decodable, Equatable, Identifiable, Sendable {
    public enum Kind: Sendable { case photo, video }

    public let id: UUID
    public let userId: UUID
    public let fileId: UUID
    public let mediaType: String
    public let caption: String?
    public let sortOrder: Int

    public var kind: Kind { mediaType == "photo" ? .photo : .video }
}
