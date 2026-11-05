import SportArenaKit
import SwiftUI

/// The guided workout of a personal training: one exercise at a time, each set counted the way the exercise is measured
/// (repetitions with a weight, time, or distance), a rest between sets, and a summary that is saved with the training.
struct WorkoutView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State private var runner: WorkoutRunner
    @State private var leaving = false
    let notes: String?
    let onSaved: (TrainingWorkout) -> Void

    init(trainingId: UUID, planLines: [String], notes: String?, onSaved: @escaping (TrainingWorkout) -> Void) {
        _runner = State(initialValue: WorkoutRunner(trainingId: trainingId, planLines: planLines))
        self.notes = notes
        self.onSaved = onSaved
    }

    var body: some View {
        NavigationStack {
            Group {
                switch runner.phase {
                case .workout: workout
                case .summary: WorkoutSummaryView(runner: runner, onSaved: onSaved, close: { dismiss() })
                case .saved: saved
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { if runner.phase == .workout { workoutToolbar } }
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Готово") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
                        .accessibilityIdentifier("workout.keyboardDone")
                }
            }
        }
        .interactiveDismissDisabled()
        .sensoryFeedback(.success, trigger: runner.restsOver)
        .confirmationDialog("Выйти из тренировки?", isPresented: $leaving, titleVisibility: .visible) {
            Button("Выйти, прогресс сохранится") { dismiss() }.accessibilityIdentifier("workout.leave.keep")
            Button("Выйти и не сохранять", role: .destructive) {
                runner.discard()
                dismiss()
            }
            .accessibilityIdentifier("workout.leave.discard")
        } message: {
            Text("Заполненные подходы останутся на этом устройстве: тренировку можно продолжить позже.")
        }
    }

    // MARK: the workout

    private var session: WorkoutSession { runner.session }

    @ToolbarContentBuilder private var workoutToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button { leaving = true } label: { Image(systemName: "chevron.down") }
                .accessibilityLabel("Выйти")
                .accessibilityIdentifier("workout.close")
        }
        ToolbarItem(placement: .principal) {
            VStack(spacing: 0) {
                ElapsedClock(since: session.startedAt).font(.headline.monospacedDigit()).accessibilityIdentifier("workout.clock")
                Text("подходов \(session.totals.setsDone) из \(session.totals.setsTotal)").font(.caption).foregroundStyle(.secondary)
                    .accessibilityIdentifier("workout.progress")
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button("Завершить") { runner.finish() }
                .fontWeight(.semibold)
                .accessibilityIdentifier("workout.finish")
        }
    }

    private var workout: some View {
        VStack(spacing: 0) {
            ProgressView(value: Double(session.totals.setsDone), total: Double(max(session.totals.setsTotal, 1)))
                .tint(Theme.primary)
                .accessibilityHidden(true)
            chips
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Упражнение \(session.activeIndex + 1) из \(session.exercises.count)").font(.footnote).foregroundStyle(.secondary)
                    Text(session.active.name).font(.title2.bold()).accessibilityIdentifier("workout.exercise")
                    let plan = WorkoutFormat.plan(session.active)
                    if !plan.isEmpty { Text("План: \(plan)").foregroundStyle(.secondary).accessibilityIdentifier("workout.plan") }
                    sets
                    setActions
                    restSetting
                    if let notes, !notes.isEmpty { Text("Пометки: \(notes)").font(.footnote).foregroundStyle(.secondary) }
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            bottomBar
        }
        .background(Color(.systemGroupedBackground))
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(session.exercises.enumerated()), id: \.offset) { index, exercise in
                    Button { runner.go(to: index) } label: {
                        Group {
                            if exercise.isDone { Image(systemName: "checkmark") } else { Text("\(index + 1)") }
                        }
                        .font(.subheadline.weight(.semibold))
                        .frame(width: 36, height: 36)
                        .foregroundStyle(index == session.activeIndex ? Color.white : (exercise.isDone ? Color.green : Color.primary))
                        .background(index == session.activeIndex ? AnyShapeStyle(Theme.primary) : AnyShapeStyle(Color(.secondarySystemGroupedBackground)),
                                    in: Circle())
                    }
                    .accessibilityLabel("Упражнение \(index + 1): \(exercise.name)\(exercise.isDone ? ", выполнено" : "")")
                    .accessibilityAddTraits(index == session.activeIndex ? .isSelected : [])
                    .accessibilityIdentifier("workout.chip.\(index)")
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
        }
    }

    private var sets: some View {
        VStack(spacing: 8) {
            ForEach(Array(session.active.sets.enumerated()), id: \.offset) { index, set in
                SetRow(runner: runner, index: index, set: set, metric: session.active.metric)
            }
        }
    }

    private var setActions: some View {
        HStack {
            Button { runner.change { $0.addSet() } } label: { Label("Подход", systemImage: "plus") }
                .disabled(!session.active.canAddSet)
                .accessibilityIdentifier("workout.addSet")
            if session.active.canRemoveLastSet {
                Button("Убрать последний") { runner.change { $0.removeLastSet() } }.accessibilityIdentifier("workout.removeSet")
            }
            Spacer()
        }
        .buttonStyle(.bordered)
        .tint(Theme.primary)
    }

    private var restSetting: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Отдых между подходами").font(.footnote).foregroundStyle(.secondary)
            Picker("Отдых между подходами", selection: Binding(get: { session.restSeconds }, set: { value in runner.change { $0.restSeconds = value } })) {
                ForEach(WorkoutSession.restOptions, id: \.self) { Text($0 == 0 ? "Без" : WorkoutFormat.restTitle($0)).tag($0) }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("workout.rest")
        }
    }

    private var bottomBar: some View {
        VStack(spacing: 10) {
            if let end = runner.restEndsAt {
                HStack {
                    Text("Отдых").font(.subheadline)
                    CountdownClock(until: end).font(.title3.bold().monospacedDigit()).accessibilityIdentifier("workout.restTime")
                    Spacer()
                    Button("+15 с") { runner.extendRest() }.buttonStyle(.bordered).accessibilityIdentifier("workout.restMore")
                    Button("Пропустить") { runner.cancelRest() }.buttonStyle(.bordered).accessibilityIdentifier("workout.restSkip")
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("workout.restBar")
            }
            if session.isOnLastExercise {
                Button { runner.finish() } label: { Text("Завершить тренировку").frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent).tint(Theme.primary).controlSize(.large)
                    .accessibilityIdentifier("workout.finishLast")
            } else {
                Button { runner.goToNext() } label: { Label("Следующее упражнение", systemImage: "chevron.right").frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent).tint(session.active.isDone ? Theme.primary : .gray).controlSize(.large)
                    .accessibilityIdentifier("workout.next")
            }
        }
        .padding(16)
        .background(.bar)
    }

    private var saved: some View {
        ContentUnavailableView {
            Label("Тренировка записана", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
        } description: {
            let totals = session.totals
            let elapsed = Int((runner.finishedAt ?? Date()).timeIntervalSince(session.startedAt))
            Text("\(totals.setsDone) из \(totals.setsTotal) подходов за \(WorkoutFormat.clock(elapsed))")
        } actions: {
            Button("Готово") { dismiss() }.buttonStyle(.borderedProminent).tint(Theme.primary).accessibilityIdentifier("workout.done")
        }
    }
}

// MARK: - The summary

private struct WorkoutSummaryView: View {
    @Environment(AuthStore.self) private var auth
    let runner: WorkoutRunner
    let onSaved: (TrainingWorkout) -> Void
    let close: () -> Void
    @State private var confirmingDiscard = false

    private var session: WorkoutSession { runner.session }

    var body: some View {
        let totals = session.totals
        let elapsed = Int((runner.finishedAt ?? Date()).timeIntervalSince(session.startedAt))
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                StatTiles(tiles(totals, elapsed: elapsed))
                DashboardCard("Упражнения") {
                    ForEach(Array(session.exercises.enumerated()), id: \.offset) { _, exercise in
                        let done = WorkoutFormat.results(exercise)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(exercise.name).fontWeight(.semibold)
                            Text(done.isEmpty ? "не выполнено" : done).font(.subheadline).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("workout.recap")
                    }
                }
                if let error = runner.error { Text(error).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("workout.error") }
                Button {
                    Task { if let saved = await runner.save(using: auth.trainings) { onSaved(saved) } }
                } label: {
                    Group { if runner.saving { ProgressView() } else { Text("Сохранить результат") } }.frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).tint(Theme.primary).controlSize(.large)
                .disabled(runner.saving || !session.canBeSaved)
                .accessibilityIdentifier("workout.save")
                if !session.canBeSaved {
                    Text("Отметьте хотя бы один выполненный подход, чтобы сохранить результат.").font(.footnote).foregroundStyle(.secondary)
                }
                Button("Не сохранять", role: .destructive) { confirmingDiscard = true }
                    .frame(maxWidth: .infinity)
                    .accessibilityIdentifier("workout.discard")
            }
            .padding(16)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Итоги")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { runner.backToWorkout() } label: { Image(systemName: "chevron.left") }
                    .accessibilityLabel("Вернуться к тренировке")
                    .accessibilityIdentifier("workout.back")
            }
        }
        .confirmationDialog("Не сохранять результат?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
            Button("Не сохранять", role: .destructive) {
                runner.discard()
                close()
            }
            .accessibilityIdentifier("workout.discard.confirm")
        } message: {
            Text("Заполненные подходы будут удалены.")
        }
    }

    private func tiles(_ totals: WorkoutTotals, elapsed: Int) -> [(String, String)] {
        var tiles = [(WorkoutFormat.clock(elapsed), "время"), ("\(totals.setsDone)/\(totals.setsTotal)", "подходов")]
        if totals.reps > 0 { tiles.append(("\(totals.reps)", "повторений")) }
        if totals.volumeKg > 0 { tiles.append((WorkoutFormat.kilograms(totals.volumeKg), "тоннаж")) }
        if totals.seconds > 0 { tiles.append((WorkoutFormat.clock(totals.seconds), "под нагрузкой")) }
        if totals.meters > 0 { tiles.append((WorkoutFormat.meters(totals.meters), "дистанция")) }
        return tiles
    }
}
