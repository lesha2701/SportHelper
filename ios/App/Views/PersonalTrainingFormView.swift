import SportArenaKit
import SwiftUI

/// A training of the person's own: when, how long, and what to do (exercises with their plan, or a circuit), optionally repeating
/// every week. The exercises are written into the description the way the site writes them. The assistant can suggest them.
struct PersonalTrainingFormView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let onDone: () -> Void

    @State private var date = Date()
    @State private var time = LocalTime(hour: 18, minute: 0)!.onToday
    @State private var duration = 60
    @State private var location = ""
    @State private var reminder: Int? = 60
    @State private var workout = PersonalWorkout()
    @State private var repeats = false
    @State private var until = Calendar.current.date(byAdding: .day, value: 28, to: Date()) ?? Date()

    @State private var askingAssistant = false
    @State private var assistantStyle = WorkoutStyle.reps
    @State private var wish = ""
    @State private var assistantBusy = false
    @State private var assistantError: String?

    @State private var saving = false
    @State private var error: String?

    private var input: TrainingInput? {
        TrainingInput(
            date: LocalDate(date: date), time: LocalTime(from: time), durationMinutes: duration, location: location, description: workout.text,
            reminderMinutesBefore: reminder, repeatWeeklyUntil: repeats ? LocalDate(date: until) : nil
        )
    }

    private var problem: String? {
        workout.problem ?? TrainingInput.problem(
            date: LocalDate(date: date), durationMinutes: duration, location: location, description: workout.text, reminder: reminder,
            repeatUntil: repeats ? LocalDate(date: until) : nil
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                assistantSection
                Section {
                    DatePicker("Дата", selection: $date, displayedComponents: .date).accessibilityIdentifier("trainingForm.date")
                    DatePicker("Начало", selection: $time, displayedComponents: .hourAndMinute).accessibilityIdentifier("trainingForm.time")
                    Stepper("Длительность: \(duration) мин", value: $duration, in: 5...TrainingLimits.maxDurationMinutes, step: 5)
                        .accessibilityIdentifier("trainingForm.duration")
                    TextField("Место (необязательно)", text: $location).accessibilityIdentifier("trainingForm.location")
                    Picker("Напоминание", selection: $reminder) {
                        ForEach(TrainingReminder.options, id: \.self) { Text(TrainingReminder.title($0)).tag($0) }
                    }
                }
                exercisesSection
                Section(sag: "Пометки") {
                    TextField("Что важно помнить (необязательно)", text: $workout.notes, axis: .vertical).lineLimit(2...6)
                        .accessibilityIdentifier("personal.notes")
                }
                repeatSection
                if let message = error ?? problem {
                    Section { Text(message).foregroundStyle(.red).accessibilityIdentifier("trainingForm.error") }
                }
            }
            .sagScreen()
            .navigationTitle("Моя тренировка")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItemGroup(placement: .keyboard) {
                    // A number pad has no return key.
                    Spacer()
                    Button("Готово") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
                        .accessibilityIdentifier("keyboard.done")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Создать") { Task { await save() } }
                        .disabled(input == nil || problem != nil || saving)
                        .accessibilityIdentifier("personal.save")
                }
            }
        }
    }

    // MARK: assistant

    @ViewBuilder private var assistantSection: some View {
        Section {
            if askingAssistant {
                Picker("Стиль", selection: $assistantStyle) {
                    ForEach(WorkoutStyle.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                TextField("Пожелание, например «поработать над скоростью»", text: $wish, axis: .vertical).lineLimit(1...4)
                    .accessibilityIdentifier("personal.wish")
                if let assistantError { Text(assistantError).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("personal.aiError") }
                Button {
                    Task { await askAssistant() }
                } label: {
                    if assistantBusy { HStack { ProgressView(); Text("Формирую…") } } else { Text("Предложить тренировку") }
                }
                .disabled(assistantBusy)
                .accessibilityIdentifier("personal.aiRun")
                Button("Не нужно", role: .cancel) { askingAssistant = false }.disabled(assistantBusy)
            } else {
                Button {
                    assistantStyle = workout.style
                    askingAssistant = true
                } label: {
                    Label("Предложить тренировку с ИИ", systemImage: "sparkles")
                }
                .accessibilityIdentifier("personal.aiOpen")
            }
        } footer: {
            if askingAssistant { Text("ИИ учтёт ваш профиль (вид спорта, возраст, уровень, цели); упражнения можно изменить перед сохранением.") }
        }
    }

    private func askAssistant() async {
        assistantBusy = true
        assistantError = nil
        defer { assistantBusy = false }
        switch await auth.trainings.personalDraft(style: assistantStyle, goals: wish, durationMinutes: duration) {
        case .success(let draft):
            workout = draft.workout
            if let minutes = draft.durationMinutes { duration = min(max(minutes, 5), TrainingLimits.maxDurationMinutes) }
            askingAssistant = false
        case .failure(let failure):
            assistantError = failure.message
        }
    }

    // MARK: exercises

    private var exercisesSection: some View {
        Section(sag: "Упражнения") {
            Picker("Тип тренировки", selection: $workout.style) {
                ForEach(WorkoutStyle.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("personal.style")
            ForEach($workout.rows) { $row in
                WorkoutRowEditor(
                    row: $row, style: workout.style, index: workout.rows.firstIndex { $0.id == row.id } ?? 0, canRemove: workout.rows.count > 1,
                    unnamed: workout.unnamedRowIDs.contains(row.id), onRemove: { workout.removeRow(row.id) }
                )
            }
            Button {
                workout.addRow()
            } label: {
                Label("Добавить упражнение", systemImage: "plus.circle")
            }
            .accessibilityIdentifier("personal.addRow")
            if workout.style == .circuit {
                Stepper("Кругов: \(workout.circuitRounds)", value: $workout.circuitRounds, in: PersonalWorkout.roundsRange)
                    .accessibilityIdentifier("personal.rounds")
                Stepper("Отдых между подходами и кругами: \(workout.circuitRestSeconds) сек", value: $workout.circuitRestSeconds, in: PersonalWorkout.restRange, step: 5)
                    .accessibilityIdentifier("personal.rest")
            }
        }
    }

    private var repeatSection: some View {
        Section {
            Toggle("Повторять каждую неделю", isOn: $repeats).accessibilityIdentifier("trainingForm.repeat")
            if repeats {
                DatePicker("Повторять до", selection: $until, in: date..., displayedComponents: .date)
                if let count = input?.seriesCount, count > 1 {
                    Text("Будет создано тренировок: \(count)").font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: save

    private func save() async {
        guard let input else { return }
        saving = true
        defer { saving = false }
        switch await auth.trainings.schedulePersonal(input) {
        case .success:
            onDone()
            dismiss()
        case .failure(let failure):
            error = failure.message
        }
    }
}

/// One exercise: its name, what it is measured in, and the plan for it.
private struct WorkoutRowEditor: View {
    @Binding var row: WorkoutRow
    let style: WorkoutStyle
    let index: Int
    let canRemove: Bool
    /// The line has no name: its message sits under the field.
    let unnamed: Bool
    let onRemove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                TextField("Упражнение \(index + 1)", text: Binding(get: { row.exercise }, set: { row.rename($0) }))
                    .accessibilityIdentifier("personal.exercise")
                if canRemove {
                    Button(role: .destructive, action: onRemove) { Image(systemName: "minus.circle.fill") }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Удалить упражнение")
                        .accessibilityIdentifier("personal.removeRow")
                }
            }
            if unnamed {
                Text("Укажите название упражнения.").font(.footnote).foregroundStyle(.red).accessibilityIdentifier("personal.exerciseError")
            }
            if style == .reps {
                Picker("Чем измеряется", selection: Binding(get: { row.kind }, set: { row.choose($0) })) {
                    ForEach(WorkoutKind.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                switch row.kind {
                case .reps:
                    OptionalIntField(title: "Повторений за подход", value: $row.reps, identifier: "personal.reps")
                case .time:
                    OptionalIntField(title: "Секунд за подход", value: $row.durationSeconds, identifier: "personal.seconds")
                case .distance:
                    OptionalIntField(title: "Расстояние, м", value: $row.distanceMeters, identifier: "personal.meters")
                    MinutesField(title: "Время, мин (по желанию)", value: $row.timeMinutes)
                }
                OptionalIntField(title: row.kind == .distance ? "Подходов (по желанию)" : "Подходов", value: $row.sets, identifier: "personal.sets")
            } else {
                OptionalIntField(title: "Секунд на упражнение", value: $row.durationSeconds, identifier: "personal.seconds")
            }
        }
        .padding(.vertical, 4)
    }
}

/// Minutes with a decimal part ("7,5"), or empty.
private struct MinutesField: View {
    let title: String
    @Binding var value: Double?
    @State private var text = ""

    var body: some View {
        TextField(title, text: $text)
            .keyboardType(.numbersAndPunctuation)
            .accessibilityIdentifier("personal.minutes")
            .onAppear { text = value.map(LocalDateFormat.number) ?? "" }
            .onChange(of: text) { _, new in value = LocalDateFormat.parseNumber(new) }
    }
}
