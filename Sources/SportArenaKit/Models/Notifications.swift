import Foundation

/// What a notification is about. The server may add categories later: an unknown one is read as `.other` (shown, with no switch or target)
/// instead of making the whole list unreadable.
public enum NotificationCategory: String, Codable, CaseIterable, Identifiable, Sendable {
    case trainingReminder = "training_reminder"
    case taskDeadline = "task_deadline"
    case newTraining = "new_training"
    case newMatch = "new_match"
    case newTask = "new_task"
    case bookingRequested = "booking_requested"
    case bookingDecided = "booking_decided"
    case reviewRequested = "review_requested"
    case trainingNudge = "training_nudge"
    case paymentUpdate = "payment_update"
    case earningUpdate = "earning_update"
    case withdrawalUpdate = "withdrawal_update"
    case financeAdmin = "finance_admin"
    case chatBooking = "chat_booking"
    case chatTeam = "chat_team"
    case other

    public var id: String { rawValue }

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = NotificationCategory(rawValue: raw) ?? .other
    }

    /// The categories a person can switch off, in the order the site lists them. (Payments, earnings and finance alerts are
    /// transactional: they arrive always.)
    public static let switchable: [NotificationCategory] = [
        .trainingReminder, .taskDeadline, .newTraining, .newMatch, .newTask, .bookingRequested, .bookingDecided,
        .reviewRequested, .trainingNudge, .chatBooking, .chatTeam,
    ]

    /// The line of the settings, as the site words it.
    public var settingsTitle: String {
        switch self {
        case .trainingReminder: "Напоминания о тренировках"
        case .taskDeadline: "Напоминания о дедлайнах заданий"
        case .newTraining: "Новые тренировки в команде"
        case .newMatch: "Новые матчи"
        case .newTask: "Новые задания"
        case .bookingRequested: "Новые заявки на тренировку (для тренера)"
        case .bookingDecided: "Статус моих заявок на тренировку"
        case .reviewRequested: "Просьба оставить отзыв о тренере"
        case .trainingNudge: "Напоминания «Пора потренироваться»"
        case .paymentUpdate: "Статус оплаты тренировок"
        case .earningUpdate: "Поступления на баланс (для тренера)"
        case .withdrawalUpdate: "Статус заявок на вывод (для тренера)"
        case .financeAdmin: "Финансовые события (для администратора)"
        case .chatBooking: "Сообщения в чате личной тренировки"
        case .chatTeam: "Сообщения в чате команды"
        case .other: "Другое"
        }
    }

    /// An SF Symbol standing for the category in the list.
    public var symbol: String {
        switch self {
        case .trainingReminder, .newTraining: "calendar"
        case .taskDeadline, .newTask: "checklist"
        case .newMatch: "trophy"
        case .bookingRequested, .bookingDecided: "tray"
        case .reviewRequested: "star"
        case .trainingNudge: "figure.run"
        case .paymentUpdate, .earningUpdate, .withdrawalUpdate: "creditcard"
        case .financeAdmin: "shield"
        case .chatBooking, .chatTeam: "bubble.left"
        case .other: "bell"
        }
    }
}

/// Where a tap on a notification leads, as the site's `notificationToOverlay` decides it. The app turns each into a screen it has;
/// `none` is a notification that only informs (money, which the app does not show yet).
public enum NotificationTarget: Equatable, Sendable {
    case training(UUID)
    case match(UUID)
    case task(UUID)
    case incomingBookings
    case myBookings
    case bookingChat(UUID)
    case teamChat(UUID)
    case newPersonalTraining
    case none
}

public struct NotificationItem: Decodable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let category: NotificationCategory
    public let title: String
    public let body: String
    public let entityType: String
    public let entityId: UUID
    public let sendAt: Date
    public let readAt: Date?

    public init(
        id: UUID, category: NotificationCategory, title: String, body: String, entityType: String = "", entityId: UUID,
        sendAt: Date, readAt: Date? = nil
    ) {
        self.id = id
        self.category = category
        self.title = title
        self.body = body
        self.entityType = entityType
        self.entityId = entityId
        self.sendAt = sendAt
        self.readAt = readAt
    }

    public var isUnread: Bool { readAt == nil }

    public var target: NotificationTarget {
        switch category {
        case .trainingReminder, .newTraining: .training(entityId)
        case .newMatch: .match(entityId)
        case .taskDeadline, .newTask: .task(entityId)
        case .bookingRequested: .incomingBookings
        case .bookingDecided, .reviewRequested, .paymentUpdate: .myBookings
        case .trainingNudge: .newPersonalTraining
        case .chatBooking: .bookingChat(entityId)
        case .chatTeam: .teamChat(entityId)
        case .earningUpdate, .withdrawalUpdate, .financeAdmin, .other: .none
        }
    }

    /// The same notification marked as read.
    public func read(at date: Date) -> NotificationItem {
        NotificationItem(
            id: id, category: category, title: title, body: body, entityType: entityType, entityId: entityId, sendAt: sendAt,
            readAt: readAt ?? date
        )
    }
}

public struct NotificationPreference: Codable, Equatable, Identifiable, Sendable {
    public let category: NotificationCategory
    public var enabled: Bool

    public init(category: NotificationCategory, enabled: Bool) {
        self.category = category
        self.enabled = enabled
    }

    public var id: String { category.rawValue }
}

struct NotificationPreferencesRequest: Encodable, Sendable {
    let preferences: [NotificationPreference]
}
