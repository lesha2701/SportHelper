import SportArenaKit
import SwiftUI

/// «Главная»: what is next, how things are going, and what needs doing. A player sees their own numbers and tasks, a coach the
/// numbers of the team they pick.
struct HomeView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.scenePhase) private var scenePhase
    let user: AuthUser

    private enum Quick: Identifiable {
        case training(Team), task(Team), match(Team), personal
        var id: String {
            switch self {
            case .training: "training"
            case .task: "task"
            case .match: "match"
            case .personal: "personal"
            }
        }
    }

    @State private var quick: Quick?

    private var home: HomeStore { auth.home }
    private var staffTeams: [Team] { auth.teams.mine.loadedTeams.filter(\.canManage) }
    private var selectedTeam: Team? { staffTeams.first { $0.id == home.selectedTeam } ?? staffTeams.first }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    AppTopBar()
                    heading
                    if user.isCoach { coachContent } else { playerContent }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .background(Theme.bg.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await reload() }
            .task(id: scenePhase == .active) { if scenePhase == .active { await reload() } }
            .task(id: selectedTeam?.id) {
                guard user.isCoach, let team = selectedTeam else { return }
                home.select(team.id)
                await home.loadTeam(team.id)
            }
            .sheet(item: $quick) { action in
                switch action {
                case .training(let team): TrainingFormView(mode: .schedule(team)) { Task { await reload() } }
                case .task(let team): TaskFormView(mode: .give(team)) { Task { await reload() } }
                case .match(let team): MatchFormView(mode: .add(team)) { _ in Task { await reload() } }
                case .personal: PersonalTrainingFormView { Task { await reload() } }
                }
            }
        }
    }

    /// The panel under the top bar: «Главная» and the name of the screen, with the stripes of the site behind it.
    private var heading: some View {
        ZStack(alignment: .leading) {
            Ornament(bold: false)
            VStack(alignment: .leading, spacing: 4) {
                Text("Главная").font(Theme.body(12, weight: .bold, relativeTo: .caption)).tracking(0.6).textCase(.uppercase).foregroundStyle(Theme.panelMuted)
                Text(user.isCoach ? "Тренерская панель" : "Твой прогресс")
                    .font(Theme.display(28, weight: .heavy, relativeTo: .title)).foregroundStyle(Theme.panelText)
                    .accessibilityAddTraits(.isHeader)
            }
            .padding(.horizontal, 18).padding(.vertical, 20)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusLarge, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusLarge, style: .continuous).strokeBorder(Theme.panelBorder, lineWidth: 1))
    }

    private func reload() async {
        if case .loading = auth.teams.mine { await auth.teams.reloadMine() } else { await auth.teams.reloadMine() }
        async let events: Void = home.loadEvents()
        if user.isCoach {
            if let team = selectedTeam { home.select(team.id); await home.loadTeam(team.id) }
        } else {
            await home.loadPlayer(user: user.id)
        }
        await events
    }

    // MARK: player

    @ViewBuilder private var playerContent: some View {
        nextEventCard
        Button { quick = .personal } label: {
            Label("Личная тренировка", systemImage: "plus")
        }
        .buttonStyle(.sag)
        .accessibilityIdentifier("home.addPersonal")
        switch home.playerStats {
        case .loaded(let stats):
            StatTiles([
                (StatsFormat.rate(stats.attendanceRate), "Посещаемость"), ("\(stats.activityStreak)", "Серия посещений"),
                ("\(stats.tasksCompleted)", "Заданий выполнено"), ("\(stats.tasksOverdue)", "Просрочено"),
            ])
            moreLink("Вся статистика", id: "home.myStats") { PlayerStatsView(userId: user.id) }
        case .failed(let message): problem(message)
        case .loading: ProgressView().frame(maxWidth: .infinity).padding()
        }
        tasksCard
        upcomingCard
        if let stats = home.playerStats.value {
            matchesCard(stats.recentMatches().map { entry in
                MatchLine(
                    id: entry.id, opponent: entry.opponentName,
                    detail: [LocalDateFormat.shortDay(entry.matchDate), entry.teamName].compactMap { $0 }.joined(separator: " · "),
                    score: entry.scoreText, outcome: entry.outcome
                )
            })
        }
    }

    private var tasksCard: some View {
        let todo = HomeLogic.tasksToDo(home.tasks.value ?? [])
        let allTasks = NavigationLink("Все задания") { MyTasksView() }.font(.subheadline).accessibilityIdentifier("home.allTasks")
        return DashboardCard("Нужно сделать", trailing: AnyView(allTasks)) {
            if todo.isEmpty {
                Text(home.tasks.value == nil ? "Загрузка…" : "Заданий на сейчас нет.").foregroundStyle(.secondary)
            }
            ForEach(todo.prefix(3)) { item in
                NavigationLink {
                    TaskDetailView(taskId: item.task.id, teamId: item.task.teamId)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.task.title).font(.headline).foregroundStyle(.primary)
                        HStack(spacing: 8) {
                            Text(item.assignment.status.title).font(.footnote.weight(.semibold)).foregroundStyle(item.assignment.status.color)
                            if let deadline = item.task.deadline {
                                Text("до \(LocalDateFormat.deadline(deadline))").font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("home.task")
            }
        }
    }

    // MARK: coach

    @ViewBuilder private var coachContent: some View {
        if case .loading = auth.teams.mine {
            ProgressView().frame(maxWidth: .infinity).padding()
        } else if staffTeams.isEmpty {
            ContentUnavailableView {
                Label("Пока нет команд", systemImage: "trophy")
            } description: {
                Text("Создайте команду, чтобы видеть здесь тренировки, нагрузку и задания.")
            } actions: {
                Button("Создать команду") { auth.router.tab = .teams }.buttonStyle(.sag).accessibilityIdentifier("home.createTeam")
            }
        } else {
            if staffTeams.count > 1 { teamSwitcher }
            nextEventCard
            teamNumbers
            attentionCard
            workloadCard
            upcomingCard
            matchesCard(HomeLogic.recentMatches(home.teamMatches.value ?? []).map { match in
                MatchLine(
                    id: match.id, opponent: match.opponentName, detail: LocalDateFormat.shortDay(match.matchDate) + (match.isHome ? " · дома" : " · в гостях"),
                    score: match.scoreText, outcome: match.outcome
                )
            })
            quickActions
        }
    }

    private var teamSwitcher: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack {
                ForEach(staffTeams) { team in
                    Button(team.name) { home.select(team.id) }
                        .buttonStyle(TeamChipStyle(selected: team.id == selectedTeam?.id))
                        .accessibilityIdentifier("home.team")
                        .accessibilityValue(team.id == selectedTeam?.id ? "Выбрана" : "")
                }
            }
        }
    }

    @ViewBuilder private var teamNumbers: some View {
        switch home.teamStats {
        case .loaded(let stats):
            StatTiles([
                (StatsFormat.rate(stats.attendanceRate), "Посещаемость"), ("\(stats.trainingsUpcoming)", "Тренировок впереди"),
                ("\(stats.tasksOverdue)", "Просрочено заданий"), (stats.recordText, "Победы–ничьи–поражения"),
            ])
            if let team = selectedTeam { moreLink("Статистика команды", id: "home.teamStats") { TeamStatsView(team: team) } }
        case .failed(let message): problem(message)
        case .loading: ProgressView().frame(maxWidth: .infinity).padding()
        }
    }

    private var attentionCard: some View {
        let list = Array((home.teamStats.value?.needAttention ?? []).prefix(4))
        return DashboardCard("Требуют внимания") {
            if list.isEmpty { Text("Все в порядке.").foregroundStyle(.secondary) }
            ForEach(list) { player in
                HStack(spacing: 12) {
                    ZStack {
                        Circle().fill(Theme.primary.opacity(0.15))
                        Text(String(player.firstName.prefix(1)).uppercased()).font(.subheadline.bold()).foregroundStyle(Theme.primary)
                    }
                    .frame(width: 34, height: 34)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(player.fullName)
                        Text(StatsFormat.absences(player.absentCount)).font(.footnote).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(StatsFormat.rate(player.attendanceRate)).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("home.attention")
            }
        }
    }

    @ViewBuilder private var workloadCard: some View {
        if let stats = home.teamStats.value {
            DashboardCard("Нагрузка команды") {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    workload("\(stats.trainingsCompleted)", "Тренировок проведено")
                    workload("\(stats.tasksCompleted)/\(stats.tasksTotal)", "Заданий выполнено")
                    workload(StatsFormat.average(stats.avgDifficulty), "Средняя сложность")
                    workload(StatsFormat.average(stats.avgWellbeing), "Самочувствие")
                }
            }
        }
    }

    private func workload(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.title3.bold())
            Text(label).font(.footnote).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var quickActions: some View {
        HStack(spacing: 10) {
            if let team = selectedTeam {
                quickButton("Тренировка", "figure.run", id: "home.quick.training") { quick = .training(team) }
                quickButton("Задание", "checklist", id: "home.quick.task") { quick = .task(team) }
                quickButton("Матч", "sportscourt", id: "home.quick.match") { quick = .match(team) }
            }
        }
    }

    private func quickButton(_ title: String, _ symbol: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: symbol).font(.title3).foregroundStyle(Theme.primary)
                Text(title).font(Theme.display(13, relativeTo: .footnote)).tracking(0.5).textCase(.uppercase).foregroundStyle(Theme.text)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).strokeBorder(Theme.borderStrong, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }

    // MARK: shared parts

    @ViewBuilder private var nextEventCard: some View {
        switch home.events {
        case .loaded(let events):
            if let next = HomeLogic.nextEvent(in: events, today: .today()) {
                EventLink(event: next, identifier: "home.next") { HeroEventCard(event: next) }.buttonStyle(.plain)
            } else {
                HeroEmptyCard(text: user.isCoach ? "Запланируйте тренировку или матч" : "Запишитесь на тренировку или дождитесь назначения от тренера")
            }
        case .failed(let message): problem(message)
        case .loading: ProgressView().frame(maxWidth: .infinity).padding()
        }
    }

    @ViewBuilder private var upcomingCard: some View {
        if let events = home.events.value {
            let list = HomeLogic.upcoming(events, today: .today())
            // the first one is already the big card
            let rest = Array(list.dropFirst().prefix(4))
            if !rest.isEmpty {
                DashboardCard("Ближайшие события", trailing: AnyView(Button("Календарь") { auth.router.tab = .calendar }.font(.subheadline))) {
                    ForEach(rest) { event in
                        EventLink(event: event, identifier: "home.event") {
                            EventRow(event: event, today: .today(), showDay: true).frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private struct MatchLine: Identifiable {
        let id: UUID
        let opponent: String
        let detail: String
        let score: String?
        let outcome: MatchOutcome?
    }

    private func matchesCard(_ lines: [MatchLine]) -> some View {
        DashboardCard("Последние матчи") {
            if lines.isEmpty { Text("Пока нет сыгранных матчей.").foregroundStyle(.secondary) }
            ForEach(lines) { line in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("против \(line.opponent)").font(.headline)
                        Text(line.detail).font(.footnote).foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        if let score = line.score { Text(score).font(.title3.bold().monospacedDigit()) }
                        if let outcome = line.outcome { Text(outcome.title).font(.caption).foregroundStyle(outcomeColor(outcome)) }
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("home.match")
            }
        }
    }

    private func outcomeColor(_ outcome: MatchOutcome) -> Color {
        switch outcome {
        case .win: Theme.success
        case .loss: Theme.danger
        case .draw: Theme.textSecondary
        }
    }

    private func moreLink<Destination: View>(_ title: String, id: String, @ViewBuilder destination: () -> Destination) -> some View {
        NavigationLink(destination: destination) {
            HStack {
                Text(title)
                Spacer()
                Image(systemName: "chevron.right").font(.footnote)
            }
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 4)
        }
        .accessibilityIdentifier(id)
    }

    private func problem(_ message: String) -> some View {
        Label(message, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.red)
            .frame(maxWidth: .infinity, alignment: .leading).padding(12)
            .background(Theme.dangerTint, in: RoundedRectangle(cornerRadius: 12))
    }
}

/// A team in the switcher of the coach's home: a chip, red when it is the one on screen.
private struct TeamChipStyle: ButtonStyle {
    let selected: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.display(14, relativeTo: .subheadline)).tracking(0.4).textCase(.uppercase)
            .foregroundStyle(selected ? Color.white : Theme.text)
            .padding(.horizontal, 14).padding(.vertical, 9)
            .background(selected ? Theme.primary : Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).strokeBorder(selected ? Color.clear : Theme.borderStrong, lineWidth: 1))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
    }
}

/// The next event, big: the panel of the site with a red wave behind the text, the date as a red badge, the name in capitals.
private struct HeroEventCard: View {
    let event: CalendarEvent

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                Text([LocalDateFormat.shortDay(event.date), event.time?.display].compactMap { $0 }.joined(separator: " · "))
                    .font(Theme.display(12, relativeTo: .caption)).tracking(1).textCase(.uppercase)
                    .foregroundStyle(.white).padding(.horizontal, 10).padding(.vertical, 5).background(Theme.primary, in: Capsule())
                if let team = event.teamName { Text(team).font(Theme.body(13)).foregroundStyle(Theme.panelMuted) }
                Spacer()
            }
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(event.title).font(Theme.display(30, weight: .heavy, relativeTo: .title)).textCase(.uppercase)
                        .foregroundStyle(Theme.panelText).multilineTextAlignment(.leading)
                    Text("Ближайшее событие").font(Theme.body(13.5)).foregroundStyle(Theme.panelMuted)
                }
                Spacer()
                Image(systemName: symbol).font(.title).foregroundStyle(Theme.panelText)
            }
        }
        .padding(22)
        .frame(maxWidth: .infinity, minHeight: 190, alignment: .topLeading)
        .background { Ornament(bold: true).opacity(0.14).allowsHitTesting(false) }
        .background(Theme.panel)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(Theme.panelBorder, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }

    private var symbol: String {
        switch event.kind {
        case .training: "figure.run"
        case .match: "sportscourt"
        case .taskDeadline: "checklist"
        case .other: "calendar"
        }
    }
}

private struct HeroEmptyCard: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Нет ближайших событий").font(Theme.display(26, weight: .heavy, relativeTo: .title2)).textCase(.uppercase).foregroundStyle(Theme.panelText)
            Text(text).font(Theme.body(13.5)).foregroundStyle(Theme.panelMuted)
        }
        .padding(22)
        .frame(maxWidth: .infinity, minHeight: 130, alignment: .topLeading)
        .background { Ornament(bold: true).opacity(0.14).allowsHitTesting(false) }
        .background(Theme.panel)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(Theme.panelBorder, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("home.noEvents")
    }
}
