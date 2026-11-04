import Foundation

public enum CalendarEventKind: Equatable, Sendable {
    case training, match, taskDeadline
    /// A kind a newer server may add: shown as a plain entry instead of failing the whole calendar.
    case other(String)

    public init(raw: String) {
        switch raw {
        case "training": self = .training
        case "match": self = .match
        case "task_deadline": self = .taskDeadline
        default: self = .other(raw)
        }
    }
}

/// One line of the calendar (`GET /api/calendar`): a training, a match or the deadline of a task.
public struct CalendarEvent: Decodable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let kind: CalendarEventKind
    public let date: LocalDate
    public let time: LocalTime?
    public let title: String
    public let teamId: UUID?
    public let teamName: String?
    /// The server's status: "scheduled", "completed", "cancelled" for trainings and matches (other words for tasks).
    public let status: String

    public init(id: UUID, kind: CalendarEventKind, date: LocalDate, time: LocalTime?, title: String, teamId: UUID?, teamName: String?, status: String) {
        self.id = id
        self.kind = kind
        self.date = date
        self.time = time
        self.title = title
        self.teamId = teamId
        self.teamName = teamName
        self.status = status
    }

    private enum CodingKeys: String, CodingKey { case id, type, date, time, title, teamId, teamName, status }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        kind = CalendarEventKind(raw: try c.decode(String.self, forKey: .type))
        date = try c.decode(LocalDate.self, forKey: .date)
        time = try c.decodeIfPresent(LocalTime.self, forKey: .time)
        title = try c.decode(String.self, forKey: .title)
        teamId = try c.decodeIfPresent(UUID.self, forKey: .teamId)
        teamName = try c.decodeIfPresent(String.self, forKey: .teamName)
        status = try c.decode(String.self, forKey: .status)
    }

    public var isTraining: Bool { kind == .training }

    /// A training that was planned for a day that has passed and was never marked held or cancelled (the same rule as the site).
    public func isOverdue(today: LocalDate) -> Bool { isTraining && status == "scheduled" && date < today }

    public var isCancelled: Bool { status == "cancelled" }
    public var isCompleted: Bool { status == "completed" }
}

public struct CalendarDay: Equatable, Identifiable, Sendable {
    public let date: LocalDate
    public let events: [CalendarEvent]
    public var id: LocalDate { date }
}

public enum CalendarGrouping {
    /// Events sorted by day then time (an entry without a time goes first), grouped by day.
    public static func days(_ events: [CalendarEvent]) -> [CalendarDay] {
        let sorted = events.sorted { lhs, rhs in
            if lhs.date != rhs.date { return lhs.date < rhs.date }
            return (lhs.time?.minutesSinceMidnight ?? -1, lhs.title) < (rhs.time?.minutesSinceMidnight ?? -1, rhs.title)
        }
        var result: [CalendarDay] = []
        for event in sorted {
            if let last = result.last, last.date == event.date {
                result[result.count - 1] = CalendarDay(date: last.date, events: last.events + [event])
            } else {
                result.append(CalendarDay(date: event.date, events: [event]))
            }
        }
        return result
    }

    /// The seven days of a week, including the empty ones (a week view shows every day).
    public static func week(_ events: [CalendarEvent], startingAt monday: LocalDate) -> [CalendarDay] {
        let byDay = Dictionary(grouping: days(events), by: \.date)
        return monday.weekDays.map { day in byDay[day]?.first ?? CalendarDay(date: day, events: []) }
    }

    /// What the list screen shows.
    public struct List: Equatable, Sendable {
        /// Trainings that were planned for a past day and never marked held or cancelled: they need the coach's attention.
        public let overdue: [CalendarDay]
        /// Today and later, soonest first.
        public let upcoming: [CalendarDay]
        /// Earlier days (held or cancelled), the most recent first.
        public let past: [CalendarDay]
    }

    public static func list(_ events: [CalendarEvent], today: LocalDate) -> List {
        let overdue = events.filter { $0.isOverdue(today: today) }
        let others = events.filter { !$0.isOverdue(today: today) }
        return List(
            overdue: days(overdue),
            upcoming: days(others.filter { $0.date >= today }),
            past: days(others.filter { $0.date < today }).reversed()
        )
    }
}

public enum TrainingType: String, Sendable {
    case team, personal, independent

    public var title: String {
        switch self {
        case .team: "Тренировка команды"
        case .personal: "Личная тренировка"
        case .independent: "Самостоятельная тренировка"
        }
    }
}

public enum TrainingStatus: String, Sendable {
    case scheduled, completed, cancelled

    public var title: String {
        switch self {
        case .scheduled: "Запланирована"
        case .completed: "Проведена"
        case .cancelled: "Отменена"
        }
    }
}

public struct Training: Decodable, Equatable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public let teamId: UUID?
    public let createdBy: UUID
    public let type: String
    public let planId: UUID?
    public let trainingDate: LocalDate
    public let startTime: LocalTime
    public let durationMinutes: Int
    public let location: String?
    public let description: String?
    public let status: String
    public let reminderMinutesBefore: Int?
    public let recurrenceGroupId: UUID?
    public let responsibleUserId: UUID?

    public var trainingType: TrainingType? { TrainingType(rawValue: type) }
    public var trainingStatus: TrainingStatus? { TrainingStatus(rawValue: status) }

    /// "18:30 – 19:30" (and "+1" if it ends after midnight).
    public var timeRange: String {
        let end = startTime.adding(minutes: durationMinutes)
        return "\(startTime.display) – \(end.time.display)\(end.nextDay ? " (+1 день)" : "")"
    }
}
