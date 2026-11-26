import SportArenaKit

/// Keep the team product in the codebase while the marketplace is the public focus.
enum FeatureVisibility {
    static let teams = false

    static func calendar(_ event: CalendarEvent) -> Bool {
        teams || (event.teamId == nil && event.kind != .match && event.kind != .taskDeadline)
    }

    static func notification(_ item: NotificationItem) -> Bool {
        teams || ![.taskDeadline, .newTask, .newMatch, .newTraining, .chatTeam].contains(item.category)
    }
}
