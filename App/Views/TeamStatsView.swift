import SportArenaKit
import SwiftUI

/// What the coaching staff sees of a team: attendance, tasks, matches, who needs attention, and the written analyses.
struct TeamStatsView: View {
    @Environment(AuthStore.self) private var auth
    let team: Team

    @State private var state: LoadState<TeamStats> = .loading

    var body: some View {
        LoadStateView(state: state, loading: "Загрузка статистики…", failure: "Не удалось загрузить статистику", retry: { Task { await fetch() } }) { stats in
            ScrollView {
                VStack(spacing: 16) { content(stats) }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
            }
            .background(Color(.systemGroupedBackground))
            .refreshable { await fetch() }
        }
        .sagScreen()
        .navigationTitle("Статистика")
        .navigationBarTitleDisplayMode(.inline)
        .task { await fetch() }
    }

    private func fetch() async {
        switch await auth.stats.team(team.id) {
        case .success(let stats): state = .loaded(stats)
        case .failure(let error): if state.value == nil { state = .failed(error.message) }
        }
    }

    @ViewBuilder private func content(_ stats: TeamStats) -> some View {
        Text(team.name).font(.title3.bold()).frame(maxWidth: .infinity, alignment: .leading)
        if stats.hasActivity {
            StatTiles([
                (StatsFormat.rate(stats.attendanceRate), "Посещаемость"), ("\(stats.membersCount)", "Игроков в составе"),
                ("\(stats.trainingsCompleted)", "Проведено тренировок"), ("\(stats.independentTrainings)", "Из них самостоятельных"),
            ])
            DashboardCard("Задания") {
                StatRow(title: "Выполнено", value: "\(stats.tasksCompleted) / \(stats.tasksTotal)")
                StatRow(title: "Просрочено", value: "\(stats.tasksOverdue)")
                if stats.avgDifficulty != nil { StatRow(title: "Средняя сложность", value: "\(StatsFormat.average(stats.avgDifficulty)) / 10") }
                if stats.avgWellbeing != nil { StatRow(title: "Среднее самочувствие", value: "\(StatsFormat.average(stats.avgWellbeing)) / 5") }
            }
            .accessibilityIdentifier("teamStats.tasks")
            DashboardCard("Матчи") {
                StatRow(title: "Сыграно", value: "\(stats.matchesPlayed)")
                StatRow(title: "Победы", value: "\(stats.matchesWon)")
                StatRow(title: "Ничьи", value: "\(stats.matchesDrawn)")
                StatRow(title: "Поражения", value: "\(stats.matchesLost)")
            }
            .accessibilityIdentifier("teamStats.matches")
            attentionCard(stats)
        } else {
            ContentUnavailableView {
                Label("Статистика пока пуста", systemImage: "chart.bar")
            } description: {
                Text("Она появится после первых проведённых тренировок, матчей или отчётов по заданиям.")
            }
            .accessibilityIdentifier("teamStats.empty")
        }
        AnalysisCard(
            title: "Сводка по команде", hint: "Краткая сводка и предупреждение о возможной перегрузке игроков, если она есть.",
            button: "Сформировать сводку", identifier: "teamStats.summary"
        ) { await auth.stats.teamSummary(team.id) }
        AnalysisCard(
            title: "Анализ посещаемости", hint: "ИИ разберёт посещаемость игроков и подскажет, на что обратить внимание.",
            button: "Проанализировать посещаемость", identifier: "teamStats.attendanceAnalysis"
        ) { await auth.stats.attendanceAnalysis(team.id) }
        AnalysisCard(
            title: "Анализ отчётов", hint: "ИИ разберёт последние отчёты о самостоятельных тренировках.",
            button: "Проанализировать отчёты", identifier: "teamStats.reportAnalysis"
        ) { await auth.stats.reportAnalysis(team.id) }
    }

    @ViewBuilder private func attentionCard(_ stats: TeamStats) -> some View {
        let list = stats.needAttention
        if !list.isEmpty {
            DashboardCard("Требуют внимания") {
                ForEach(list) { player in
                    NavigationLink {
                        PlayerStatsView(userId: player.userId, name: player.fullName)
                    } label: {
                        HStack(spacing: 12) {
                            ZStack {
                                Circle().fill(Theme.primary.opacity(0.15))
                                Text(String(player.firstName.prefix(1)).uppercased()).font(.subheadline.bold()).foregroundStyle(Theme.primary)
                            }
                            .frame(width: 34, height: 34)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(player.fullName).foregroundStyle(.primary)
                                Text(StatsFormat.absences(player.absentCount)).font(.footnote).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(StatsFormat.rate(player.attendanceRate)).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityIdentifier("teamStats.attention")
                }
            }
        }
    }
}
