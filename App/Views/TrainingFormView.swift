import SportArenaKit
import SwiftUI

/// Scheduling a team training, or changing one.
struct TrainingFormView: View {
    enum Mode {
        case schedule(Team)
        case edit(Training)
    }

    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let mode: Mode
    let onDone: () -> Void

    @State private var date = Date()
    @State private var time = LocalTime(hour: 18, minute: 0)!.onToday
    @State private var duration = 60
    @State private var location = ""
    @State private var details = ""
    @State private var reminder: Int?
    @State private var repeats = false
    @State private var until = Calendar.current.date(byAdding: .day, value: 28, to: Date()) ?? Date()
    @State private var independent = false
    @State private var responsible: UUID?
    @State private var players: [TeamMember] = []
    @State private var saving = false
    @State private var error: String?
    @State private var filled = false

    private var teamId: UUID? {
        switch mode {
        case .schedule(let team): team.id
        case .edit(let training): training.teamId
        }
    }

    private var isSchedule: Bool { if case .schedule = mode { true } else { false } }

    private var planId: UUID? { if case .edit(let training) = mode { training.planId } else { nil } }

    private var input: TrainingInput? {
        TrainingInput(
            date: LocalDate(date: date), time: LocalTime(from: time), durationMinutes: duration, location: location, description: details,
            reminderMinutesBefore: reminder, repeatWeeklyUntil: isSchedule && repeats ? LocalDate(date: until) : nil,
            isIndependent: independent, responsibleUserId: responsible, planId: planId
        )
    }

    private var problem: String? {
        TrainingInput.problem(
            date: LocalDate(date: date), durationMinutes: duration, location: location, description: details, reminder: reminder,
            repeatUntil: isSchedule && repeats ? LocalDate(date: until) : nil
        )
    }

    var body: some View {
        NavigationStack {
            Form {
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
                Section("Описание") {
                    TextField("Что будет на тренировке (необязательно)", text: $details, axis: .vertical).lineLimit(3...8)
                }
                if isSchedule { repeatSection }
                independentSection
                if let message = error ?? problem {
                    Section { Text(message).foregroundStyle(.red).accessibilityIdentifier("trainingForm.error") }
                }
            }
            .navigationTitle(isSchedule ? "Новая тренировка" : "Изменить тренировку")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSchedule ? "Назначить" : "Сохранить") { Task { await save() } }
                        .disabled(input == nil || saving)
                        .accessibilityIdentifier("trainingForm.save")
                }
            }
            .onAppear(perform: fill)
            .task { await loadPlayers() }
        }
    }

    private var repeatSection: some View {
        Section {
            Toggle("Повторять каждую неделю", isOn: $repeats).accessibilityIdentifier("trainingForm.repeat")
            if repeats {
                DatePicker("Повторять до", selection: $until, in: date..., displayedComponents: .date)
                if let count = input?.seriesCount, count > 1 {
                    Text("Будет назначено тренировок: \(count)").font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
    }

    private var independentSection: some View {
        Section {
            Toggle("Самостоятельная тренировка", isOn: $independent)
            if independent {
                Picker("Ответственный", selection: $responsible) {
                    Text("Капитан команды").tag(UUID?.none)
                    ForEach(players) { Text($0.fullName).tag(UUID?.some($0.userId)) }
                }
            }
        } footer: {
            Text("Команда проводит её без тренера; за тренировку отвечает один игрок.")
        }
    }

    private func fill() {
        guard !filled else { return }
        filled = true
        if case .edit(let training) = mode {
            date = training.trainingDate.startOfDay
            time = training.startTime.onToday
            duration = training.durationMinutes
            location = training.location ?? ""
            details = training.description ?? ""
            reminder = training.reminderMinutesBefore
            independent = training.type == "independent"
            responsible = training.responsibleUserId
        }
    }

    /// The people who can be made responsible: the team's players (the coaching staff cannot).
    private func loadPlayers() async {
        guard let teamId, let members = try? await auth.teams.service.members(of: teamId) else { return }
        players = members.filter { !$0.role.isStaff }
    }

    private func save() async {
        guard let input, let teamId else { return }
        saving = true
        defer { saving = false }
        switch mode {
        case .schedule:
            switch await auth.trainings.schedule(input, for: teamId) {
            case .success:
                onDone()
                dismiss()
            case .failure(let failure):
                error = failure.message
            }
        case .edit(let training):
            switch await auth.trainings.update(training.id, input, status: training.trainingStatus ?? .scheduled) {
            case .success:
                onDone()
                dismiss()
            case .failure(let failure):
                error = failure.message
            }
        }
    }
}
