import Foundation

/// Which side of the booking is looking: the athlete who booked or the coach who was booked.
public enum CancelSide: Equatable, Sendable { case athlete, coach }

/// By which rule a booking was (or would be) cancelled. The server decides it; the app only words it.
public enum CancelPolicy: Equatable, Sendable {
    /// Nothing was paid, so nothing is returned.
    case unpaid
    /// The athlete cancelled early enough: everything comes back.
    case athleteEarly
    /// The athlete cancelled late: nothing comes back, the coach keeps the payment.
    case athleteLate
    /// The coach cancelled: everything comes back.
    case coach
    case other(String)

    init(raw: String) {
        switch raw {
        case "unpaid": self = .unpaid
        case "athlete_early": self = .athleteEarly
        case "athlete_late": self = .athleteLate
        case "coach": self = .coach
        default: self = .other(raw)
        }
    }
}

/// How the refund of a cancelled booking stands: none (nothing to return), pending (the bank has it), succeeded, failed (an
/// administrator decides by hand).
public enum CancelRefundStatus: Equatable, Sendable {
    case none, pending, succeeded, failed
    case other(String)

    init(raw: String) {
        switch raw {
        case "none": self = .none
        case "pending": self = .pending
        case "succeeded": self = .succeeded
        case "failed": self = .failed
        default: self = .other(raw)
        }
    }
}

/// Wording shared by the cancel window and the card of a cancelled booking (kept here so it is tested without the app).
enum CancelWording {
    private static let months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]

    /// "20 ноября, 10:00" on the server's clock, the same hours the calendar shows.
    static func moment(_ date: Date) -> String {
        let day = date.serverDay
        return "\(day.day) \(months[max(0, min(11, day.month - 1))]), \(date.serverTime.display)"
    }
}

/// What cancelling the booking right now would mean (`GET /api/bookings/{id}/cancel-preview`). Asking changes nothing.
public struct CancelPreview: Decodable, Equatable, Sendable {
    public let bookingId: UUID
    public let cancelledByRole: String
    private let policyRaw: String
    public let hoursBeforeStart: Double
    public let freeCancelUntil: Date?
    public let paidKopecks: Int
    public let refundPercent: Int
    public let refundKopecks: Int
    public let trainerKeepsPayment: Bool

    private enum CodingKeys: String, CodingKey {
        case bookingId, cancelledByRole, hoursBeforeStart, freeCancelUntil, paidKopecks, refundPercent, refundKopecks, trainerKeepsPayment
        case policyRaw = "policy"
    }

    public var policy: CancelPolicy { CancelPolicy(raw: policyRaw) }
    public var refundText: String { Money.kopecks(refundKopecks) }

    /// What the person is told BEFORE pressing the button. The money is the server's calculation, never worked out here.
    public func explanation(side: CancelSide) -> String {
        let until = freeCancelUntil.map { CancelWording.moment($0) } ?? ""
        switch policy {
        case .unpaid:
            return "Запись не оплачена, поэтому отмена бесплатна: деньги не списывались."
        case .athleteEarly:
            return "Вернём \(refundPercent)% — \(refundText). Деньги вернутся на карту, с которой вы платили. Бесплатная отмена возможна до \(until)."
        case .athleteLate:
            return "До занятия осталось слишком мало времени (бесплатная отмена была возможна до \(until)). Деньги не вернутся: оплата остаётся у тренера."
        case .coach:
            return side == .coach
                ? "Игрок получит полный возврат — \(refundText). Комиссия платформы тоже возвращается, ваше начисление за это занятие снимается."
                : "Вернём \(refundPercent)% — \(refundText)."
        case .other:
            return "Условия отмены определит сервер."
        }
    }
}

/// Who cancelled a booking, why, by which rule and where the money is (`cancellation` of `BookingOut`).
public struct Cancellation: Decodable, Equatable, Sendable {
    public let cancelledByRole: String
    public let cancelledAt: Date
    public let reason: String?
    private let policyRaw: String
    public let refundPercent: Int
    public let refundAmountKopecks: Int
    private let refundStatusRaw: String

    private enum CodingKeys: String, CodingKey {
        case cancelledByRole, cancelledAt, reason, refundPercent, refundAmountKopecks
        case policyRaw = "policy"
        case refundStatusRaw = "refundStatus"
    }

    public var policy: CancelPolicy { CancelPolicy(raw: policyRaw) }
    public var refundStatus: CancelRefundStatus { CancelRefundStatus(raw: refundStatusRaw) }

    /// «Отменена вами · 20 ноября, 10:00»
    public func headline(side: CancelSide) -> String {
        let mine = (cancelledByRole == "coach") == (side == .coach)
        let who = mine ? "вами" : (cancelledByRole == "coach" ? "тренером" : "игроком")
        return "Отменена \(who) · \(CancelWording.moment(cancelledAt))"
    }

    /// The line about the money, seen from the side of whoever reads it (nil where nothing was paid or there is nothing to say).
    public func refundLine(side: CancelSide) -> String? {
        let sum = Money.kopecks(refundAmountKopecks)
        switch policy {
        case .unpaid:
            return nil
        case .athleteLate:
            return side == .coach
                ? "Отмена позже срока бесплатной отмены: оплата осталась у вас."
                : "Деньги не возвращены: отмена пришла позже срока бесплатной отмены."
        default:
            switch refundStatus {
            case .pending: return side == .coach ? "Игроку возвращается \(sum)." : "Возврат \(sum) обрабатывается. Деньги вернутся на карту, с которой вы платили."
            case .succeeded: return side == .coach ? "Игроку возвращено \(sum)." : "Возвращено \(sum) на карту, с которой вы платили."
            case .failed: return "Банк не принял возврат. Администратор разберётся вручную — если вопрос не решится, напишите в поддержку."
            case .none, .other: return nil
            }
        }
    }
}

/// The body of «cancel»: the coach's reason is required (the server insists too), the athlete's is optional.
struct CancelBody: Encodable, Sendable {
    let reason: String?
}

/// The reason typed into the cancel window.
public enum CancelReason {
    public static let maxLength = 500
    public static let minCoachLength = 3

    /// The text to send (trimmed; nil when empty).
    public static func tidy(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : String(trimmed.prefix(maxLength))
    }

    /// Why the cancellation cannot be sent yet (nil when it can).
    public static func problem(_ text: String, side: CancelSide) -> String? {
        guard side == .coach else { return nil }
        return (tidy(text)?.count ?? 0) >= minCoachLength ? nil : "Укажите причину отмены (не короче \(minCoachLength) знаков): игрок увидит её."
    }
}
