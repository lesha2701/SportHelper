import Foundation
import Observation
import SportArenaKit

/// What the home screen shows. Every part loads on its own, so one that fails (a coach's numbers, say) does not blank the rest.
@MainActor
@Observable
final class HomeStore {
    private(set) var events: LoadState<[CalendarEvent]> = .loading
    private(set) var playerStats: LoadState<PlayerStats> = .loading
    private(set) var tasks: LoadState<[MyTask]> = .loading
    private(set) var teamStats: LoadState<TeamStats> = .loading
    private(set) var teamMatches: LoadState<[TeamMatch]> = .loading
    /// The team a coach is looking at.
    var selectedTeam: UUID?

    private let calendar: CalendarService
    private let stats: StatsService
    private let tasksService: TasksService
    private let matches: MatchesService

    /// The home screen looks two weeks ahead (and shows the whole current week).
    static let daysAhead = 13

    init(client: APIClient) {
        calendar = CalendarService(client: client)
        stats = StatsService(client: client)
        tasksService = TasksService(client: client)
        matches = MatchesService(client: client)
    }

    func loadEvents() async {
        let today = LocalDate.today()
        // from Monday: the week card shows the days of this week that have already passed
        let last = HomeLogic.lastDayToLoad(today: today, daysAhead: Self.daysAhead)
        switch await apiResult({ [calendar] in try await calendar.events(from: today.startOfWeek, to: last) }) {
        case .success(let list): events = .loaded(list)
        case .failure(let error): if events.value == nil { events = .failed(error.message) }
        }
    }

    func loadPlayer(user: UUID) async {
        async let statsDone: Void = loadPlayerStats(user)
        async let tasksDone: Void = loadTasks()
        _ = await (statsDone, tasksDone)
    }

    private func loadPlayerStats(_ user: UUID) async {
        switch await apiResult({ [stats] in try await stats.player(user) }) {
        case .success(let value): playerStats = .loaded(value)
        case .failure(let error): if playerStats.value == nil { playerStats = .failed(error.message) }
        }
    }

    private func loadTasks() async {
        switch await apiResult({ [tasksService] in try await tasksService.mine() }) {
        case .success(let list): tasks = .loaded(list)
        case .failure(let error): if tasks.value == nil { tasks = .failed(error.message) }
        }
    }

    /// The numbers and the matches of one team.
    func loadTeam(_ team: UUID) async {
        async let statsDone: Void = loadTeamStats(team)
        async let matchesDone: Void = loadTeamMatches(team)
        _ = await (statsDone, matchesDone)
    }

    private func loadTeamStats(_ team: UUID) async {
        switch await apiResult({ [stats] in try await stats.team(team) }) {
        case .success(let value): teamStats = selected(team) ? .loaded(value) : teamStats
        case .failure(let error): if selected(team) { teamStats = .failed(error.message) }
        }
    }

    private func loadTeamMatches(_ team: UUID) async {
        switch await apiResult({ [matches] in try await matches.matches(of: team) }) {
        case .success(let list): teamMatches = selected(team) ? .loaded(list) : teamMatches
        case .failure(let error): if selected(team) { teamMatches = .failed(error.message) }
        }
    }

    /// An answer for a team the coach has already moved away from is dropped.
    private func selected(_ team: UUID) -> Bool { selectedTeam == team }

    /// Switching team: forget the old team's numbers at once, so they are never shown under the new name.
    func select(_ team: UUID) {
        guard selectedTeam != team else { return }
        selectedTeam = team
        teamStats = .loading
        teamMatches = .loading
    }

    func reset() {
        events = .loading
        playerStats = .loading
        tasks = .loading
        teamStats = .loading
        teamMatches = .loading
        selectedTeam = nil
    }
}
