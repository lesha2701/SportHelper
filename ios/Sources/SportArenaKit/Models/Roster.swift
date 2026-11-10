import Foundation

/// What the coaching staff can do with a person of the team: give or take away a role, remove them, or block them for good.
/// The server enforces the same rules; here they decide which buttons are shown.
public enum RosterAction: Equatable, Hashable, Sendable {
    case makeCaptain, removeCaptain, makeAssistant, removeAssistant, remove, block

    /// The role the person gets, for the role actions.
    public var newRole: String? {
        switch self {
        case .makeCaptain: "captain"
        case .makeAssistant: "assistant_coach"
        case .removeCaptain, .removeAssistant: "player"
        case .remove, .block: nil
        }
    }

    public var title: String {
        switch self {
        case .makeCaptain: "Назначить капитаном"
        case .removeCaptain: "Снять с капитана"
        case .makeAssistant: "Назначить помощником"
        case .removeAssistant: "Снять с помощника"
        case .remove: "Удалить из команды"
        case .block: "Заблокировать"
        }
    }

    public var isDestructive: Bool { self == .remove || self == .block }

    /// The actions `actor` may take on a person with the role `target`, in the order they are shown. The head coach is never touched
    /// (they hand the team over or leave), nor is oneself; assistants are the head coach's to manage; blocking is the head coach's.
    public static func available(actor: TeamRole?, target: TeamRole, isSelf: Bool) -> [RosterAction] {
        guard let actor, actor.isStaff, target != .headCoach, !isSelf else { return [] }
        let isHead = actor == .headCoach
        if target == .assistantCoach && !isHead { return [] }
        var actions: [RosterAction] = []
        actions.append(target == .captain ? .removeCaptain : .makeCaptain)
        if isHead { actions.append(target == .assistantCoach ? .removeAssistant : .makeAssistant) }
        actions.append(.remove)
        if isHead { actions.append(.block) }
        return actions
    }

    /// The question before the action that cannot be undone, nil for the others.
    public func confirmation(for name: String) -> (title: String, message: String)? {
        switch self {
        case .remove: ("Удалить \(name) из команды?", "Человек сможет подать заявку снова.")
        case .block: ("Заблокировать \(name)?", "Человек будет удалён из команды и не сможет подать заявку повторно. В приложении это не отменить.")
        default: nil
        }
    }

    /// The server's texts for these cases are English: say them in the app's words.
    public static func russian(_ error: APIError) -> APIError {
        let text: String? = switch error.code {
        case "captain_already_assigned": "В команде уже есть капитан. Сначала снимите роль с него."
        case "forbidden": "Это действие вам недоступно."
        default: nil
        }
        return text.map { APIError(status: error.status, code: error.code, message: $0, field: error.field, retryAfter: error.retryAfter) } ?? error
    }
}

struct MemberRoleBody: Encodable, Sendable { let role: String }
