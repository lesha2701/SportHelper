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

/// What a player sees of themselves, and the coaching staff of their teams sees of them (`GET /api/players/{id}/stats`).
public struct PlayerStats: Decodable, Equatable, Sendable {
    public let trainingsAttended: Int
    public let trainingsTotal: Int
    public let attendanceRate: Double?
    public let trainingMinutes: Int
    /// The team trainings the attendance rate is counted over.
    public let teamTrainingsCount: Int
    public let personalTrainingsCount: Int
    public let activityStreak: Int
    public let tasksTotal: Int
    public let tasksCompleted: Int
    public let tasksOverdue: Int
    public let matchesHistory: [PlayerMatchEntry]
    public let coachComments: [CoachComment]
    public let metrics: [Metric]
    public let personalRecords: [PersonalRecord]

    private enum CodingKeys: String, CodingKey {
        case trainingsAttended, trainingsTotal, attendanceRate, trainingMinutes, teamTrainingsCount, personalTrainingsCount
        case activityStreak, tasksTotal, tasksCompleted, tasksOverdue, matchesHistory, coachComments, metrics, personalRecords
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        trainingsAttended = try c.decode(Int.self, forKey: .trainingsAttended)
        trainingsTotal = try c.decode(Int.self, forKey: .trainingsTotal)
        attendanceRate = try c.decodeIfPresent(Double.self, forKey: .attendanceRate)
        trainingMinutes = try c.decode(Int.self, forKey: .trainingMinutes)
        teamTrainingsCount = try c.decodeIfPresent(Int.self, forKey: .teamTrainingsCount) ?? trainingsTotal
        personalTrainingsCount = try c.decodeIfPresent(Int.self, forKey: .personalTrainingsCount) ?? 0
        activityStreak = try c.decode(Int.self, forKey: .activityStreak)
        tasksTotal = try c.decode(Int.self, forKey: .tasksTotal)
        tasksCompleted = try c.decode(Int.self, forKey: .tasksCompleted)
        tasksOverdue = try c.decode(Int.self, forKey: .tasksOverdue)
        matchesHistory = try c.decodeIfPresent([PlayerMatchEntry].self, forKey: .matchesHistory) ?? []
        coachComments = try c.decodeIfPresent([CoachComment].self, forKey: .coachComments) ?? []
        metrics = try c.decodeIfPresent([Metric].self, forKey: .metrics) ?? []
        personalRecords = try c.decodeIfPresent([PersonalRecord].self, forKey: .personalRecords) ?? []
    }

    /// The latest played matches, the newest first.
    public func recentMatches(limit: Int = 3) -> [PlayerMatchEntry] {
        Array(matchesHistory.filter { $0.outcome != nil }.sorted { $0.matchDate > $1.matchDate }.prefix(limit))
    }

    /// Every played match, the newest first (what the history lists).
    public var playedMatches: [PlayerMatchEntry] { matchesHistory.filter { $0.outcome != nil }.sorted { $0.matchDate > $1.matchDate } }

    /// False while there is nothing at all to count: then the screen says the numbers will come later.
    public var hasActivity: Bool { trainingsTotal > 0 || tasksTotal > 0 || !matchesHistory.isEmpty || !metrics.isEmpty }
}

extension TeamStats {
    /// False before the first held training, task or match: the numbers are all zeros, and the screen says so instead.
    public var hasActivity: Bool { trainingsCompleted > 0 || tasksTotal > 0 || matchesPlayed > 0 }
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

    /// "9 из 10 тренировок", "1 из 1 тренировки": the word after «из» is in the genitive.
    public static func attended(_ attended: Int, of total: Int) -> String {
        let last = total % 10, lastTwo = total % 100
        let word = last == 1 && lastTwo != 11 ? "тренировки" : "тренировок"
        return "\(attended) из \(total) \(word)"
    }

    /// "5 ч 30 мин", "2 ч", "45 мин", "0 мин".
    public static func duration(minutes: Int) -> String {
        let hours = minutes / 60, rest = minutes % 60
        if hours == 0 { return "\(rest) мин" }
        return rest == 0 ? "\(hours) ч" : "\(hours) ч \(rest) мин"
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

    /// What is still to come before the week `today` is in ends (Sunday): the «Занятий на этой неделе» number of a coach without a team.
    public static func comingThisWeek(_ events: [CalendarEvent], today: LocalDate) -> [CalendarEvent] {
        let last = today.startOfWeek.adding(days: 6)
        return upcoming(events, today: today).filter { $0.date <= last }
    }

    /// The seven days (Monday to Sunday) of the week `today` is in, each with its events: the soonest first, an entry without a time first.
    public static func week(_ events: [CalendarEvent], today: LocalDate) -> [WeekDay] {
        let byDay = Dictionary(grouping: events, by: \.date)
        return today.weekDays.map { date in
            let day = (byDay[date] ?? []).sorted { lhs, rhs in
                (lhs.time?.minutesSinceMidnight ?? -1, lhs.title) < (rhs.time?.minutesSinceMidnight ?? -1, rhs.title)
            }
            return WeekDay(date: date, events: day, isToday: date == today)
        }
    }

    /// How many days ahead the home screen asks for: the rest of this week, and at least two weeks from today.
    public static func lastDayToLoad(today: LocalDate, daysAhead: Int) -> LocalDate {
        max(today.adding(days: daysAhead), today.startOfWeek.adding(days: 6))
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

/// One day of «Эта неделя».
public struct WeekDay: Equatable, Identifiable, Sendable {
    public let date: LocalDate
    public let events: [CalendarEvent]
    public let isToday: Bool
    public var id: LocalDate { date }

    /// Events that still matter on the day: a cancelled one is not counted.
    public var activeCount: Int { events.filter { !$0.isCancelled }.count }

    /// "Нет событий", "1 событие", "2 события", "5 событий".
    public var countText: String {
        activeCount == 0 ? "Нет событий" : Russian.plural(activeCount, one: "событие", few: "события", many: "событий")
    }
}
