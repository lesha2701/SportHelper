import Foundation

/// A trainer's offer as the catalogue shows it (`CoachListingCardOut`).
public struct CoachListingCard: Decodable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let title: String
    public let description: String?
    public let coachUserId: UUID
    public let coachFullName: String
    public let sport: String
    public let specialization: String?
    public let experienceYears: Int?
    public let averageRating: Double?
    public let reviewCount: Int
    public let pricePerSession: Decimal?
    public let currency: String
    public let location: String?
    public let offersOnline: Bool
    public let offersOffline: Bool
    public let photoFileId: UUID?
    public let nextAvailableSlot: Date?

    public var priceText: String? { pricePerSession.map { Money.format($0, currency: currency) } }

    public var formats: [BookingFormat] {
        (offersOnline ? [BookingFormat.online] : []) + (offersOffline ? [BookingFormat.offline] : [])
    }

    public var ratingText: String? {
        guard let averageRating, reviewCount > 0 else { return nil }
        return String(format: "%.1f", averageRating).replacingOccurrences(of: ".", with: ",")
    }
}

public struct CoachReview: Decodable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let athleteFirstName: String
    public let rating: Int
    public let text: String?
    public let createdAt: Date
}

/// A trainer's offer with everything for its page (`CoachListingProfileOut`).
public struct CoachListingProfile: Decodable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let title: String
    public let description: String?
    public let coachUserId: UUID
    public let coachFullName: String
    public let sport: String
    public let specialization: String?
    public let experienceYears: Int?
    public let averageRating: Double?
    public let reviewCount: Int
    public let pricePerSession: Decimal?
    public let currency: String
    public let location: String?
    public let offersOnline: Bool
    public let offersOffline: Bool
    public let photoFileId: UUID?
    public let coachDescription: String?
    public let sessionDurationMinutes: Int?
    public let recentReviews: [CoachReview]

    public var priceText: String? { pricePerSession.map { Money.format($0, currency: currency) } }

    public var formats: [BookingFormat] {
        (offersOnline ? [BookingFormat.online] : []) + (offersOffline ? [BookingFormat.offline] : [])
    }
}

/// A free hour in a trainer's schedule (`OpenSlotOut`).
public struct OpenSlot: Decodable, Equatable, Identifiable, Sendable {
    public let startsAt: Date
    public let durationMinutes: Int

    public var id: Date { startsAt }
    public var day: LocalDate { startsAt.serverDay }
    public var time: LocalTime { startsAt.serverTime }
}

/// Filters of the catalogue; an empty filter asks for everything.
public struct CoachFilter: Equatable, Sendable {
    public var sport: String?
    public var format: BookingFormat?
    public var location: String?
    public var maxPrice: Int?
    public var minRating: Double?

    public init(sport: String? = nil, format: BookingFormat? = nil, location: String? = nil, maxPrice: Int? = nil, minRating: Double? = nil) {
        self.sport = sport
        self.format = format
        self.location = location
        self.maxPrice = maxPrice
        self.minRating = minRating
    }

    public var isEmpty: Bool { self == CoachFilter() }

    var queryItems: [URLQueryItem] {
        var items: [URLQueryItem] = []
        if let sport, !sport.trimmed.isEmpty { items.append(URLQueryItem(name: "sport", value: sport)) }
        if let format { items.append(URLQueryItem(name: "format", value: format.rawValue)) }
        if let location, !location.trimmed.isEmpty { items.append(URLQueryItem(name: "location", value: location.trimmed)) }
        if let maxPrice { items.append(URLQueryItem(name: "max_price", value: String(maxPrice))) }
        if let minRating { items.append(URLQueryItem(name: "min_rating", value: String(minRating))) }
        return items
    }
}
