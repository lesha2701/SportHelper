import Foundation

/// Handing the head coach's role to another member of the team. The server wants the confirmation phrase of the site word for word
/// («Я передаю роль главного тренера команды «…» пользователю Имя Фамилия»); the app writes it itself after the person has confirmed.
public enum OwnershipTransfer {
    /// The phrase the server compares with (it strips the ends, so a missing last name leaves no trailing space).
    public static func phrase(teamName: String, to member: TeamMember) -> String {
        "Я передаю роль главного тренера команды «\(teamName)» пользователю \(member.firstName) \(member.lastName ?? "")"
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Whom the role can go to: any other member of the team.
    public static func candidates(in members: [TeamMember]) -> [TeamMember] {
        members.filter { $0.role != .headCoach }.sorted { $0.fullName.localizedCaseInsensitiveCompare($1.fullName) == .orderedAscending }
    }

    /// The server's texts for these cases are English: say them in the app's words.
    public static func russian(_ error: APIError) -> APIError {
        let text: String? = switch error.code {
        case "forbidden": "Передать роль может только главный тренер команды."
        case "not_found": "Этого участника уже нет в команде. Обновите экран."
        case "confirmation_mismatch": "Не удалось подтвердить передачу: обновите экран и попробуйте ещё раз."
        default: nil
        }
        return text.map { APIError(status: error.status, code: error.code, message: $0, field: error.field, retryAfter: error.retryAfter) } ?? error
    }
}

struct OwnershipTransferBody: Encodable, Sendable {
    let toUserId: UUID
    let confirmationPhrase: String
}
