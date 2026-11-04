import Foundation
import SportArenaKit

/// Russian wording for days. A `LocalDate` has no time zone, so these are formatted in UTC to keep the day exactly as it is.
enum LocalDateFormat {
    private static func formatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.setLocalizedDateFormatFromTemplate(format)
        return formatter
    }

    /// "среда, 4 ноября"
    static func dayAndMonth(_ date: LocalDate) -> String {
        date.asDate.map { formatter("EEEEdMMMM").string(from: $0) } ?? date.iso
    }

    /// "среда, 4 ноября 2026 г."
    static func full(_ date: LocalDate) -> String {
        date.asDate.map { formatter("EEEEdMMMMy").string(from: $0) } ?? date.iso
    }

    /// "пн" — the short weekday of a week strip.
    static func weekday(_ date: LocalDate) -> String {
        date.asDate.map { formatter("EEEEEE").string(from: $0) } ?? ""
    }

    /// "4 ноября"
    static func shortDay(_ date: LocalDate) -> String {
        date.asDate.map { formatter("dMMMM").string(from: $0) } ?? date.iso
    }

    /// "Сегодня, среда, 4 ноября" / "Завтра, …" / "Вчера, …" / "среда, 4 ноября".
    static func heading(_ date: LocalDate, today: LocalDate) -> String {
        let text = dayAndMonth(date)
        switch today.days(until: date) {
        case 0: return "Сегодня, \(text)"
        case 1: return "Завтра, \(text)"
        case -1: return "Вчера, \(text)"
        default: return text.prefix(1).uppercased() + text.dropFirst()
        }
    }

    /// "4–10 ноября" or "28 октября – 3 ноября".
    static func weekRange(_ monday: LocalDate) -> String {
        let sunday = monday.adding(days: 6)
        if monday.month == sunday.month { return "\(monday.day)–\(shortDay(sunday))" }
        return "\(shortDay(monday)) – \(shortDay(sunday))"
    }
}
