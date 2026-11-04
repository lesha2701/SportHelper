import Foundation

/// The levels the server knows, with the Russian names the site shows.
public enum SkillLevel: String, CaseIterable, Identifiable, Sendable {
    case beginner, amateur, intermediate, advanced, professional

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .beginner: "Новичок"
        case .amateur: "Любитель"
        case .intermediate: "Средний"
        case .advanced: "Продвинутый"
        case .professional: "Профессионал"
        }
    }
}

/// The sports offered in every form (the same list as the site). An older record may hold another value: it is kept and shown.
public enum CommonSports {
    public static let all = [
        "Футбол", "Баскетбол", "Хоккей", "Волейбол", "Гандбол", "Футзал", "Регби", "Плавание", "Большой теннис",
        "Настольный теннис", "Боевые искусства", "Бокс", "Лёгкая атлетика", "Гимнастика", "Фитнес", "Киберспорт", "Другое",
    ]
}

public struct PlayerProfile: Decodable, Equatable, Sendable {
    public let userId: UUID
    public let fullName: String
    public let age: Int?
    public let heightCm: Int?
    public let weightKg: Double?
    public let sport: String
    public let position: String?
    /// The server's value; `skillLevel` is it as a known level (nil for one this app version does not know yet).
    public let level: String?
    public let goals: String?
    public let loadRestrictions: String?
    public let createdAt: Date
    public let updatedAt: Date

    public var skillLevel: SkillLevel? { level.flatMap(SkillLevel.init(rawValue:)) }
}

public struct CoachProfile: Decodable, Equatable, Sendable {
    public let userId: UUID
    public let fullName: String
    public let sport: String
    public let experienceYears: Int?
    public let specialization: String?
    public let description: String?
    public let createdAt: Date
    public let updatedAt: Date
}

/// `GET /api/profile/me`: the person's player and/or coach profile (a new account has neither yet).
public struct ProfileMe: Decodable, Equatable, Sendable {
    public let activeMode: String?
    public let player: PlayerProfile?
    public let coach: CoachProfile?

    public init(activeMode: String?, player: PlayerProfile?, coach: CoachProfile?) {
        self.activeMode = activeMode
        self.player = player
        self.coach = coach
    }
}

/// What a person may change in a player profile. Saving REPLACES the profile: a field left nil is cleared.
public struct PlayerProfileInput: Encodable, Equatable, Sendable {
    public var fullName: String
    public var sport: String
    public var age: Int?
    public var heightCm: Int?
    public var weightKg: Double?
    public var position: String?
    public var level: String?
    public var goals: String?
    public var loadRestrictions: String?

    public init(
        fullName: String, sport: String, age: Int? = nil, heightCm: Int? = nil, weightKg: Double? = nil,
        position: String? = nil, level: String? = nil, goals: String? = nil, loadRestrictions: String? = nil
    ) {
        self.fullName = fullName
        self.sport = sport
        self.age = age
        self.heightCm = heightCm
        self.weightKg = weightKg
        self.position = position
        self.level = level
        self.goals = goals
        self.loadRestrictions = loadRestrictions
    }

    public init(_ profile: PlayerProfile) {
        self.init(
            fullName: profile.fullName, sport: profile.sport, age: profile.age, heightCm: profile.heightCm, weightKg: profile.weightKg,
            position: profile.position, level: profile.level, goals: profile.goals, loadRestrictions: profile.loadRestrictions
        )
    }

    /// The limits the server enforces; checking them first saves a round trip. Returns the first problem in Russian, or nil.
    public var problem: String? {
        if fullName.trimmed.isEmpty { return "Укажите имя." }
        if fullName.trimmed.count > 100 { return "Имя — не длиннее 100 символов." }
        if sport.trimmed.isEmpty { return "Выберите вид спорта." }
        if let age, !(3...100).contains(age) { return "Возраст — от 3 до 100 лет." }
        if let heightCm, !(50...260).contains(heightCm) { return "Рост — от 50 до 260 см." }
        if let weightKg, !(15...300).contains(weightKg) { return "Вес — от 15 до 300 кг." }
        if (goals?.count ?? 0) > 1000 || (loadRestrictions?.count ?? 0) > 1000 { return "Текст — не длиннее 1000 символов." }
        return nil
    }
}

public struct CoachProfileInput: Encodable, Equatable, Sendable {
    public var fullName: String
    public var sport: String
    public var experienceYears: Int?
    public var specialization: String?
    public var description: String?

    public init(fullName: String, sport: String, experienceYears: Int? = nil, specialization: String? = nil, description: String? = nil) {
        self.fullName = fullName
        self.sport = sport
        self.experienceYears = experienceYears
        self.specialization = specialization
        self.description = description
    }

    public init(_ profile: CoachProfile) {
        self.init(
            fullName: profile.fullName, sport: profile.sport, experienceYears: profile.experienceYears,
            specialization: profile.specialization, description: profile.description
        )
    }

    public var problem: String? {
        if fullName.trimmed.isEmpty { return "Укажите имя." }
        if fullName.trimmed.count > 100 { return "Имя — не длиннее 100 символов." }
        if sport.trimmed.isEmpty { return "Выберите вид спорта." }
        if let experienceYears, !(0...80).contains(experienceYears) { return "Опыт — от 0 до 80 лет." }
        if (specialization?.count ?? 0) > 200 { return "Специализация — не длиннее 200 символов." }
        if (description?.count ?? 0) > 1000 { return "Текст — не длиннее 1000 символов." }
        return nil
    }
}

/// The few user fields an avatar change answers with (the full `AuthUser` also carries a CSRF token, this answer does not).
public struct UserSummary: Decodable, Equatable, Sendable {
    public let id: UUID
    public let firstName: String
    public let lastName: String?
    public let avatarFileId: UUID?
}

public extension String {
    /// The text without surrounding spaces and line breaks.
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}

public enum Russian {
    /// "1 год", "2 года", "5 лет", "11 лет", "21 год".
    public static func plural(_ n: Int, one: String, few: String, many: String) -> String {
        let n100 = abs(n) % 100
        let n10 = n100 % 10
        if (11...14).contains(n100) { return "\(n) \(many)" }
        switch n10 {
        case 1: return "\(n) \(one)"
        case 2...4: return "\(n) \(few)"
        default: return "\(n) \(many)"
        }
    }

    public static func years(_ n: Int) -> String { plural(n, one: "год", few: "года", many: "лет") }
}
