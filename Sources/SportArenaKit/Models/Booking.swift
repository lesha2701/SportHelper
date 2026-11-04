import Foundation

/// The server's wall clock: bookings and slots are instants in UTC, and the site (and the calendar) show their UTC hours as the
/// time of the session. These helpers read a booking time the same way, so a session never shows an hour that the calendar disagrees with.
public extension Date {
    private static let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }()

    /// The day of this instant on the server's clock.
    var serverDay: LocalDate { LocalDate(date: self, calendar: Self.utc) }

    /// The time of day of this instant on the server's clock.
    var serverTime: LocalTime {
        let parts = Self.utc.dateComponents([.hour, .minute], from: self)
        return LocalTime(hour: parts.hour ?? 0, minute: parts.minute ?? 0) ?? LocalTime(hour: 0, minute: 0)!
    }
}

public enum BookingFormat: String, Codable, CaseIterable, Identifiable, Sendable {
    case online, offline
    public var id: String { rawValue }
    public var title: String { self == .online ? "Онлайн" : "Очно" }
}

public enum BookingStatus: Equatable, Sendable {
    case pending, confirmed, declined, expired, cancelled
    case other(String)

    init(raw: String) {
        switch raw {
        case "pending": self = .pending
        case "confirmed": self = .confirmed
        case "declined": self = .declined
        case "expired": self = .expired
        case "cancelled": self = .cancelled
        default: self = .other(raw)
        }
    }

    public var title: String {
        switch self {
        case .pending: "Ждёт ответа тренера"
        case .confirmed: "Подтверждена"
        case .declined: "Отклонена"
        case .expired: "Истекла"
        case .cancelled: "Отменена"
        case .other(let raw): raw
        }
    }
}

/// Where a booking is on the way to being paid. `notRequired` is a free session.
public enum PaymentStatus: Equatable, Sendable {
    case notRequired, unpaid, processing, paid, canceled, refundPending, refunded
    case other(String)

    init(raw: String) {
        switch raw {
        case "not_required": self = .notRequired
        case "unpaid": self = .unpaid
        case "processing": self = .processing
        case "paid": self = .paid
        case "canceled": self = .canceled
        case "refund_pending": self = .refundPending
        case "refunded": self = .refunded
        default: self = .other(raw)
        }
    }

    public var title: String {
        switch self {
        case .notRequired: "Оплата не нужна"
        case .unpaid: "Ожидает оплаты"
        case .processing: "Оплата обрабатывается"
        case .paid: "Оплачено"
        case .canceled: "Платёж отменён"
        case .refundPending: "Возврат обрабатывается"
        case .refunded: "Возвращено"
        case .other(let raw): raw
        }
    }
}

/// A booking of a personal training (`BookingOut`), as the athlete and the coach both see it.
public struct Booking: Decodable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let coachUserId: UUID
    public let coachFullName: String
    public let listingId: UUID?
    public let listingTitle: String?
    public let athleteUserId: UUID
    public let athleteFullName: String
    public let athleteNotes: String?
    public let startsAt: Date
    public let durationMinutes: Int
    public let format: String
    public let pricePerSession: Decimal?
    public let currency: String
    public let statusRaw: String
    public let isCompleted: Bool
    public let trainingId: UUID?
    public let trainingPlanName: String?
    public let hasReview: Bool
    public let paymentStatusRaw: String?
    public let paidAt: Date?

    private enum CodingKeys: String, CodingKey {
        case id, coachUserId, coachFullName, listingId, listingTitle, athleteUserId, athleteFullName, athleteNotes, startsAt
        case durationMinutes, format, pricePerSession, currency, isCompleted, trainingId, trainingPlanName, hasReview, paidAt
        case statusRaw = "status"
        case paymentStatusRaw = "paymentStatus"
    }

    public var status: BookingStatus { BookingStatus(raw: statusRaw) }
    /// A booking from an older server that does not say it is treated as having no payment information.
    public var paymentStatus: PaymentStatus { paymentStatusRaw.map(PaymentStatus.init(raw:)) ?? .notRequired }
    public var bookingFormat: BookingFormat? { BookingFormat(rawValue: format) }
    public var day: LocalDate { startsAt.serverDay }
    public var time: LocalTime { startsAt.serverTime }

    public var priceText: String? { pricePerSession.map { Money.format($0, currency: currency) } }

    /// The "Оплатить" button: a confirmed session that has a price and is not paid or being paid. The server checks everything again.
    public var canPay: Bool {
        guard status == .confirmed, !isCompleted, let price = pricePerSession, price > 0 else { return false }
        return paymentStatus == .unpaid || paymentStatus == .canceled
    }

    /// The chat of a personal training is open for a confirmed session that is paid (or free): the same rule as the server's.
    public var hasChat: Bool {
        status == .confirmed && [.paid, .refundPending, .notRequired].contains(paymentStatus)
    }
}

/// A request waiting for the coach's answer (`PendingBookingOut`).
public struct PendingBooking: Decodable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let listingTitle: String?
    public let athleteUserId: UUID
    public let athleteFullName: String
    public let athleteNotes: String?
    public let startsAt: Date
    public let durationMinutes: Int
    public let format: String
    public let pricePerSession: Decimal?
    public let currency: String
    public let createdAt: Date
    public let athleteRatingAverage: Double?
    public let athleteReviewCount: Int?

    public var bookingFormat: BookingFormat? { BookingFormat(rawValue: format) }
    public var day: LocalDate { startsAt.serverDay }
    public var time: LocalTime { startsAt.serverTime }
    public var priceText: String? { pricePerSession.map { Money.format($0, currency: currency) } }
}

/// A new booking request. `startsAt` is the slot's instant exactly as the server offered it.
public struct BookingRequest: Encodable, Sendable {
    public let listingId: UUID
    public let startsAt: Date
    public let format: BookingFormat
    public let athleteNotes: String?

    public init(listingId: UUID, startsAt: Date, format: BookingFormat, athleteNotes: String? = nil) {
        self.listingId = listingId
        self.startsAt = startsAt
        self.format = format
        let notes = athleteNotes?.trimmed
        self.athleteNotes = (notes?.isEmpty ?? true) ? nil : notes
    }

    public static let maxNotesLength = 1000
}

/// The payment page the person is sent to.
public struct PaymentStart: Decodable, Equatable, Sendable {
    public let confirmationUrl: String

    /// The page to open - only an https address. A plain http page, or anything else, is never opened for a payment.
    public var url: URL? {
        guard let url = URL(string: confirmationUrl), url.scheme?.lowercased() == "https", url.host?.isEmpty == false else { return nil }
        return url
    }
}
