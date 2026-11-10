import Foundation

/// A calendar day with no time zone: the server sends trainings as a plain `YYYY-MM-DD` and a `HH:MM:SS` time, meaning "that
/// day, that hour on the wall clock". Treating them as instants in a zone would shift them; these types never do.
public struct LocalDate: Hashable, Comparable, Codable, Sendable {
    public let year: Int
    public let month: Int
    public let day: Int

    public init(year: Int, month: Int, day: Int) {
        self.year = year
        self.month = month
        self.day = day
    }

    /// "2026-11-04"; nil when it is not a real date.
    public init?(iso: String) {
        let parts = iso.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]) else { return nil }
        let candidate = LocalDate(year: year, month: month, day: day)
        guard candidate.asDate != nil else { return nil }
        self = candidate
    }

    public init(from decoder: Decoder) throws {
        let text = try decoder.singleValueContainer().decode(String.self)
        guard let date = LocalDate(iso: text) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Not a date: \(text)"))
        }
        self = date
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(iso)
    }

    public var iso: String { String(format: "%04d-%02d-%02d", year, month, day) }

    public static func < (lhs: LocalDate, rhs: LocalDate) -> Bool { (lhs.year, lhs.month, lhs.day) < (rhs.year, rhs.month, rhs.day) }

    // Arithmetic is done on UTC noon in the Gregorian calendar: no daylight-saving gap can ever move a day.
    private static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        calendar.firstWeekday = 2
        return calendar
    }()

    /// This day as a `Date` (noon UTC), for formatting and arithmetic. nil for a date that does not exist (31 February).
    public var asDate: Date? {
        guard let date = Self.calendar.date(from: DateComponents(year: year, month: month, day: day, hour: 12)) else { return nil }
        let back = Self.calendar.dateComponents([.year, .month, .day], from: date)
        return back.year == year && back.month == month && back.day == day ? date : nil
    }

    public init(date: Date, calendar: Calendar = .current) {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        self.init(year: parts.year ?? 1970, month: parts.month ?? 1, day: parts.day ?? 1)
    }

    /// Today for the person holding the phone (their own calendar and zone).
    public static func today(now: Date = Date(), calendar: Calendar = .current) -> LocalDate { LocalDate(date: now, calendar: calendar) }

    public func adding(days: Int) -> LocalDate {
        guard let date = asDate, let moved = Self.calendar.date(byAdding: .day, value: days, to: date) else { return self }
        return LocalDate(date: moved, calendar: Self.calendar)
    }

    /// 0 = Monday ... 6 = Sunday (the week starts on Monday, as on the site).
    public var weekdayIndex: Int {
        guard let date = asDate else { return 0 }
        return (Self.calendar.component(.weekday, from: date) + 5) % 7
    }

    public var startOfWeek: LocalDate { adding(days: -weekdayIndex) }

    public var weekDays: [LocalDate] { (0..<7).map { startOfWeek.adding(days: $0) } }

    public func days(until other: LocalDate) -> Int {
        guard let from = asDate, let to = other.asDate else { return 0 }
        return Self.calendar.dateComponents([.day], from: from, to: to).day ?? 0
    }
}

/// A wall-clock time ("18:30"). The server sends "18:30:00".
public struct LocalTime: Hashable, Comparable, Sendable {
    public let hour: Int
    public let minute: Int

    public init?(hour: Int, minute: Int) {
        guard (0..<24).contains(hour), (0..<60).contains(minute) else { return nil }
        self.hour = hour
        self.minute = minute
    }

    /// "18:30" or "18:30:00".
    public init?(string: String) {
        let parts = string.split(separator: ":")
        guard parts.count >= 2, parts.count <= 3, let hour = Int(parts[0]), let minute = Int(parts[1]) else { return nil }
        self.init(hour: hour, minute: minute)
    }

    public var display: String { String(format: "%02d:%02d", hour, minute) }
    public var minutesSinceMidnight: Int { hour * 60 + minute }

    public static func < (lhs: LocalTime, rhs: LocalTime) -> Bool { lhs.minutesSinceMidnight < rhs.minutesSinceMidnight }

    /// The time `minutes` later and whether it crossed midnight.
    public func adding(minutes: Int) -> (time: LocalTime, nextDay: Bool) {
        let total = minutesSinceMidnight + minutes
        let wrapped = ((total % 1440) + 1440) % 1440
        return (LocalTime(hour: wrapped / 60, minute: wrapped % 60) ?? self, total >= 1440)
    }
}

extension LocalTime: Decodable {
    public init(from decoder: Decoder) throws {
        let text = try decoder.singleValueContainer().decode(String.self)
        guard let time = LocalTime(string: text) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Not a time: \(text)"))
        }
        self = time
    }
}
