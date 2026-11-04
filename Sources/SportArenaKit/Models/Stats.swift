import Foundation

/// How present a player has been (a row of "needs attention").
public struct PlayerActivity: Decodable, Equatable, Hashable, Identifiable, Sendable {
    public let userId: UUID
    public let firstName: String
    public let lastName: String?
    public let presentCount: Int
    public let absentCount: Int
    /// 0...1, or nil when there is nothing to count yet.
    public let attendanceRate: Double?

    public var id: UUID { userId }
    public var fullName: String { [firstName, lastName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ") }
}

/// What the coaching staff sees of a team (`GET /api/teams/{id}/stats`).
public struct TeamStats: Decodable, Equatable, Sendable {
    public let membersCount: Int
    public let trainingsCompleted: Int
    public let trainingsUpcoming: Int
    public let independentTrainings: Int
    public let attendanceRate: Double?
    public let tasksTotal: Int
    public let tasksCompleted: Int
    public let tasksOverdue: Int
    public let avgDifficulty: Double?
    public let avgWellbeing: Double?
    public let matchesPlayed: Int
    public let matchesWon: Int
    public let matchesLost: Int
    public let matchesDrawn: Int
    public let lowActivityPlayers: [PlayerActivity]
    public let frequentAbsencePlayers: [PlayerActivity]

    /// "5–1–2": won, drawn, lost - the order of the site.
    public var recordText: String { "\(matchesWon)–\(matchesDrawn)–\(matchesLost)" }

    /// The players to look at first: those who miss a lot or are rarely active, each once, the least present first.
    public var needAttention: [PlayerActivity] {
        var seen = Set<UUID>()
        let unique = (frequentAbsencePlayers + lowActivityPlayers).filter { seen.insert($0.userId).inserted }
        return unique.sorted { ($0.attendanceRate ?? 1, $0.fullName) < ($1.attendanceRate ?? 1, $1.fullName) }
    }
}

/// A match in a player's history.
public struct PlayerMatchEntry: Decodable, Equatable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public let opponentName: String
    public let matchDate: LocalDate
    public let ourScore: Int?
    public let opponentScore: Int?
    public let status: String
    public let teamName: String?

    public var outcome: MatchOutcome? {
        guard let ourScore, let opponentScore else { return nil }
        return ourScore > opponentScore ? .win : (ourScore < opponentScore ? .loss : .draw)
    }

    public var scoreText: String? {
        guard let ourScore, let opponentScore else { return nil }
        return "\(ourScore):\(opponentScore)"
    }
}

/// What a player sees of themselves (`GET /api/players/{id}/stats`). Only what the home screen needs is read.
public struct PlayerStats: Decodable, Equatable, Sendable {
    public let trainingsAttended: Int
    public let trainingsTotal: Int
    public let attendanceRate: Double?
    public let trainingMinutes: Int
    public let activityStreak: Int
    public let tasksTotal: Int
    public let tasksCompleted: Int
    public let tasksOverdue: Int
    public let matchesHistory: [PlayerMatchEntry]

    /// The latest played matches, the newest first.
    public func recentMatches(limit: Int = 3) -> [PlayerMatchEntry] {
        Array(matchesHistory.filter { $0.outcome != nil }.sorted { $0.matchDate > $1.matchDate }.prefix(limit))
    }
}

public enum StatsFormat {
    /// "85%", or "—" when there is nothing to count.
    public static func rate(_ rate: Double?) -> String {
        guard let rate else { return "—" }
        return "\(Int((rate * 100).rounded()))%"
    }

    /// "3,5", or "—".
    public static func average(_ value: Double?) -> String {
        guard let value else { return "—" }
        return value.formatted(.number.precision(.fractionLength(0...1)).locale(Locale(identifier: "ru_RU")))
    }

    /// "1 пропуск", "2 пропуска", "5 пропусков".
    public static func absences(_ count: Int) -> String {
        let last = count % 10, lastTwo = count % 100
        if last == 1 && lastTwo != 11 { return "\(count) пропуск" }
        if (2...4).contains(last) && !(12...14).contains(lastTwo) { return "\(count) пропуска" }
        return "\(count) пропусков"
    }
}

public extension TeamMatch {
    /// A played match with a result (what "last matches" lists).
    var isPlayed: Bool { status == .completed && outcome != nil }
}

public enum HomeLogic {
    /// The first thing still to come: today or later, not held and not cancelled, the soonest (an entry without a time first that day).
    public static func nextEvent(in events: [CalendarEvent], today: LocalDate) -> CalendarEvent? {
        upcoming(events, today: today).first
    }

    /// What is still to come, the soonest first.
    public static func upcoming(_ events: [CalendarEvent], today: LocalDate) -> [CalendarEvent] {
        events.filter { $0.date >= today && !$0.isCompleted && !$0.isCancelled }.sorted { lhs, rhs in
            if lhs.date != rhs.date { return lhs.date < rhs.date }
            return (lhs.time?.minutesSinceMidnight ?? -1, lhs.title) < (rhs.time?.minutesSinceMidnight ?? -1, rhs.title)
        }
    }

    /// The matches a team has played, the newest first.
    public static func recentMatches(_ matches: [TeamMatch], limit: Int = 3) -> [TeamMatch] {
        Array(matches.filter(\.isPlayed).sorted { ($0.matchDate, $0.startTime) > ($1.matchDate, $1.startTime) }.prefix(limit))
    }

    /// The tasks the player still has to do, the nearest deadline first (no deadline last).
    public static func tasksToDo(_ tasks: [MyTask]) -> [MyTask] {
        tasks.filter { $0.assignment.status.canSubmit }.sorted { ($0.task.deadline ?? .distantFuture) < ($1.task.deadline ?? .distantFuture) }
    }
}
