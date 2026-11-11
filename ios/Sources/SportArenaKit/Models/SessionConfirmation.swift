import Foundation

/// Whether a booked session took place (docs/session-confirmation.md): the athlete confirms it, or the coach enters the athlete's
/// one-time code (in-person sessions), or it confirms itself 48 hours after the end unless someone reports a problem.
public enum SessionConfirmationState: Equatable, Sendable {
    /// The session is not over yet.
    case scheduled
    /// Over; waiting for the athlete (or the 48 hours).
    case awaiting
    case confirmed
    case autoConfirmed
    /// A side reported a problem; the coach's money waits for an administrator.
    case disputed
    case resolvedReleased
    case resolvedRefunded

    /// A state this version does not know yet is shown as waiting, never as an error.
    init(raw: String) {
        switch raw {
        case "scheduled": self = .scheduled
        case "confirmed": self = .confirmed
        case "auto_confirmed": self = .autoConfirmed
        case "disputed": self = .disputed
        case "resolved_released": self = .resolvedReleased
        case "resolved_refunded": self = .resolvedRefunded
        default: self = .awaiting
        }
    }
}

/// What a side can report about a session. The server checks who may report what.
public enum SessionProblemKind: String, CaseIterable, Identifiable, Sendable {
    case athleteNoShow = "athlete_no_show"
    case coachNoShow = "coach_no_show"
    case notConducted = "not_conducted"
    case other

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .athleteNoShow: "Игрок не пришёл"
        case .coachNoShow: "Тренер не пришёл"
        case .notConducted: "Тренировка не состоялась"
        case .other: "Другое"
        }
    }

    /// The kinds a side may choose (the athlete cannot report their own no-show, the coach theirs).
    public static func offered(to side: CancelSide) -> [SessionProblemKind] {
        side == .athlete ? [.coachNoShow, .notConducted, .other] : [.athleteNoShow, .other]
    }

    /// «Другое» needs words: the server refuses it without them.
    public func needsText(_ text: String) -> Bool {
        self == .other && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// `BookingOut.session_confirmation`: the state as one side sees it, and what that side may do now (the server already decided).
public struct SessionConfirmation: Decodable, Equatable, Sendable {
    private let stateRaw: String
    /// When it confirms itself unless someone reports a problem: on the server's clock, like the session's own time.
    public let windowClosesAt: Date
    public let coachMarkedAt: Date?
    public let confirmedAt: Date?
    public let confirmedMethod: String?
    public let disputedByRole: String?
    private let disputeKindRaw: String?
    public let disputeText: String?
    public let resolvedAt: Date?
    public let canConfirm: Bool
    public let canReportProblem: Bool
    public let canGetCode: Bool
    public let canEnterCode: Bool

    private enum CodingKeys: String, CodingKey {
        case windowClosesAt, coachMarkedAt, confirmedAt, confirmedMethod, disputedByRole, disputeText, resolvedAt
        case canConfirm, canReportProblem, canGetCode, canEnterCode
        case stateRaw = "state"
        case disputeKindRaw = "disputeKind"
    }

    public var state: SessionConfirmationState { SessionConfirmationState(raw: stateRaw) }
    public var disputeKind: SessionProblemKind? { disputeKindRaw.flatMap(SessionProblemKind.init(rawValue:)) }
    public var hasActions: Bool { canConfirm || canReportProblem || canGetCode || canEnterCode }

    /// The line about whether the session took place, as the side reads it (nil where there is nothing to say yet).
    public func line(side: CancelSide) -> String? {
        switch state {
        case .scheduled:
            return nil
        case .awaiting:
            let auto = CancelWording.moment(windowClosesAt)
            return side == .athlete
                ? "Тренировка прошла? Подтвердите её или сообщите о проблеме. Без ответа подтвердится автоматически \(auto)."
                : "Ждём подтверждения игрока. Без ответа тренировка подтвердится автоматически \(auto)."
        case .confirmed:
            if confirmedMethod == "code" { return "Тренировка подтверждена кодом игрока." }
            return side == .athlete ? "Вы подтвердили тренировку." : "Игрок подтвердил тренировку."
        case .autoConfirmed:
            return "Тренировка подтверждена автоматически."
        case .disputed:
            let what = (disputeKind?.title ?? "Проблема").lowercased()
            let mine = (disputedByRole == "coach") == (side == .coach)
            if mine { return "Вы сообщили: \(what). Решение примет администратор." }
            let who = disputedByRole == "coach" ? "Тренер" : "Игрок"
            return side == .athlete
                ? "\(who) сообщил: \(what). Решение примет администратор; если это не так — напишите в поддержку."
                : "\(who) сообщил: \(what). Оплата заморожена до решения администратора."
        case .resolvedReleased:
            return side == .athlete ? "Спор решён: оплата осталась у тренера." : "Спор решён: оплата за занятие ваша."
        case .resolvedRefunded:
            return side == .athlete ? "Спор решён: деньги возвращаются вам." : "Спор решён: деньги возвращены игроку."
        }
    }
}

/// The athlete's one-time code: shown once; asking again issues a new one and this one stops working.
public struct SessionCode: Decodable, Equatable, Sendable {
    public let code: String
    public let expiresAt: Date

    /// «482 913»: two halves are easier to read out loud.
    public var display: String {
        guard code.count == 6 else { return code }
        return "\(code.prefix(3)) \(code.suffix(3))"
    }
}

struct SessionCodeBody: Encodable, Sendable { let code: String }

struct SessionProblemBody: Encodable, Sendable {
    let kind: String
    let text: String?
}
