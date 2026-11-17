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
    /// The booking behind this training when it is a session booked with a coach: date, time, length, place and description are read-only,
    /// only the reminder is the person's own.
    var bookedWith: Booking?
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
    @State private var planId: UUID?
    @State private var plans: [Plan] = []
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

    /// A training of the person's own has no team and cannot be made «самостоятельной».
    private var isPersonal: Bool { if case .edit(let training) = mode { training.type == "personal" } else { false } }

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
                if let booking = bookedWith {
                    Section {
                        Label("Занятие с тренером \(booking.coachFullName). Дату, время, длительность и место меняет запись, а не календарь. Здесь можно изменить только напоминание.", systemImage: "person.2.fill")
                            .font(.subheadline).foregroundStyle(.secondary)
                            .accessibilityIdentifier("trainingForm.booked")
                    }
                }
                Section {
                    Group {
                        DatePicker("Дата", selection: $date, displayedComponents: .date).accessibilityIdentifier("trainingForm.date")
                        DatePicker("Начало", selection: $time, displayedComponents: .hourAndMinute).accessibilityIdentifier("trainingForm.time")
                        Stepper("Длительность: \(duration) мин", value: $duration, in: 5...TrainingLimits.maxDurationMinutes, step: 5)
                            .accessibilityIdentifier("trainingForm.duration")
                        TextField("Место (необязательно)", text: $location).accessibilityIdentifier("trainingForm.location")
                    }
                    .disabled(bookedWith != nil)
                    Picker("Напоминание", selection: $reminder) {
                        ForEach(TrainingReminder.options, id: \.self) { Text(TrainingReminder.title($0)).tag($0) }
                    }
                }
                Section(sag: "Описание") {
                    TextField("Что будет на тренировке (необязательно)", text: $details, axis: .vertical).lineLimit(3...8)
                        .disabled(bookedWith != nil)
                }
                if !isPersonal { planSection }
                if isSchedule { repeatSection }
                if !isPersonal { independentSection }
                if let message = error ?? problem {
                    Section { Text(message).foregroundStyle(.red).accessibilityIdentifier("trainingForm.error") }
                }
            }
            .sagScreen()
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
            .task {
                await loadPlayers()
                await loadPlans()
            }
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

    /// The coach's own plans, always offered so the way to attach one is visible. A plan chosen by another coach stays as it is
    /// (the server checks who may attach what).
    @ViewBuilder private var planSection: some View {
        Section {
            if plans.isEmpty && planId == nil {
                Label("В вашей библиотеке пока нет планов. Создайте план во вкладке «Библиотека» → «Планы», и он появится здесь.",
                      systemImage: "book.closed")
                    .font(.subheadline).foregroundStyle(.secondary)
                    .accessibilityIdentifier("trainingForm.planEmpty")
            } else {
                Picker(selection: $planId) {
                    Text("Без плана").tag(UUID?.none)
                    ForEach(plans) { Text($0.name).tag(UUID?.some($0.id)) }
                    if let planId, !plans.contains(where: { $0.id == planId }) { Text("План другого тренера").tag(UUID?.some(planId)) }
                } label: {
                    Label("Взять план из библиотеки", systemImage: "book.fill")
                }
                .accessibilityIdentifier("trainingForm.plan")
            }
        } header: {
            SagSectionHeader(title: "План тренировки")
        } footer: {
            Text("Игроки увидят план в карточке тренировки.")
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
            planId = training.planId
        }
    }

    private func loadPlans() async {
        guard !isPersonal, case .success(let list) = await auth.library.plans() else { return }
        plans = list
    }

    /// The people who can be made responsible: the team's players (the coaching staff cannot).
    private func loadPlayers() async {
        guard let teamId, let members = try? await auth.teams.service.members(of: teamId) else { return }
        players = members.filter { !$0.role.isStaff }
    }

    private func save() async {
        guard let input else { return }
        saving = true
        defer { saving = false }
        switch mode {
        case .schedule:
            guard let teamId else { return }
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
