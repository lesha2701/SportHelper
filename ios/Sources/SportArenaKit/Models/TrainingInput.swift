import Foundation

public enum TrainingLimits {
    public static let maxDurationMinutes = 600
    public static let maxLocation = 200
    public static let maxDescription = 2000
    public static let maxReminderMinutes = 10_080
    /// A weekly series is capped so one slip of a finger ("until 2030") cannot create hundreds of trainings.
    public static let maxSeriesLength = 60
}

/// "How long before the start to remind", as the form offers it.
public enum TrainingReminder {
    public static let options: [Int?] = [nil, 0, 15, 30, 60, 120, 1440]

    public static func title(_ minutes: Int?) -> String {
        guard let minutes else { return "Без напоминания" }
        switch minutes {
        case 0: return "В момент начала"
        case 60: return "За 1 час"
        case 1440: return "За 1 день"
        case let value where value % 1440 == 0: return "За \(value / 1440) дн."
        case let value where value % 60 == 0: return "За \(value / 60) ч"
        default: return "За \(minutes) мин"
        }
    }
}

/// What the person fills in to schedule or change a team training.
public struct TrainingInput: Equatable, Sendable {
    public let date: LocalDate
    public let time: LocalTime
    public let durationMinutes: Int
    public let location: String?
    public let description: String?
    public let reminderMinutesBefore: Int?
    /// Only when scheduling: the last day of a weekly series (the training repeats on the same weekday).
    public let repeatWeeklyUntil: LocalDate?
    /// A training the team holds without the coach; one player is responsible for it.
    public let isIndependent: Bool
    public let responsibleUserId: UUID?
    /// Kept as it is when a training is edited: the update replaces everything, so a missing plan would detach it.
    public let planId: UUID?

    /// Trims the text; empty optional fields become absent. Returns nil when a value is impossible (see `problem`).
    public init?(
        date: LocalDate, time: LocalTime, durationMinutes: Int, location: String = "", description: String = "", reminderMinutesBefore: Int? = nil,
        repeatWeeklyUntil: LocalDate? = nil, isIndependent: Bool = false, responsibleUserId: UUID? = nil, planId: UUID? = nil
    ) {
        if Self.problem(
            date: date, durationMinutes: durationMinutes, location: location, description: description,
            reminder: reminderMinutesBefore, repeatUntil: repeatWeeklyUntil
        ) != nil { return nil }
        let place = location.trimmingCharacters(in: .whitespacesAndNewlines)
        let text = description.trimmingCharacters(in: .whitespacesAndNewlines)
        self.date = date
        self.time = time
        self.durationMinutes = durationMinutes
        self.location = place.isEmpty ? nil : place
        self.description = text.isEmpty ? nil : text
        self.reminderMinutesBefore = reminderMinutesBefore
        self.repeatWeeklyUntil = repeatWeeklyUntil
        self.isIndependent = isIndependent
        self.responsibleUserId = isIndependent ? responsibleUserId : nil
        self.planId = planId
    }

    /// Why the values cannot be sent (Russian text for the form), or nil when they can.
    public static func problem(
        date: LocalDate, durationMinutes: Int, location: String, description: String, reminder: Int?, repeatUntil: LocalDate?
    ) -> String? {
        if !(1...TrainingLimits.maxDurationMinutes).contains(durationMinutes) {
            return "Длительность — от 1 до \(TrainingLimits.maxDurationMinutes) минут."
        }
        if location.trimmingCharacters(in: .whitespacesAndNewlines).count > TrainingLimits.maxLocation {
            return "Место не длиннее \(TrainingLimits.maxLocation) символов."
        }
        if description.trimmingCharacters(in: .whitespacesAndNewlines).count > TrainingLimits.maxDescription {
            return "Описание не длиннее \(TrainingLimits.maxDescription) символов."
        }
        if let reminder, !(0...TrainingLimits.maxReminderMinutes).contains(reminder) { return "Напоминание — не раньше чем за неделю." }
        if let repeatUntil {
            if repeatUntil < date { return "Повтор должен заканчиваться не раньше первой тренировки." }
            if Self.weeklyDates(from: date, until: repeatUntil).count > TrainingLimits.maxSeriesLength {
                return "Не больше \(TrainingLimits.maxSeriesLength) тренировок в серии."
            }
        }
        return nil
    }

    /// The days of a weekly series, the first one included (the server builds the same list).
    public static func weeklyDates(from start: LocalDate, until end: LocalDate) -> [LocalDate] {
        var result: [LocalDate] = []
        var current = start
        while current <= end, result.count <= TrainingLimits.maxSeriesLength {
            result.append(current)
            current = current.adding(days: 7)
        }
        return result
    }

    public var seriesCount: Int { repeatWeeklyUntil.map { Self.weeklyDates(from: date, until: $0).count } ?? 1 }

    fileprivate var timeText: String { String(format: "%02d:%02d:00", time.hour, time.minute) }
}

/// The body of "schedule a training". Cleared optional fields are absent, as the server's defaults want.
struct TrainingCreateBody: Encodable, Sendable {
    let trainingDate: LocalDate
    let startTime: String
    let durationMinutes: Int
    let location: String?
    let description: String?
    let planId: UUID?
    let reminderMinutesBefore: Int?
    let repeatWeeklyUntil: LocalDate?
    let isIndependent: Bool
    let responsibleUserId: UUID?

    init(_ input: TrainingInput) {
        trainingDate = input.date
        startTime = input.timeText
        durationMinutes = input.durationMinutes
        location = input.location
        description = input.description
        planId = input.planId
        reminderMinutesBefore = input.reminderMinutesBefore
        repeatWeeklyUntil = input.repeatWeeklyUntil
        isIndependent = input.isIndependent
        responsibleUserId = input.responsibleUserId
    }
}

/// The body of "change a training": the server replaces everything, so cleared fields go as explicit nulls (otherwise removing the
/// place in the form would silently keep the old one) and the status is always stated.
struct TrainingUpdateBody: Encodable, Sendable {
    let input: TrainingInput
    let status: String

    private enum CodingKeys: String, CodingKey {
        case trainingDate, startTime, durationMinutes, location, description, planId, reminderMinutesBefore, status, isIndependent, responsibleUserId
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(input.date, forKey: .trainingDate)
        try container.encode(input.timeText, forKey: .startTime)
        try container.encode(input.durationMinutes, forKey: .durationMinutes)
        try container.encode(input.location, forKey: .location)
        try container.encode(input.description, forKey: .description)
        try container.encode(input.planId, forKey: .planId)
        try container.encode(input.reminderMinutesBefore, forKey: .reminderMinutesBefore)
        try container.encode(status, forKey: .status)
        try container.encode(input.isIndependent, forKey: .isIndependent)
        try container.encode(input.responsibleUserId, forKey: .responsibleUserId)
    }
}

public extension Training {
    /// The form's values for this training (to change it), without any series.
    var asInput: TrainingInput? {
        TrainingInput(
            date: trainingDate, time: startTime, durationMinutes: durationMinutes, location: location ?? "", description: description ?? "",
            reminderMinutesBefore: reminderMinutesBefore, isIndependent: type == "independent", responsibleUserId: responsibleUserId, planId: planId
        )
    }
}
