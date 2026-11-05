import SportArenaKit
import SwiftUI

/// The statistics of one player: attendance, tasks, matches, measured values and the coach's words. A player opens their own
/// (and may ask for recommendations); the coaching staff opens a player of their team and may add measured values.
struct PlayerStatsView: View {
    @Environment(AuthStore.self) private var auth
    let userId: UUID
    var name: String?

    private enum Sheet: Identifiable {
        case add
        case edit(Metric)
        var id: String {
            switch self {
            case .add: "add"
            case .edit(let metric): metric.id.uuidString
            }
        }
    }

    @State private var state: LoadState<PlayerStats> = .loading
    @State private var sheet: Sheet?
    @State private var deleting: Metric?
    @State private var actionError: String?

    private var me: UUID? { auth.user?.id }
    private var isOwn: Bool { me == userId }

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
        .navigationTitle(isOwn ? "Статистика" : (name ?? "Статистика"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await fetch() }
        .sheet(item: $sheet) { item in
            switch item {
            case .add: MetricFormView(userId: userId, metric: nil) { Task { await fetch() } }
            case .edit(let metric): MetricFormView(userId: userId, metric: metric) { Task { await fetch() } }
            }
        }
        .confirmationDialog("Удалить показатель?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting) { metric in
            Button("Удалить", role: .destructive) { Task { await delete(metric) } }
        } message: { metric in
            Text(metric.name)
        }
    }

    private func fetch() async {
        switch await auth.stats.player(userId) {
        case .success(let stats): state = .loaded(stats)
        case .failure(let error): if state.value == nil { state = .failed(error.message) }
        }
    }

    private func delete(_ metric: Metric) async {
        switch await auth.stats.deleteMetric(metric.id) {
        case .success:
            actionError = nil
            await fetch()
        case .failure(let error):
            actionError = error.message
        }
    }

    // MARK: content

    @ViewBuilder private func content(_ stats: PlayerStats) -> some View {
        if stats.hasActivity {
            attendanceCard(stats)
            StatTiles([
                ("\(stats.activityStreak)", "Серия подряд"), ("\(stats.tasksCompleted)/\(stats.tasksTotal)", "Заданий выполнено"),
                (StatsFormat.duration(minutes: stats.trainingMinutes), "Тренировочное время"), ("\(stats.personalTrainingsCount)", "Личных тренировок"),
            ])
        } else {
            DashboardCard("Статистика появится позже") {
                Text("Она соберётся после первых тренировок, матчей или отчётов по заданиям. Показатели можно добавлять и сейчас — ниже.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            .accessibilityIdentifier("playerStats.empty")
        }
        if isOwn {
            AnalysisCard(
                title: "Рекомендации ИИ", hint: "ИИ проанализирует прогресс по тренировкам, заданиям и показателям.",
                button: "Получить рекомендации", identifier: "playerStats.ai"
            ) { await auth.stats.progressAnalysis() }
        }
        if !stats.personalRecords.isEmpty {
            DashboardCard("Личные рекорды") {
                ForEach(stats.personalRecords) { record in
                    StatRow(title: record.name, value: record.valueText).accessibilityIdentifier("playerStats.record")
                }
            }
        }
        if !stats.coachComments.isEmpty {
            DashboardCard("Комментарии тренера") {
                ForEach(stats.coachComments) { comment in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(comment.context).font(.footnote).foregroundStyle(.secondary)
                        Text(comment.comment)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("playerStats.comment")
                }
            }
        }
        metricsCard(stats)
        if !stats.playedMatches.isEmpty {
            DashboardCard("История матчей") {
                ForEach(stats.playedMatches) { match in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("против \(match.opponentName)").font(.headline)
                            Text([LocalDateFormat.shortDay(match.matchDate), match.teamName].compactMap { $0 }.joined(separator: " · "))
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            if let score = match.scoreText { Text(score).font(.title3.bold().monospacedDigit()) }
                            if let outcome = match.outcome { Text(outcome.title).font(.caption).foregroundStyle(color(of: outcome)) }
                        }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("playerStats.match")
                }
            }
        }
    }

    private func attendanceCard(_ stats: PlayerStats) -> some View {
        HStack(spacing: 20) {
            ZStack {
                Circle().stroke(Color(.systemGray5), lineWidth: 14)
                Circle().trim(from: 0, to: stats.attendanceRate ?? 0)
                    .stroke(Theme.primary, style: StrokeStyle(lineWidth: 14, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Text(StatsFormat.rate(stats.attendanceRate)).font(.title.bold())
            }
            .frame(width: 118, height: 118)
            VStack(alignment: .leading, spacing: 4) {
                Text("Посещаемость").font(.headline)
                Text(StatsFormat.attended(stats.trainingsAttended, of: stats.teamTrainingsCount)).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("playerStats.attendance")
    }

    private func metricsCard(_ stats: PlayerStats) -> some View {
        DashboardCard("Показатели", trailing: AnyView(Button("Добавить") { sheet = .add }.font(.subheadline).accessibilityIdentifier("playerStats.addMetric"))) {
            if let actionError { Text(actionError).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("playerStats.error") }
            if stats.metrics.isEmpty { Text("Пока нет записей.").foregroundStyle(.secondary) }
            ForEach(stats.metrics) { metric in
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(metric.name): \(metric.valueText)").font(.headline)
                        Text([LocalDateFormat.shortDay(metric.recordedDate), metric.source].compactMap { $0 }.joined(separator: " · "))
                            .font(.footnote).foregroundStyle(.secondary)
                        if let comment = metric.comment { Text(comment).font(.footnote) }
                    }
                    Spacer()
                    if let me, metric.canBeChanged(by: me) {
                        Menu {
                            Button("Изменить", systemImage: "pencil") { sheet = .edit(metric) }
                            Button("Удалить", systemImage: "trash", role: .destructive) { deleting = metric }
                        } label: {
                            Image(systemName: "ellipsis.circle").font(.title3).padding(4)
                        }
                        .accessibilityLabel("Действия с показателем")
                        .accessibilityIdentifier("playerStats.metricMenu")
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("playerStats.metric")
            }
        }
    }

    private func color(of outcome: MatchOutcome) -> Color {
        switch outcome {
        case .win: .green
        case .loss: .red
        case .draw: .secondary
        }
    }
}

/// Adding or changing one measured value.
struct MetricFormView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let userId: UUID
    let metric: Metric?
    let onDone: () -> Void

    @State private var name = ""
    @State private var value = ""
    @State private var unit = ""
    @State private var date = Date()
    @State private var higherIsBetter = true
    @State private var source = ""
    @State private var comment = ""
    @State private var saving = false
    @State private var error: String?
    @State private var filled = false

    private var number: Double? { LocalDateFormat.parseNumber(value) }

    private var input: MetricInput? {
        MetricInput(name: name, unit: unit, value: number, date: LocalDate(date: date), higherIsBetter: higherIsBetter, source: source, comment: comment)
    }

    /// Shown as soon as something is typed, not before.
    private var problem: String? {
        name.isEmpty && value.isEmpty ? nil : MetricInput.problem(name: name, unit: unit, value: number, source: source, comment: comment)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Название, например «Прыжок с места»", text: $name).accessibilityIdentifier("metricForm.name")
                    TextField("Значение", text: $value).keyboardType(.numbersAndPunctuation).accessibilityIdentifier("metricForm.value")
                    TextField("Единица (см, сек, шт)", text: $unit).accessibilityIdentifier("metricForm.unit")
                    DatePicker("Дата", selection: $date, in: ...Date(), displayedComponents: .date)
                    Toggle("Больше — лучше", isOn: $higherIsBetter)
                }
                Section {
                    TextField("Источник (необязательно)", text: $source).accessibilityIdentifier("metricForm.source")
                    TextField("Комментарий (необязательно)", text: $comment, axis: .vertical).lineLimit(2...5).accessibilityIdentifier("metricForm.comment")
                }
                if let message = error ?? problem {
                    Section { Text(message).foregroundStyle(.red).accessibilityIdentifier("metricForm.error") }
                }
            }
            .sagScreen()
            .navigationTitle(metric == nil ? "Новый показатель" : "Изменить показатель")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Сохранить") { Task { await save() } }
                        .disabled(input == nil || saving)
                        .accessibilityIdentifier("metricForm.save")
                }
            }
            .onAppear(perform: fill)
        }
    }

    private func fill() {
        guard !filled else { return }
        filled = true
        guard let metric else { return }
        name = metric.name
        value = LocalDateFormat.number(metric.value).replacingOccurrences(of: "\u{00A0}", with: "")
        unit = metric.unit ?? ""
        date = metric.recordedDate.startOfDay
        higherIsBetter = metric.higherIsBetter
        source = metric.source ?? ""
        comment = metric.comment ?? ""
    }

    private func save() async {
        guard let input else { return }
        saving = true
        defer { saving = false }
        let result: Result<Metric, APIError>
        if let metric {
            result = await auth.stats.updateMetric(metric.id, input)
        } else {
            result = await auth.stats.addMetric(input, for: userId)
        }
        switch result {
        case .success:
            onDone()
            dismiss()
        case .failure(let failure):
            error = failure.message
        }
    }
}
