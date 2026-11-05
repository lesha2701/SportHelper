import Foundation

/// A coach's own offer, with the state only the owner sees (`CoachListingOut`).
public struct CoachListing: Decodable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let title: String
    public let description: String?
    /// Published in the catalogue (false = a draft only the coach sees).
    public let isListed: Bool
    public let pricePerSession: Decimal?
    public let currency: String
    public let offersOnline: Bool
    public let offersOffline: Bool
    public let location: String?
    public let sessionDurationMinutes: Int?
    public let photoFileId: UUID?
    public let videoFileId: UUID?
    private let hiddenByModerationRaw: Bool?
    public let moderationReason: String?

    private enum CodingKeys: String, CodingKey {
        case id, title, description, isListed, pricePerSession, currency, offersOnline, offersOffline, location
        case sessionDurationMinutes, photoFileId, videoFileId, moderationReason
        case hiddenByModerationRaw = "hiddenByModeration"
    }

    /// The moderators took the offer off the catalogue.
    public var hiddenByModeration: Bool { hiddenByModerationRaw ?? false }

    public var priceText: String? { pricePerSession.map { Money.format($0, currency: currency) } }

    /// «Опубликовано», «Черновик» or «Скрыто модератором».
    public var statusText: String {
        if hiddenByModeration { return "Скрыто модератором" }
        return isListed ? "Опубликовано" : "Черновик"
    }
}

/// A weekly window in which the coach takes sessions (0 = Monday ... 6 = Sunday). The catalogue's free hours are cut from these.
public struct AvailabilityWindow: Codable, Equatable, Hashable, Sendable {
    public var weekday: Int
    public var start: LocalTime
    public var end: LocalTime

    public init(weekday: Int, start: LocalTime, end: LocalTime) {
        self.weekday = weekday
        self.start = start
        self.end = end
    }

    private enum CodingKeys: String, CodingKey { case weekday, startTime, endTime }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        weekday = try values.decode(Int.self, forKey: .weekday)
        start = try values.decode(LocalTime.self, forKey: .startTime)
        end = try values.decode(LocalTime.self, forKey: .endTime)
    }

    /// The server takes «HH:MM:SS».
    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(weekday, forKey: .weekday)
        try values.encode(start.display + ":00", forKey: .startTime)
        try values.encode(end.display + ":00", forKey: .endTime)
    }

    public static let weekdayTitles = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
}

/// What the offer is saved as (`CoachListingIn`).
public struct ListingInput: Encodable, Equatable, Sendable {
    public let title: String
    public let description: String?
    public let isListed: Bool
    public let pricePerSession: Decimal?
    public let currency: String
    public let offersOnline: Bool
    public let offersOffline: Bool
    public let location: String?
    public let sessionDurationMinutes: Int?

    /// The same offer, with publishing switched on or off.
    public func listed(_ listed: Bool) -> ListingInput {
        ListingInput(
            title: title, description: description, isListed: listed, pricePerSession: pricePerSession, currency: currency,
            offersOnline: offersOnline, offersOffline: offersOffline, location: location, sessionDurationMinutes: sessionDurationMinutes
        )
    }
}

/// The offer's form: what is typed, what is wrong with it (in the site's words), and the request it becomes.
public struct ListingDraft: Equatable, Sendable {
    public static let maxTitle = 200
    public static let maxDescription = 2000
    public static let maxLocation = 200

    public var title = ""
    public var description = ""
    public var isListed = false
    public var price = ""
    public var currency = "RUB"
    public var offersOnline = false
    public var offersOffline = false
    public var location = ""
    public var duration = "60"
    public var windows: [AvailabilityWindow] = []

    public init() {}

    public init(_ listing: CoachListing, windows: [AvailabilityWindow] = []) {
        title = listing.title
        description = listing.description ?? ""
        isListed = listing.isListed
        price = listing.pricePerSession.map { "\($0)" } ?? ""
        currency = listing.currency
        offersOnline = listing.offersOnline
        offersOffline = listing.offersOffline
        location = listing.location ?? ""
        duration = listing.sessionDurationMinutes.map(String.init) ?? ""
        self.windows = windows
    }

    private var tidyPrice: Decimal? {
        let text = price.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        return text.isEmpty ? nil : Decimal(string: text)
    }

    private var tidyDuration: Int? { Int(duration.trimmingCharacters(in: .whitespaces)) }

    /// What is wrong, worded as on the site, or nil when the offer can be saved. Publishing asks for more than a draft does.
    public func problem() -> String? {
        if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Укажите название объявления." }
        if !price.trimmingCharacters(in: .whitespaces).isEmpty, tidyPrice.map({ $0 < 0 }) ?? true { return "Цена указана неверно." }
        if !duration.trimmingCharacters(in: .whitespaces).isEmpty, tidyDuration.map({ $0 <= 0 }) ?? true {
            return "Длительность тренировки указана неверно."
        }
        if windows.contains(where: { $0.start >= $0.end }) { return "В расписании время окончания должно быть позже времени начала." }
        if hasOverlap { return "Окна расписания в один день пересекаются: сделайте их подряд." }
        if isListed {
            if !(offersOnline || offersOffline) { return "Выберите формат тренировки (онлайн или очно), чтобы опубликовать объявление." }
            if tidyPrice == nil { return "Укажите цену, чтобы опубликовать объявление." }
            if tidyDuration == nil { return "Укажите длительность тренировки, чтобы опубликовать объявление." }
            if windows.isEmpty { return "Добавьте хотя бы одно окно в расписание — без него нельзя опубликовать объявление." }
        }
        return nil
    }

    private var hasOverlap: Bool {
        let byDay = Dictionary(grouping: windows, by: \.weekday)
        return byDay.values.contains { day in
            let sorted = day.sorted { $0.start < $1.start }
            return zip(sorted, sorted.dropFirst()).contains { $0.end > $1.start }
        }
    }

    /// The request, or nil while `problem()` says something.
    public func request() -> ListingInput? {
        guard problem() == nil else { return nil }
        let words = description.trimmingCharacters(in: .whitespacesAndNewlines)
        let place = location.trimmingCharacters(in: .whitespacesAndNewlines)
        return ListingInput(
            title: String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(Self.maxTitle)),
            description: words.isEmpty ? nil : String(words.prefix(Self.maxDescription)), isListed: isListed, pricePerSession: tidyPrice,
            currency: currency, offersOnline: offersOnline, offersOffline: offersOffline,
            location: place.isEmpty ? nil : String(place.prefix(Self.maxLocation)), sessionDurationMinutes: tidyDuration
        )
    }
}
