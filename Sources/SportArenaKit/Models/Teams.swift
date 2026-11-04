import Foundation

public enum TeamLevel: String, Codable, CaseIterable, Identifiable, Sendable {
    case beginner, amateur, intermediate, advanced, professional
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .beginner: "Начинающий"
        case .amateur: "Любитель"
        case .intermediate: "Средний"
        case .advanced: "Продвинутый"
        case .professional: "Профессионал"
        }
    }
}

public enum TeamRole: Equatable, Hashable, Sendable {
    case headCoach, assistantCoach, captain, player
    case other(String)

    public init(raw: String) {
        switch raw {
        case "head_coach": self = .headCoach
        case "assistant_coach": self = .assistantCoach
        case "captain": self = .captain
        case "player": self = .player
        default: self = .other(raw)
        }
    }

    public var title: String {
        switch self {
        case .headCoach: "Главный тренер"
        case .assistantCoach: "Помощник тренера"
        case .captain: "Капитан"
        case .player: "Игрок"
        case .other(let raw): raw
        }
    }

    /// The coaching staff runs the team: edits it, invites players, answers applications.
    public var isStaff: Bool { self == .headCoach || self == .assistantCoach }
}

public struct Team: Decodable, Equatable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public let name: String
    public let description: String?
    public let sport: String
    public let ageCategory: String?
    public let levelRaw: String?
    /// "active", or "without_coach" after the head coach has left.
    public let status: String
    public let createdBy: UUID
    public let logoFileId: UUID?
    public let myRoleRaw: String?
    public let membersCount: Int?

    public var level: TeamLevel? { levelRaw.flatMap(TeamLevel.init(rawValue:)) }
    public var myRole: TeamRole? { myRoleRaw.map(TeamRole.init(raw:)) }
    public var isWithoutCoach: Bool { status == "without_coach" }
    /// Whether the person may edit the team and answer applications.
    public var canManage: Bool { myRole?.isStaff ?? false }

    private enum CodingKeys: String, CodingKey {
        case id, name, description, sport, ageCategory, status, createdBy, logoFileId, membersCount
        case levelRaw = "level"
        case myRoleRaw = "myRole"
    }

    public init(
        id: UUID, name: String, description: String? = nil, sport: String, ageCategory: String? = nil, level: TeamLevel? = nil,
        status: String = "active", createdBy: UUID, logoFileId: UUID? = nil, myRole: TeamRole? = nil, membersCount: Int? = nil
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.sport = sport
        self.ageCategory = ageCategory
        self.levelRaw = level?.rawValue
        self.status = status
        self.createdBy = createdBy
        self.logoFileId = logoFileId
        self.myRoleRaw = myRole.map { Self.raw($0) }
        self.membersCount = membersCount
    }

    private static func raw(_ role: TeamRole) -> String {
        switch role {
        case .headCoach: "head_coach"
        case .assistantCoach: "assistant_coach"
        case .captain: "captain"
        case .player: "player"
        case .other(let raw): raw
        }
    }
}

/// What the person fills in to create or edit a team.
public struct TeamInput: Encodable, Equatable, Sendable {
    public static let maxName = 100
    public static let maxSport = 50
    public static let maxDescription = 1000
    public static let maxAgeCategory = 50

    public let name: String
    public let sport: String
    public let description: String?
    public let ageCategory: String?
    public let level: TeamLevel?

    /// Trims the text; empty optional fields are sent as absent. Returns nil when the name or the sport is missing or too long.
    public init?(name: String, sport: String, description: String = "", ageCategory: String = "", level: TeamLevel? = nil) {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let sport = sport.trimmingCharacters(in: .whitespacesAndNewlines)
        let description = description.trimmingCharacters(in: .whitespacesAndNewlines)
        let age = ageCategory.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= Self.maxName, !sport.isEmpty, sport.count <= Self.maxSport,
              description.count <= Self.maxDescription, age.count <= Self.maxAgeCategory else { return nil }
        self.name = name
        self.sport = sport
        self.description = description.isEmpty ? nil : description
        self.ageCategory = age.isEmpty ? nil : age
        self.level = level
    }

    // The server wants explicit nulls for cleared fields, otherwise "remove the description" would silently keep it.
    private enum CodingKeys: String, CodingKey { case name, sport, description, ageCategory, level }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)
        try container.encode(sport, forKey: .sport)
        try container.encode(description, forKey: .description)
        try container.encode(ageCategory, forKey: .ageCategory)
        try container.encode(level, forKey: .level)
    }
}

public struct TeamMember: Decodable, Equatable, Identifiable, Sendable {
    public let userId: UUID
    public let firstName: String
    public let lastName: String?
    public let username: String?
    public let photoUrl: String?
    public let roleRaw: String
    public let position: String?
    public let joinedAt: Date

    public var id: UUID { userId }
    public var role: TeamRole { TeamRole(raw: roleRaw) }
    public var fullName: String { [firstName, lastName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ") }

    private enum CodingKeys: String, CodingKey {
        case userId, firstName, lastName, username, photoUrl, position, joinedAt
        case roleRaw = "role"
    }
}

public struct TeamInvite: Decodable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let teamId: UUID
    public let token: String
    public let kind: String
    /// The link for the website (`…/?invite=TOKEN`). The app takes the token out of it.
    public let link: String
    public let expiresAt: Date
    public let createdAt: Date
}

public struct JoinRequest: Decodable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let teamId: UUID
    public let userId: UUID
    public let firstName: String
    public let lastName: String?
    public let username: String?
    public let photoUrl: String?
    public let status: String
    public let createdAt: Date

    public var fullName: String { [firstName, lastName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ") }
}

/// The answer to applying with an invitation: in at once, or waiting for the coach.
public struct JoinResult: Decodable, Equatable, Sendable {
    public let status: String
    public let team: Team
    public var joined: Bool { status == "joined" }
}

/// The invitation token out of whatever the person pasted: the link from the website, or just the token.
public enum InviteToken {
    public static func parse(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let components = URLComponents(string: trimmed), let token = components.queryItems?.first(where: { $0.name == "invite" })?.value {
            return valid(token)
        }
        return valid(trimmed)
    }

    /// Tokens are URL-safe strings; anything else (spaces, slashes, a whole sentence) is not a token and is never put into a request path.
    private static func valid(_ token: String) -> String? {
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
        guard (16...200).contains(token.count), token.unicodeScalars.allSatisfy(allowed.contains) else { return nil }
        return token
    }
}
