import Foundation

public enum MatchLevel: String, CaseIterable, Codable, Identifiable, Sendable {
    case beginner, amateur, advanced, pro

    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .beginner: "Новичок"
        case .amateur: "Любитель"
        case .advanced: "Продвинутый"
        case .pro: "Профессионал"
        }
    }
}

public enum MatchFormat: String, CaseIterable, Codable, Identifiable, Sendable {
    case online, offline, any

    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .online: "Онлайн"
        case .offline: "Очно"
        case .any: "Не важно"
        }
    }
}

public enum DayPart: String, CaseIterable, Codable, Identifiable, Sendable {
    case morning, day, evening

    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .morning: "Утро"
        case .day: "День"
        case .evening: "Вечер"
        }
    }
}

/// Days of the week as the server counts them: 0 is Monday … 6 is Sunday (the same as a trainer's availability windows).
public enum MatchWeekday {
    public static let shortTitles = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
}

/// What the person sees of the state of their request.
public enum MatchRequestStatus: String, Decodable, Sendable {
    case new
    case inProgress = "in_progress"
    case closed
    case canceled

    public var title: String {
        switch self {
        case .new: "Отправлена"
        case .inProgress: "Подбираем тренера"
        case .closed: "Обработана"
        case .canceled: "Отозвана"
        }
    }

    /// Still waiting for the administrators: the person may withdraw it.
    public var isOpen: Bool { self == .new || self == .inProgress }
}

/// A «Подобрать тренера» request of the person (`MatchRequestOut`).
public struct MatchRequest: Decodable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let sport: String
    public let goal: String?
    public let level: MatchLevel?
    public let format: MatchFormat?
    public let city: String?
    public let budgetMin: Decimal?
    public let budgetMax: Decimal?
    public let currency: String
    public let weekdays: [Int]
    public let dayParts: [DayPart]
    public let scheduleNote: String?
    public let comment: String?
    public let status: MatchRequestStatus
    public let createdAt: Date

    public init(
        id: UUID, sport: String, goal: String? = nil, level: MatchLevel? = nil, format: MatchFormat? = nil, city: String? = nil,
        budgetMin: Decimal? = nil, budgetMax: Decimal? = nil, currency: String = "RUB", weekdays: [Int] = [], dayParts: [DayPart] = [],
        scheduleNote: String? = nil, comment: String? = nil, status: MatchRequestStatus = .new, createdAt: Date
    ) {
        self.id = id
        self.sport = sport
        self.goal = goal
        self.level = level
        self.format = format
        self.city = city
        self.budgetMin = budgetMin
        self.budgetMax = budgetMax
        self.currency = currency
        self.weekdays = weekdays
        self.dayParts = dayParts
        self.scheduleNote = scheduleNote
        self.comment = comment
        self.status = status
        self.createdAt = createdAt
    }

    /// «от 1 500 ₽ до 3 000 ₽», «до 3 000 ₽», «от 1 500 ₽»; nil when no budget was given.
    public var budgetText: String? {
        switch (budgetMin, budgetMax) {
        case let (low?, high?): low == high ? Money.format(low, currency: currency) : "от \(Money.format(low, currency: currency)) до \(Money.format(high, currency: currency))"
        case let (nil, high?): "до \(Money.format(high, currency: currency))"
        case let (low?, nil): "от \(Money.format(low, currency: currency))"
        default: nil
        }
    }

    /// «Пн, Ср · утро, вечер · после 19:00»: the days, the parts of the day and the note, whichever were given; nil when none was.
    public var whenText: String? {
        let days = weekdays.sorted().compactMap { MatchWeekday.shortTitles.indices.contains($0) ? MatchWeekday.shortTitles[$0] : nil }.joined(separator: ", ")
        let parts = dayParts.map { $0.title.lowercased() }.joined(separator: ", ")
        let text = [days, parts, scheduleNote ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
        return text.isEmpty ? nil : text
    }
}

/// The form: only the sport is required, everything else the person may leave empty.
public struct MatchRequestDraft: Equatable, Sendable {
    public static let sportMax = 100
    public static let goalMax = 1000
    public static let cityMax = 100
    public static let noteMax = 500
    public static let commentMax = 1500
    private static let moneyMax = Decimal(99_999_999)

    public var sport = ""
    public var goal = ""
    public var level: MatchLevel?
    public var format: MatchFormat?
    public var city = ""
    public var budgetMin = ""
    public var budgetMax = ""
    public var weekdays: Set<Int> = []
    public var dayParts: Set<DayPart> = []
    public var scheduleNote = ""
    public var comment = ""

    public init() {}

    private static func tidyLine(_ text: String, max: Int) -> String? {
        let line = text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return line.isEmpty ? nil : String(line.prefix(max))
    }

    private static func tidyText(_ text: String, max: Int) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : String(trimmed.prefix(max))
    }

    public var tidySport: String { Self.tidyLine(sport, max: Self.sportMax) ?? "" }

    /// An amount typed by the person: spaces are thousands separators, a comma is a decimal point. Empty is no limit (nil, not a problem).
    private static func amount(_ text: String) -> (value: Decimal?, valid: Bool) {
        let clean = text.filter { !$0.isWhitespace }.replacingOccurrences(of: ",", with: ".")
        if clean.isEmpty { return (nil, true) }
        guard clean.range(of: #"^\d{1,8}(\.\d{1,2})?$"#, options: .regularExpression) != nil, let value = Decimal(string: clean, locale: Locale(identifier: "en_US")),
              value <= moneyMax else { return (nil, false) }
        return (value, true)
    }

    /// Why the budget cannot be sent, or nil when it is fine (or empty).
    public var budgetProblem: String? {
        let low = Self.amount(budgetMin), high = Self.amount(budgetMax)
        if !low.valid || !high.valid { return "Бюджет: только цифры." }
        if let a = low.value, let b = high.value, a > b { return "Бюджет «от» не может быть больше бюджета «до»." }
        return nil
    }

    public var isReady: Bool { tidySport.count >= 2 && budgetProblem == nil }

    var body: MatchRequestBody {
        MatchRequestBody(
            sport: tidySport, goal: Self.tidyText(goal, max: Self.goalMax), level: level, format: format, city: Self.tidyLine(city, max: Self.cityMax),
            budgetMin: Self.amount(budgetMin).value, budgetMax: Self.amount(budgetMax).value, weekdays: weekdays.sorted(),
            dayParts: DayPart.allCases.filter(dayParts.contains), scheduleNote: Self.tidyLine(scheduleNote, max: Self.noteMax),
            comment: Self.tidyText(comment, max: Self.commentMax)
        )
    }
}

struct MatchRequestBody: Encodable, Sendable {
    let sport: String
    let goal: String?
    let level: MatchLevel?
    let format: MatchFormat?
    let city: String?
    let budgetMin: Decimal?
    let budgetMax: Decimal?
    let weekdays: [Int]
    let dayParts: [DayPart]
    let scheduleNote: String?
    let comment: String?
}
