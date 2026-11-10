import SportArenaKit
import SwiftUI

/// Makes an entry of the calendar open what it is: a training, a match or a task. (A match needs the team the person belongs to;
/// when it cannot be found the entry is shown but does not open.)
struct EventLink<Label: View>: View {
    @Environment(AuthStore.self) private var auth
    let event: CalendarEvent
    var identifier = "event.link"
    @ViewBuilder let label: () -> Label

    private var team: Team? { event.teamId.flatMap { id in auth.teams.mine.loadedTeams.first { $0.id == id } } }

    var body: some View {
        switch event.kind {
        case .training:
            NavigationLink {
                TrainingDetailView(trainingId: event.id, title: event.title, teamName: event.teamName)
            } label: {
                label()
            }
            .accessibilityIdentifier(identifier)
        case .match:
            if let team {
                NavigationLink { MatchDetailView(matchId: event.id, team: team) } label: { label() }.accessibilityIdentifier(identifier)
            } else {
                label()
            }
        case .taskDeadline:
            if let teamId = event.teamId {
                NavigationLink { TaskDetailView(taskId: event.id, teamId: teamId) } label: { label() }.accessibilityIdentifier(identifier)
            } else {
                label()
            }
        case .other:
            label()
        }
    }
}
