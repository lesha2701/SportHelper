import Foundation

/// The trainer's side of «Подобрать тренера»: the consent to be recommended with its terms, and the offers the administrators make.

/// `GET/PUT /api/match-offers/settings`.
public struct MatchOfferSettings: Decodable, Equatable, Sendable {
    public let enabled: Bool
    public let acceptedVersion: String?
    public let currentVersion: String
    /// False when the current terms have to be accepted (again) before the matching can be switched on.
    public let termsAccepted: Bool
    public let firstSessionPercent: Double
    public let termsTitle: String
    public let terms: [String]

    public init(
        enabled: Bool, acceptedVersion: String? = nil, currentVersion: String, termsAccepted: Bool, firstSessionPercent: Double = 50,
        termsTitle: String = "Условия подбора клиентов", terms: [String] = []
    ) {
        self.enabled = enabled
        self.acceptedVersion = acceptedVersion
        self.currentVersion = currentVersion
        self.termsAccepted = termsAccepted
        self.firstSessionPercent = firstSessionPercent
        self.termsTitle = termsTitle
        self.terms = terms
    }
}

/// The request as a trainer sees it: no name, no contacts (the server has already hidden contacts in the free text).
public struct CoachOfferRequest: Decodable, Equatable, Sendable {
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


    public init(
        sport: String, goal: String? = nil, level: MatchLevel? = nil, format: MatchFormat? = nil, city: String? = nil, budgetMin: Decimal? = nil,
        budgetMax: Decimal? = nil, currency: String = "RUB", weekdays: [Int] = [], dayParts: [DayPart] = [], scheduleNote: String? = nil,
        comment: String? = nil
    ) {
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
    }

    /// The facts worth a line each: what the trainer reads before answering.
    public var facts: [(label: String, value: String)] {
        let budget: String? = switch (budgetMin, budgetMax) {
        case let (low?, high?): low == high ? Money.format(low, currency: currency) : "от \(Money.format(low, currency: currency)) до \(Money.format(high, currency: currency))"
        case let (nil, high?): "до \(Money.format(high, currency: currency))"
        case let (low?, nil): "от \(Money.format(low, currency: currency))"
        default: nil
        }
        let days = weekdays.sorted().compactMap { MatchWeekday.shortTitles.indices.contains($0) ? MatchWeekday.shortTitles[$0] : nil }.joined(separator: ", ")
        let parts = dayParts.map { $0.title.lowercased() }.joined(separator: ", ")
        let when = [days, parts, scheduleNote ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
        return [
            ("Цель", goal), ("Уровень", level?.title), ("Формат", format?.title), ("Город", city), ("Бюджет", budget),
            ("Когда удобно", when.isEmpty ? nil : when), ("Комментарий", comment),
        ].compactMap { label, value in value.map { (label, $0) } }
    }
}

/// An offer to this trainer (`CoachOfferOut`).
public struct CoachOffer: Decodable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let status: MatchOfferStatus
    public let createdAt: Date
    /// Until when the trainer can answer.
    public let expiresAt: Date
    /// The platform's share of the first session with this client, fixed in the offer.
    public let firstSessionPercent: Double
    public let adminMessage: String?
    public let request: CoachOfferRequest

    public init(
        id: UUID, status: MatchOfferStatus = .proposed, createdAt: Date, expiresAt: Date, firstSessionPercent: Double = 50, adminMessage: String? = nil,
        request: CoachOfferRequest
    ) {
        self.id = id
        self.status = status
        self.createdAt = createdAt
        self.expiresAt = expiresAt
        self.firstSessionPercent = firstSessionPercent
        self.adminMessage = adminMessage
        self.request = request
    }

    /// Waits for the trainer's answer.
    public var isWaiting: Bool { status == .proposed }

    /// What the trainer reads as the state of the offer.
    public var statusTitle: String {
        switch status {
        case .proposed: "Ждёт вашего ответа"
        case .coachAccepted: "Вы согласились"
        case .coachDeclined: "Вы отказались"
        case .athleteAccepted: "Спортсмен выбрал вас"
        case .athleteDeclined: "Спортсмен выбрал другое"
        case .withdrawn: "Закрыто"
        case .expired: "Время вышло"
        case .other: "—"
        }
    }
}

struct MatchOfferSettingsBody: Encodable, Sendable {
    let enabled: Bool
    let acceptTermsVersion: String?
}

struct DeclineOfferBody: Encodable, Sendable {
    let reason: String?
}
