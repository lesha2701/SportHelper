import Foundation

/// The platform's wall clock: a booking or slot time is the session's wall-clock time (Moscow) written with a UTC label
/// (10:00Z = 10:00 in Moscow), and the site (and the calendar) show its UTC hours as the time of the session. These helpers read a
/// booking time the same way, so a session never shows an hour that the calendar disagrees with. It is not a real instant: whether
/// a session has begun comes from the server (`Booking.hasStarted`), never from comparing it with the device's clock.
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
    public let trainingPlanId: UUID?
    public let trainingPlanName: String?
    public let hasReview: Bool
    /// «scheduled», «completed», «cancelled»: the state of the training behind the booking.
    public let trainingStatus: String?
    private let hasPlayerReviewRaw: Bool?
    public let paymentStatusRaw: String?
    public let paidAt: Date?
    private let canCancelRaw: Bool?
    private let hasStartedRaw: Bool?
    /// Set once the booking is cancelled: who, when, why and where the money is.
    public let cancellation: Cancellation?
    /// Whether the session took place: nil until the booking is confirmed, after it is cancelled, and from an older server.
    public let sessionConfirmation: SessionConfirmation?

    private enum CodingKeys: String, CodingKey {
        case id, coachUserId, coachFullName, listingId, listingTitle, athleteUserId, athleteFullName, athleteNotes, startsAt
        case durationMinutes, format, pricePerSession, currency, isCompleted, trainingId, trainingPlanId, trainingPlanName, hasReview, paidAt, trainingStatus, cancellation, sessionConfirmation
        case canCancelRaw = "canCancel"
        case hasStartedRaw = "hasStarted"
        case hasPlayerReviewRaw = "hasPlayerReview"
        case statusRaw = "status"
        case paymentStatusRaw = "paymentStatus"
    }

    public var status: BookingStatus { BookingStatus(raw: statusRaw) }
    /// The coach has already reviewed the athlete (an older server that does not say it counts as no).
    public var hasPlayerReview: Bool { hasPlayerReviewRaw ?? false }

    /// The «Отменить запись» button: the server says whether the booking can be cancelled right now (an older server that does not say it counts as no).
    public var canCancel: Bool { canCancelRaw ?? false }

    /// The athlete may review the coach once the session counts as held and no review was left.
    public var athleteCanReview: Bool { status == .confirmed && isCompleted && !hasReview }

    /// Whether the session has begun. The server says it (`has_started`): `startsAt` is the session's wall-clock time on the
    /// platform's clock with a UTC label (10:00Z = 10:00 in Moscow), so the device's clock cannot tell — compared with it, a
    /// Moscow session would "begin" three hours late. Only an older server that does not say it falls back to `now`.
    public func hasStarted(now: Date = Date()) -> Bool { hasStartedRaw ?? (startsAt <= now) }

    /// «Тренировка проведена»: the coach marks a session that has begun. (After that reviews open and the athlete is asked for one.)
    public func coachCanMarkConducted(now: Date = Date()) -> Bool {
        status == .confirmed && trainingStatus == "scheduled" && hasStarted(now: now)
    }

    /// The coach's review of the athlete. While «проведена» is still to be pressed, that button is the way in.
    public func coachCanReviewPlayer(now: Date = Date()) -> Bool {
        status == .confirmed && isCompleted && !hasPlayerReview && !coachCanMarkConducted(now: now)
    }

    /// A booking from an older server that does not say it is treated as having no payment information.
    public var paymentStatus: PaymentStatus { paymentStatusRaw.map(PaymentStatus.init(raw:)) ?? .notRequired }
    public var bookingFormat: BookingFormat? { BookingFormat(rawValue: format) }
    public var day: LocalDate { startsAt.serverDay }
    public var time: LocalTime { startsAt.serverTime }

    /// The athlete's booking behind a personal training, if the training is the session of one. Its date, time, length and place belong
    /// to the booking, not to the calendar: the server refuses to move it or delete it there.
    public static func session(ofTraining trainingId: UUID, in bookings: [Booking]) -> Booking? {
        bookings.first { $0.trainingId == trainingId }
    }

    /// The coach picks the plan of a confirmed session that is not held yet (the server needs the session to exist).
    public var canChoosePlan: Bool { status == .confirmed && !isCompleted && trainingId != nil }

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
