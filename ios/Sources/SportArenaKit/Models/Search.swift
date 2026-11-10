import Foundation

/// What a search can find, in the order the site lists the groups.
public enum SearchKind: String, Decodable, CaseIterable, Equatable, Sendable {
    case team, player, coach, training, match, task, exercise
    case other

    public init(from decoder: Decoder) throws {
        self = SearchKind(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .other
    }

    public var title: String {
        switch self {
        case .team: "Команды"
        case .player: "Игроки"
        case .coach: "Тренеры"
        case .training: "Тренировки"
        case .match: "Матчи"
        case .task: "Задания"
        case .exercise: "Упражнения"
        case .other: "Другое"
        }
    }

    public var symbol: String {
        switch self {
        case .team: "trophy"
        case .player: "person.2"
        case .coach: "rosette"
        case .training: "calendar"
        case .match: "sportscourt"
        case .task: "list.clipboard"
        case .exercise: "dumbbell"
        case .other: "magnifyingglass"
        }
    }
}

/// One thing found by the global search (`GET /api/search?q=`), across everything the person can see.
public struct SearchResult: Decodable, Equatable, Identifiable, Sendable {
    public let type: SearchKind
    public let id: UUID
    public let title: String
    public let subtitle: String?
    /// The team a player, a training, a match or a task belongs to.
    public let teamId: UUID?
    public let onDate: LocalDate?

    public init(type: SearchKind, id: UUID, title: String, subtitle: String? = nil, teamId: UUID? = nil, onDate: LocalDate? = nil) {
        self.type = type
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.teamId = teamId
        self.onDate = onDate
    }

    /// The same id may be a team and a player's id: the kind is part of what makes a result one.
    public var key: String { "\(type.rawValue)-\(id.uuidString)" }
}

public struct SearchGroup: Equatable, Identifiable, Sendable {
    public let kind: SearchKind
    public let items: [SearchResult]
    public var id: SearchKind { kind }
}

public enum SearchLogic {
    /// The server answers nothing to a shorter question.
    public static let minimumLength = 2
    /// The longest question the server takes.
    public static let maximumLength = 100

    /// The question as it is sent: without the spaces around it; nil while it is too short to ask.
    public static func question(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= minimumLength else { return nil }
        return String(trimmed.prefix(maximumLength))
    }

    /// The groups in the site's order. A kind the app does not know has nowhere to lead and is left out; a player has no library of
    /// exercises to open, so only a coach is shown them.
    public static func groups(_ results: [SearchResult], isCoach: Bool) -> [SearchGroup] {
        SearchKind.allCases.compactMap { kind in
            if kind == .other || (kind == .exercise && !isCoach) { return nil }
            let items = results.filter { $0.type == kind }
            return items.isEmpty ? nil : SearchGroup(kind: kind, items: items)
        }
    }
}
