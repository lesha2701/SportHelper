import Foundation

/// One measured value of a player (a test result, a record, a body measurement). The player and the coaching staff of their team
/// add them; only whoever recorded a value can change or delete it.
public struct Metric: Decodable, Equatable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public let userId: UUID
    public let recordedBy: UUID
    public let name: String
    public let unit: String?
    public let value: Double
    public let recordedDate: LocalDate
    public let higherIsBetter: Bool
    public let source: String?
    public let comment: String?

    /// "12,5 см", "40" (no unit).
    public var valueText: String { MetricFormat.value(value, unit: unit) }

    /// Only the one who recorded a value may change it.
    public func canBeChanged(by user: UUID) -> Bool { recordedBy == user }

    public init(
        id: UUID, userId: UUID, recordedBy: UUID, name: String, unit: String?, value: Double, recordedDate: LocalDate,
        higherIsBetter: Bool, source: String?, comment: String?
    ) {
        self.id = id
        self.userId = userId
        self.recordedBy = recordedBy
        self.name = name
        self.unit = unit
        self.value = value
        self.recordedDate = recordedDate
        self.higherIsBetter = higherIsBetter
        self.source = source
        self.comment = comment
    }
}

/// The best value of every measured thing.
public struct PersonalRecord: Decodable, Equatable, Hashable, Identifiable, Sendable {
    public let name: String
    public let unit: String?
    public let value: Double
    public let recordedDate: LocalDate
    public let higherIsBetter: Bool

    public var id: String { name }
    public var valueText: String { MetricFormat.value(value, unit: unit) }
}

/// A line a coach wrote about the player (after a task, in a training report).
public struct CoachComment: Decodable, Equatable, Hashable, Identifiable, Sendable {
    public let context: String
    public let comment: String
    public let commentedAt: Date?

    public var id: String { "\(context)|\(comment)|\(commentedAt?.timeIntervalSince1970 ?? 0)" }
}

public enum MetricFormat {
    /// "12,5 см": the Russian decimal comma, no trailing zeros.
    public static func value(_ value: Double, unit: String?) -> String {
        let number = value.formatted(.number.precision(.fractionLength(0...2)).locale(Locale(identifier: "ru_RU")).grouping(.never))
        guard let unit, !unit.isEmpty else { return number }
        return "\(number) \(unit)"
    }
}

/// What the form of a metric produces: checked and tidied the way the server expects.
public struct MetricInput: Equatable, Sendable {
    public static let nameLimit = 150
    public static let unitLimit = 30
    public static let sourceLimit = 150
    public static let commentLimit = 1000

    public var name: String
    public var unit: String?
    public var value: Double
    public var date: LocalDate
    public var higherIsBetter: Bool
    public var source: String?
    public var comment: String?

    /// nil when something is wrong (see `problem`).
    public init?(
        name: String, unit: String = "", value: Double?, date: LocalDate, higherIsBetter: Bool = true, source: String = "", comment: String = ""
    ) {
        guard let value, Self.problem(name: name, unit: unit, value: value, source: source, comment: comment) == nil else { return nil }
        func tidy(_ text: String) -> String? {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        self.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        self.unit = tidy(unit)
        self.value = value
        self.date = date
        self.higherIsBetter = higherIsBetter
        self.source = tidy(source)
        self.comment = tidy(comment)
    }

    /// What is wrong with the form, in Russian, or nil.
    public static func problem(name: String, unit: String, value: Double?, source: String, comment: String) -> String? {
        let title = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if title.isEmpty { return "Назовите показатель." }
        if title.count > nameLimit { return "Название не длиннее \(nameLimit) знаков." }
        guard let value, value.isFinite else { return "Введите значение числом." }
        if abs(value) > 1_000_000_000 { return "Значение слишком большое." }
        if unit.trimmingCharacters(in: .whitespacesAndNewlines).count > unitLimit { return "Единица не длиннее \(unitLimit) знаков." }
        if source.trimmingCharacters(in: .whitespacesAndNewlines).count > sourceLimit { return "Источник не длиннее \(sourceLimit) знаков." }
        if comment.trimmingCharacters(in: .whitespacesAndNewlines).count > commentLimit { return "Комментарий не длиннее \(commentLimit) знаков." }
        return nil
    }

    /// Changes the form's values back from a saved metric.
    public init(_ metric: Metric) {
        name = metric.name
        unit = metric.unit
        value = metric.value
        date = metric.recordedDate
        higherIsBetter = metric.higherIsBetter
        source = metric.source
        comment = metric.comment
    }
}

/// Add and change are the same body; the empty fields go as explicit nulls so a cleared one is really cleared.
struct MetricBody: Encodable, Sendable {
    let name: String
    let unit: String?
    let value: Double
    let recordedDate: LocalDate
    let higherIsBetter: Bool
    let source: String?
    let comment: String?

    init(_ input: MetricInput) {
        name = input.name
        unit = input.unit
        value = input.value
        recordedDate = input.date
        higherIsBetter = input.higherIsBetter
        source = input.source
        comment = input.comment
    }

    private enum CodingKeys: String, CodingKey { case name, unit, value, recordedDate, higherIsBetter, source, comment }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(unit, forKey: .unit)
        try c.encode(value, forKey: .value)
        try c.encode(recordedDate, forKey: .recordedDate)
        try c.encode(higherIsBetter, forKey: .higherIsBetter)
        try c.encode(source, forKey: .source)
        try c.encode(comment, forKey: .comment)
    }
}

struct AIText: Decodable, Sendable { let text: String }
