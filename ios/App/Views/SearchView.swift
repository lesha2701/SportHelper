import SportArenaKit
import SwiftUI

/// The magnifier in the top bar of the home: opens the search over everything the person can see.
struct SearchButton: View {
    @Environment(AuthStore.self) private var auth
    @State private var showing = false

    var body: some View {
        Button { showing = true } label: {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.text)
                .frame(width: 38, height: 38)
                .background(Theme.surface, in: Circle())
                .overlay(Circle().strokeBorder(Theme.border, lineWidth: 1))
        }
        .accessibilityLabel("Поиск")
        .accessibilityIdentifier("search.button")
        .sheet(isPresented: $showing) { SearchView(isCoach: auth.user?.isCoach ?? false) }
    }
}

/// Global search, as the site's: teams, teammates, coaches, trainings, matches, tasks and (for a coach) exercises. A result opens its
/// own screen on top of the search; an exercise leads to the library.
struct SearchView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let isCoach: Bool

    private enum Outcome: Equatable {
        case idle, searching, failed(String)
        case found([SearchGroup])
    }

    private enum Destination: Hashable {
        case team(Team)
        case match(UUID, Team)
        case task(UUID, UUID)
        case training(UUID, String)
        case coach(UUID)
    }

    @State private var query = ""
    @State private var searching = true
    @State private var outcome = Outcome.idle
    @State private var destination: Destination?
    @State private var opening: String?
    @State private var openError: String?

    var body: some View {
        NavigationStack {
            List {
                switch outcome {
                case .idle:
                    Text("Введите хотя бы два символа: название команды, имя игрока или тренера, тренировку, матч, задание.")
                        .foregroundStyle(Theme.textSecondary).accessibilityIdentifier("search.hint")
                case .searching:
                    ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear)
                case .failed(let message):
                    Text(message).foregroundStyle(Theme.danger).accessibilityIdentifier("search.error")
                case .found(let groups):
                    if groups.isEmpty { Text("Ничего не найдено").foregroundStyle(Theme.textSecondary).accessibilityIdentifier("search.empty") }
                    ForEach(groups) { group in
                        Section(sag: group.kind.title) { ForEach(group.items) { row($0) } }
                    }
                }
                if let openError { Text(openError).font(.footnote).foregroundStyle(Theme.danger).accessibilityIdentifier("search.openError") }
            }
            .sagScreen()
            .navigationTitle("Поиск")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, isPresented: $searching, placement: .navigationBarDrawer(displayMode: .always), prompt: "Поиск по приложению")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Закрыть") { dismiss() }.accessibilityIdentifier("search.close") } }
            .task(id: query) { await run() }
            .navigationDestination(item: $destination) { screen(for: $0) }
        }
    }

    // MARK: rows

    private func row(_ result: SearchResult) -> some View {
        Button { Task { await open(result) } } label: {
            HStack(spacing: 12) {
                Image(systemName: result.type.symbol).foregroundStyle(Theme.primary)
                    .frame(width: 34, height: 34).background(Theme.primaryTint, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(result.title).font(Theme.body(15, weight: .semibold)).foregroundStyle(Theme.text)
                    if let line = detail(result) { Text(line).font(.footnote).foregroundStyle(Theme.textSecondary) }
                }
                Spacer(minLength: 0)
                if opening == result.key { ProgressView() }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(opening != nil)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("search.result")
    }

    private func detail(_ result: SearchResult) -> String? {
        let line = [result.subtitle, result.onDate.map(LocalDateFormat.dayAndMonth)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        return line.isEmpty ? nil : line
    }

    @ViewBuilder private func screen(for destination: Destination) -> some View {
        switch destination {
        case .team(let team): TeamDetailView(model: auth.teams.detail(for: team))
        case .match(let id, let team): MatchDetailView(matchId: id, team: team)
        case .task(let id, let teamId): TaskDetailView(taskId: id, teamId: teamId)
        case .training(let id, let title): TrainingDetailView(trainingId: id, title: title, teamName: nil)
        case .coach(let id): CoachProfileView(coachUserId: id)
        }
    }

    // MARK: actions

    /// Asks the server a moment after the person stops typing; typing on cancels the question that is still on its way.
    private func run() async {
        openError = nil
        guard SearchLogic.question(query) != nil else {
            outcome = .idle
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        outcome = .searching
        do {
            let found = try await auth.search.search(query)
            guard !Task.isCancelled else { return }
            outcome = .found(SearchLogic.groups(found, isCoach: isCoach))
        } catch let error as APIError {
            if !Task.isCancelled { outcome = .failed(error.message) }
        } catch {
            if !Task.isCancelled { outcome = .failed(APIError.unknown.message) }
        }
    }

    /// The site's choices: a team or a teammate leads to the team, an exercise to the library.
    private func open(_ result: SearchResult) async {
        openError = nil
        switch result.type {
        case .team: await openTeam(result.id, key: result.key) { .team($0) }
        case .player: await openTeam(result.teamId, key: result.key) { .team($0) }
        case .match: await openTeam(result.teamId, key: result.key) { .match(result.id, $0) }
        case .task:
            if let teamId = result.teamId { destination = .task(result.id, teamId) }
        case .training: destination = .training(result.id, result.title)
        case .coach: destination = .coach(result.id)
        case .exercise:
            dismiss()
            auth.router.tab = .library
        case .other: break
        }
    }

    private func openTeam(_ id: UUID?, key: String, then screen: (Team) -> Destination) async {
        guard let id else { return }
        opening = key
        defer { opening = nil }
        do {
            destination = screen(try await auth.teams.service.team(id: id))
        } catch let error as APIError {
            openError = error.message
        } catch {
            openError = APIError.unknown.message
        }
    }
}
