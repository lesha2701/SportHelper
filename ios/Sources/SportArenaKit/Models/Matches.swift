import Foundation

public enum MatchStatus: String, CaseIterable, Identifiable, Sendable {
    case scheduled, completed, cancelled
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .scheduled: "Запланирован"
        case .completed: "Сыгран"
        case .cancelled: "Отменён"
        }
    }
}

public enum MatchOutcome: String, Sendable {
    case win, loss, draw
    public var title: String {
        switch self {
        case .win: "Победа"
        case .loss: "Поражение"
        case .draw: "Ничья"
        }
    }
}

/// A player named in the squad of a match.
public struct MatchPlayer: Decodable, Equatable, Hashable, Identifiable, Sendable {
    public let userId: UUID
    public let firstName: String
    public let lastName: String?
    public let photoUrl: String?

    public var id: UUID { userId }
    public var fullName: String { [firstName, lastName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ") }
}

/// A match of a team against an opponent.
public struct TeamMatch: Decodable, Equatable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public let teamId: UUID
    public let createdBy: UUID
    public let opponentName: String
    public let matchDate: LocalDate
    public let startTime: LocalTime
    public let location: String?
    public let isHome: Bool
    public let tournament: String?
    public let statusRaw: String
    public let ourScore: Int?
    public let opponentScore: Int?
    public let resultRaw: String?
    public let comment: String?
    public let createdAt: Date
    public let updatedAt: Date
    /// The squad. The list of a team's matches comes without it (it is empty there); one match brings it.
    public let roster: [MatchPlayer]

    public var status: MatchStatus? { MatchStatus(rawValue: statusRaw) }
    public var outcome: MatchOutcome? { resultRaw.flatMap(MatchOutcome.init(rawValue:)) }
    public var hasScore: Bool { ourScore != nil && opponentScore != nil }
    /// "3:1" — ours first, as the server stores it. nil until a result is entered.
    public var scoreText: String? {
        guard let ourScore, let opponentScore else { return nil }
        return "\(ourScore):\(opponentScore)"
    }

    private enum CodingKeys: String, CodingKey {
        case id, teamId, createdBy, opponentName, matchDate, startTime, location, isHome, tournament, ourScore, opponentScore
        case comment, createdAt, updatedAt, roster
        case statusRaw = "status"
        case resultRaw = "result"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        teamId = try c.decode(UUID.self, forKey: .teamId)
        createdBy = try c.decode(UUID.self, forKey: .createdBy)
        opponentName = try c.decode(String.self, forKey: .opponentName)
        matchDate = try c.decode(LocalDate.self, forKey: .matchDate)
        startTime = try c.decode(LocalTime.self, forKey: .startTime)
        location = try c.decodeIfPresent(String.self, forKey: .location)
        isHome = try c.decode(Bool.self, forKey: .isHome)
        tournament = try c.decodeIfPresent(String.self, forKey: .tournament)
        statusRaw = try c.decode(String.self, forKey: .statusRaw)
        ourScore = try c.decodeIfPresent(Int.self, forKey: .ourScore)
        opponentScore = try c.decodeIfPresent(Int.self, forKey: .opponentScore)
        resultRaw = try c.decodeIfPresent(String.self, forKey: .resultRaw)
        comment = try c.decodeIfPresent(String.self, forKey: .comment)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        updatedAt = try c.decode(Date.self, forKey: .updatedAt)
        roster = try c.decodeIfPresent([MatchPlayer].self, forKey: .roster) ?? []
    }
}

public enum MatchLimits {
    public static let maxOpponent = 150
    public static let maxLocation = 200
    public static let maxTournament = 150
    public static let maxComment = 2000
    public static let maxScore = 999
    public static let maxRoster = 50
}

/// What the person fills in to add or change a match.
public struct MatchInput: Equatable, Sendable {
    public let opponentName: String
    public let date: LocalDate
    public let time: LocalTime
    public let location: String?
    public let tournament: String?
    public let isHome: Bool

    /// Trims the text; empty optional fields become absent. nil when a value is impossible (see `problem`).
    public init?(opponentName: String, date: LocalDate, time: LocalTime, location: String = "", tournament: String = "", isHome: Bool = true) {
        if Self.problem(opponentName: opponentName, location: location, tournament: tournament) != nil { return nil }
        let place = location.trimmingCharacters(in: .whitespacesAndNewlines)
        let cup = tournament.trimmingCharacters(in: .whitespacesAndNewlines)
        self.opponentName = opponentName.trimmingCharacters(in: .whitespacesAndNewlines)
        self.date = date
        self.time = time
        self.location = place.isEmpty ? nil : place
        self.tournament = cup.isEmpty ? nil : cup
        self.isHome = isHome
    }

    /// Why the values cannot be sent (Russian text for the form), or nil when they can.
    public static func problem(opponentName: String, location: String, tournament: String) -> String? {
        let opponent = opponentName.trimmingCharacters(in: .whitespacesAndNewlines)
        if opponent.isEmpty { return "Укажите соперника." }
        if opponent.count > MatchLimits.maxOpponent { return "Название соперника не длиннее \(MatchLimits.maxOpponent) символов." }
        if location.trimmingCharacters(in: .whitespacesAndNewlines).count > MatchLimits.maxLocation {
            return "Место не длиннее \(MatchLimits.maxLocation) символов."
        }
        if tournament.trimmingCharacters(in: .whitespacesAndNewlines).count > MatchLimits.maxTournament {
            return "Название турнира не длиннее \(MatchLimits.maxTournament) символов."
        }
        return nil
    }

    fileprivate var timeText: String { String(format: "%02d:%02d:00", time.hour, time.minute) }
}

public extension TeamMatch {
    /// The form's values for this match (to change it).
    var asInput: MatchInput? {
        MatchInput(opponentName: opponentName, date: matchDate, time: startTime, location: location ?? "", tournament: tournament ?? "", isHome: isHome)
    }
}

/// The score of a played match.
public struct MatchResultInput: Equatable, Sendable {
    public let ourScore: Int
    public let opponentScore: Int
    public let comment: String?

    public init?(ourScore: Int, opponentScore: Int, comment: String = "") {
        if Self.problem(ourScore: ourScore, opponentScore: opponentScore, comment: comment) != nil { return nil }
        let text = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        self.ourScore = ourScore
        self.opponentScore = opponentScore
        self.comment = text.isEmpty ? nil : text
    }

    public static func problem(ourScore: Int, opponentScore: Int, comment: String) -> String? {
        if !(0...MatchLimits.maxScore).contains(ourScore) || !(0...MatchLimits.maxScore).contains(opponentScore) {
            return "Счёт — от 0 до \(MatchLimits.maxScore)."
        }
        if comment.trimmingCharacters(in: .whitespacesAndNewlines).count > MatchLimits.maxComment {
            return "Комментарий не длиннее \(MatchLimits.maxComment) символов."
        }
        return nil
    }

    /// What the score means for us, the way the server works it out.
    public var outcome: MatchOutcome { ourScore > opponentScore ? .win : (ourScore < opponentScore ? .loss : .draw) }
}

/// The body of "add a match". Cleared optional fields are absent, as the server's defaults want.
struct MatchCreateBody: Encodable, Sendable {
    let opponentName: String
    let matchDate: LocalDate
    let startTime: String
    let location: String?
    let isHome: Bool
    let tournament: String?

    init(_ input: MatchInput) {
        opponentName = input.opponentName
        matchDate = input.date
        startTime = input.timeText
        location = input.location
        isHome = input.isHome
        tournament = input.tournament
    }
}

/// The body of "change a match": the server replaces everything, so cleared fields go as explicit nulls (otherwise removing
/// the place in the form would silently keep the old one) and the status is always stated.
struct MatchUpdateBody: Encodable, Sendable {
    let input: MatchInput
    let status: String

    private enum CodingKeys: String, CodingKey { case opponentName, matchDate, startTime, location, isHome, tournament, status }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(input.opponentName, forKey: .opponentName)
        try c.encode(input.date, forKey: .matchDate)
        try c.encode(input.timeText, forKey: .startTime)
        try c.encode(input.location, forKey: .location)
        try c.encode(input.isHome, forKey: .isHome)
        try c.encode(input.tournament, forKey: .tournament)
        try c.encode(status, forKey: .status)
    }
}

/// The body of "enter the score": a cleared comment goes as a null, because the server replaces the old one.
struct MatchResultBody: Encodable, Sendable {
    let input: MatchResultInput

    private enum CodingKeys: String, CodingKey { case ourScore, opponentScore, comment }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(input.ourScore, forKey: .ourScore)
        try c.encode(input.opponentScore, forKey: .opponentScore)
        try c.encode(input.comment, forKey: .comment)
    }
}

struct MatchRosterBody: Encodable, Sendable {
    let userIds: [UUID]
}
