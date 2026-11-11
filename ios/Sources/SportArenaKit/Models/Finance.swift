import Foundation

/// «Финансы» of a coach: the balance, the money history and the withdrawal requests. Every amount is whole kopecks (the server never
/// sends a fraction); the app only shows them, it never adds, splits or computes a balance or a commission.
public struct FinanceSummary: Decodable, Equatable, Sendable {
    public let availableKopecks: Int
    public let pendingKopecks: Int
    public let reservedKopecks: Int
    public let paidOutKopecks: Int
    public let debtKopecks: Int
    public let minimumWithdrawalKopecks: Int
    public let withdrawalsEnabled: Bool
    public let canWithdraw: Bool
    public let shortfallKopecks: Int
    /// "10" or "12.5": as the server prints it.
    public let commissionPercent: String

    public init(
        availableKopecks: Int = 0, pendingKopecks: Int = 0, reservedKopecks: Int = 0, paidOutKopecks: Int = 0, debtKopecks: Int = 0,
        minimumWithdrawalKopecks: Int = 0, withdrawalsEnabled: Bool = false, canWithdraw: Bool = false, shortfallKopecks: Int = 0,
        commissionPercent: String = "0"
    ) {
        self.availableKopecks = availableKopecks
        self.pendingKopecks = pendingKopecks
        self.reservedKopecks = reservedKopecks
        self.paidOutKopecks = paidOutKopecks
        self.debtKopecks = debtKopecks
        self.minimumWithdrawalKopecks = minimumWithdrawalKopecks
        self.withdrawalsEnabled = withdrawalsEnabled
        self.canWithdraw = canWithdraw
        self.shortfallKopecks = shortfallKopecks
        self.commissionPercent = commissionPercent
    }

    /// Why the person cannot ask for a withdrawal, in the site's words (nil when the server allows it or the reason is the minimum).
    public var withdrawalNote: String? {
        if !withdrawalsEnabled { return "Вывод средств пока недоступен." }
        if shortfallKopecks > 0 {
            return "Минимальная сумма вывода — \(Money.kopecks(minimumWithdrawalKopecks)). Не хватает \(Money.kopecks(shortfallKopecks))."
        }
        return nil
    }

    public var debtNote: String? {
        guard debtKopecks > 0 else { return nil }
        return "За вами числится задолженность \(Money.kopecks(debtKopecks)): по возврату денег игроку, которые уже были выплачены. "
            + "Администратор свяжется с вами."
    }
}

public enum WithdrawalStatus: String, Decodable, Equatable, Sendable {
    case requested, underReview = "under_review", approved, processing, paid, rejected, canceled
    case other

    public init(from decoder: Decoder) throws {
        self = WithdrawalStatus(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .other
    }

    public var title: String {
        switch self {
        case .requested: "Заявка создана"
        case .underReview: "На проверке"
        case .approved: "Одобрена"
        case .processing: "Передана на выплату"
        case .paid: "Выплачено"
        case .rejected: "Отклонена"
        case .canceled: "Отменена"
        case .other: "Статус неизвестен"
        }
    }
}

public struct Withdrawal: Decodable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let amountKopecks: Int
    public let status: WithdrawalStatus
    /// "sbp" or "bank_transfer".
    public let method: String
    /// The details of the payout with most of the digits hidden (the server never sends them whole).
    public let detailsHint: String
    public let decidedReason: String?
    public let paidAt: Date?
    public let createdAt: Date

    public var amountText: String { Money.kopecks(amountKopecks) }

    /// The coach can take the request back until it goes to payment (the server says 409 `withdrawal_not_cancelable` after that).
    public var isCancelable: Bool { status == .requested || status == .underReview }
}

public struct FinanceOperation: Decodable, Equatable, Identifiable, Sendable {
    public let id: UUID
    /// payment_received, earning_released, withdrawal_reserved, withdrawal_released, withdrawal_paid, refund.
    public let kind: String
    public let createdAt: Date
    public let amountKopecks: Int
    public let grossKopecks: Int?
    public let platformFeeKopecks: Int?
    public let listingTitle: String?
    /// pending, held, available, reversed.
    public let earningStatus: String?
    public let withdrawalStatus: WithdrawalStatus?

    public var amountText: String { Money.kopecks(amountKopecks) }

    public var title: String {
        switch kind {
        case "payment_received": "Оплата занятия получена"
        case "earning_released": "Средства стали доступны к выводу"
        case "withdrawal_reserved": "Заявка на вывод создана"
        case "withdrawal_released": "Заявка на вывод закрыта, деньги вернулись на баланс"
        case "withdrawal_paid": "Выплата произведена"
        case "refund": "Возврат игроку"
        default: "Операция"
        }
    }

    /// The lines under the title: the lesson, who paid what, the status of the earning or of the request.
    public var details: [String] {
        var lines: [String] = []
        if let listingTitle { lines.append(listingTitle) }
        if kind == "payment_received" {
            if let gross = grossKopecks, let fee = platformFeeKopecks {
                lines.append("Игрок заплатил \(Money.kopecks(gross)), комиссия платформы \(Money.kopecks(fee))")
            }
            if let earningStatus { lines.append("Статус: " + Self.earningStatusText(earningStatus)) }
        }
        if let withdrawalStatus { lines.append("Заявка: " + withdrawalStatus.title) }
        return lines
    }

    static func earningStatusText(_ status: String) -> String {
        switch status {
        case "pending": "ждёт проведения занятия"
        case "held": "приостановлено на проверку"
        case "available": "доступно"
        case "reversed": "отменено"
        default: status
        }
    }
}

/// One page of a list that the server cuts into pieces (`limit` and `offset` are what was asked).
public struct FinancePage<Item: Decodable & Sendable>: Decodable, Sendable {
    public let total: Int
    public let limit: Int
    public let offset: Int
    public let items: [Item]

    public var hasMore: Bool { offset + items.count < total }
}
