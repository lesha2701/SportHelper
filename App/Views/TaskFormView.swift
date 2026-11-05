import SportArenaKit
import SwiftUI

/// Giving a task to the team, changing one, or keeping a task as a template (the same form, without the deadline and the people).
struct TaskFormView: View {
    enum Mode {
        case give(Team)
        case edit(TeamTask)
        case newTemplate
        case editTemplate(TaskTemplate)
    }

    private enum AudienceKind: Hashable { case team, players, position, absentees }

    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let mode: Mode
    let onDone: () -> Void

    @State private var title = ""
    @State private var details = ""
    @State private var hasDeadline = false
    @State private var deadline = Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date()
    @State private var metricName = ""
    @State private var metricUnit = ""
    @State private var metricTarget = ""
    @State private var requirements = TaskRequirements()
    @State private var audienceKind = AudienceKind.team
    @State private var chosenPlayers: Set<UUID> = []
    @State private var position = ""
    @State private var missedTraining: UUID?
    /// The held trainings of the team, the latest first (a task for those who missed one is given for one of them).
    @State private var heldTrainings: [Training] = []
    @State private var players: [TeamMember] = []
    @State private var planId: UUID?
    @State private var exerciseIds: [UUID] = []
    @State private var plans: [Plan] = []
    @State private var exercises: [Exercise] = []
    @State private var templates: [TaskTemplate] = []
    @State private var saving = false
    @State private var error: String?
    @State private var filled = false

    private var isGive: Bool { if case .give = mode { true } else { false } }
    private var isTemplate: Bool {
        switch mode {
        case .newTemplate, .editTemplate: true
        default: false
        }
    }

    private var isNew: Bool {
        switch mode {
        case .give, .newTemplate: true
        default: false
        }
    }

    private var teamId: UUID? {
        switch mode {
        case .give(let team): team.id
        case .edit(let task): task.teamId
        default: nil
        }
    }

    /// Positions the players have, for "everyone playing at…".
    private var positions: [String] { Array(Set(players.compactMap(\.position).filter { !$0.isEmpty })).sorted() }

    private var audience: TaskAudience {
        switch audienceKind {
        case .team: .team
        case .players: .players(players.map(\.userId).filter(chosenPlayers.contains))
        case .position: .position(position)
        case .absentees: .absentees(training: missedTraining)
        }
    }

    private var targetValue: Double? { LocalDateFormat.parseNumber(metricTarget) }
    private var targetIsGarbage: Bool { !metricTarget.trimmingCharacters(in: .whitespaces).isEmpty && targetValue == nil }

    private var input: TaskInput? {
        guard !targetIsGarbage else { return nil }
        return TaskInput(
            title: title, description: details, deadline: hasDeadline && !isTemplate ? deadline : nil, metricName: metricName, metricUnit: metricUnit,
            metricTarget: targetValue, requirements: requirements, audience: isGive ? audience : .team, planId: planId, exerciseIds: exerciseIds
        )
    }

    private var problem: String? {
        if title.isEmpty { return nil }
        if targetIsGarbage { return "Цель показателя — число." }
        return TaskInput.problem(
            title: title, description: details, metricName: metricName, metricUnit: metricUnit, metricTarget: targetValue,
            requirements: requirements, audience: isGive ? audience : .team
        )
    }

    private var heading: String {
        switch mode {
        case .give: "Новое задание"
        case .edit: "Изменить задание"
        case .newTemplate: "Новый шаблон"
        case .editTemplate: "Изменить шаблон"
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                if isGive && !templates.isEmpty { templateSection }
                Section {
                    TextField("Название", text: $title).accessibilityIdentifier("taskForm.title")
                    TextField("Что нужно сделать (необязательно)", text: $details, axis: .vertical).lineLimit(3...8)
                        .accessibilityIdentifier("taskForm.details")
                }
                if !isTemplate {
                    Section {
                        Toggle("Срок выполнения", isOn: $hasDeadline).accessibilityIdentifier("taskForm.hasDeadline")
                        if hasDeadline { DatePicker("До", selection: $deadline) }
                    }
                }
                metricSection
                requirementsSection
                librarySection
                if isGive { audienceSection } else if !isNew && !isTemplate {
                    Section { Text("Кому дано задание, изменить нельзя.").font(.footnote).foregroundStyle(.secondary) }
                }
                if let message = error ?? problem {
                    Section { Text(message).foregroundStyle(.red).accessibilityIdentifier("taskForm.error") }
                }
            }
            .navigationTitle(heading)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isNew ? (isGive ? "Дать" : "Сохранить") : "Сохранить") { Task { await save() } }
                        .disabled(input == nil || saving)
                        .accessibilityIdentifier("taskForm.save")
                }
            }
            .onAppear(perform: fill)
            .task { await loadAll() }
        }
    }

    // MARK: sections

    private var templateSection: some View {
        Section {
            Picker("Взять из шаблона", selection: Binding<UUID?>(get: { nil }, set: { id in templates.first { $0.id == id }.map(apply) })) {
                Text("Выберите шаблон").tag(UUID?.none)
                ForEach(templates) { Text($0.title).tag(UUID?.some($0.id)) }
            }
            .accessibilityIdentifier("taskForm.template")
        } footer: {
            Text("Поля ниже заполнятся из шаблона, их можно поменять.")
        }
    }

    private var metricSection: some View {
        Section {
            TextField("Показатель, например «Вес» (необязательно)", text: $metricName).accessibilityIdentifier("taskForm.metric")
            if !metricName.trimmingCharacters(in: .whitespaces).isEmpty {
                TextField("Единица, например «кг»", text: $metricUnit)
                TextField("Цель (число)", text: $metricTarget).keyboardType(.decimalPad)
            }
        } footer: {
            Text("Игроки будут вписывать результат по этому показателю.")
        }
    }

    private var requirementsSection: some View {
        Section {
            ForEach(TaskRequirement.allCases) { requirement in
                Toggle(requirement.title, isOn: Binding(get: { requirements[requirement] }, set: { requirements[requirement] = $0 }))
                    .accessibilityIdentifier("taskForm.need.\(requirement.rawValue)")
            }
        } header: {
            Text("Что игрок должен сдать")
        }
    }

    @ViewBuilder private var librarySection: some View {
        if !plans.isEmpty || !exercises.isEmpty || planId != nil || !exerciseIds.isEmpty {
            Section("Из библиотеки") {
                if !plans.isEmpty || planId != nil {
                    Picker("План тренировки", selection: $planId) {
                        Text("Без плана").tag(UUID?.none)
                        ForEach(plans) { Text($0.name).tag(UUID?.some($0.id)) }
                        if let planId, !plans.contains(where: { $0.id == planId }) { Text("План другого тренера").tag(UUID?.some(planId)) }
                    }
                    .accessibilityIdentifier("taskForm.plan")
                }
                NavigationLink {
                    ExercisePickerView(exercises: exercises, selection: $exerciseIds)
                } label: {
                    LabeledContent("Упражнения", value: exerciseIds.isEmpty ? "Не выбраны" : "\(exerciseIds.count)")
                }
                .accessibilityIdentifier("taskForm.exercises")
            }
        }
    }

    private var audienceSection: some View {
        Section("Кому") {
            Picker("Кому", selection: $audienceKind) {
                Text("Вся команда").tag(AudienceKind.team)
                Text("Игроки").tag(AudienceKind.players)
                Text("Позиция").tag(AudienceKind.position)
                Text("Не были").tag(AudienceKind.absentees)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("taskForm.audience")
            switch audienceKind {
            case .team:
                Text("Задание получат все игроки и капитан.").font(.footnote).foregroundStyle(.secondary)
            case .players:
                if players.isEmpty { Text("В команде пока нет игроков.").foregroundStyle(.secondary) }
                ForEach(players) { player in
                    Button {
                        if chosenPlayers.contains(player.userId) { chosenPlayers.remove(player.userId) } else { chosenPlayers.insert(player.userId) }
                    } label: {
                        HStack {
                            Text(player.fullName).foregroundStyle(.primary)
                            Spacer()
                            if chosenPlayers.contains(player.userId) { Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.primary) }
                        }
                    }
                    .accessibilityIdentifier("taskForm.player")
                    .accessibilityValue(chosenPlayers.contains(player.userId) ? "Выбран" : "Не выбран")
                }
            case .position:
                if positions.isEmpty {
                    Text("У игроков не указаны позиции.").font(.footnote).foregroundStyle(.secondary)
                } else {
                    Picker("Позиция", selection: $position) {
                        Text("Выберите").tag("")
                        ForEach(positions, id: \.self) { Text($0).tag($0) }
                    }
                }
            case .absentees:
                absenteesPicker
            }
        }
    }

    /// «5 ноября 2026 г., 18:00 · Корт»: the place tells apart the trainings of one day.
    private static func heldTitle(_ training: Training) -> String {
        let when = "\(LocalDateFormat.full(training.trainingDate)), \(training.startTime.display)"
        guard let place = training.location, !place.isEmpty else { return when }
        return "\(when) · \(place)"
    }

    @ViewBuilder private var absenteesPicker: some View {
        if heldTrainings.isEmpty {
            Text("Нет проведённых тренировок. Отметьте тренировку проведённой и укажите, кого на ней не было.")
                .font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("taskForm.noTrainings")
        } else {
            Picker("Тренировка", selection: $missedTraining) {
                Text("Выберите").tag(UUID?.none)
                ForEach(heldTrainings) { training in
                    Text(Self.heldTitle(training)).tag(UUID?.some(training.id))
                }
            }
            .accessibilityIdentifier("taskForm.training")
            Text("Задание получат те, кого на этой тренировке отметили не пришедшими. Отметить можно в карточке тренировки.")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    // MARK: data

    private func fill() {
        guard !filled else { return }
        filled = true
        switch mode {
        case .edit(let task):
            if let value = task.asInput { apply(value) }
            if let date = task.deadline {
                hasDeadline = true
                deadline = date
            }
        case .editTemplate(let template):
            if let value = template.asTaskInput { apply(value) }
        default: break
        }
    }

    private func apply(_ template: TaskTemplate) {
        if let value = template.asTaskInput { apply(value) }
    }

    private func apply(_ value: TaskInput) {
        title = value.title
        details = value.description ?? ""
        metricName = value.metricName ?? ""
        metricUnit = value.metricUnit ?? ""
        metricTarget = value.metricTarget.map(LocalDateFormat.number) ?? ""
        requirements = value.requirements
        planId = value.planId
        exerciseIds = value.exerciseIds
    }

    /// The players (only they and the captain get tasks) and the coach's own library.
    private func loadAll() async {
        if let teamId, let members = try? await auth.teams.service.members(of: teamId) {
            players = members.filter { !$0.role.isStaff }.sorted { $0.fullName < $1.fullName }
        }
        if case .success(let list) = await auth.library.plans() { plans = list }
        if case .success(let list) = await auth.library.exercises() { exercises = list }
        if isGive, case .success(let list) = await auth.library.templates() { templates = list }
        if isGive, let teamId, case .success(let list) = await auth.trainings.teamTrainings(teamId) {
            heldTrainings = Array(list.filter { $0.hasAttendance && $0.status == "completed" }
                .sorted { ($0.trainingDate, $0.startTime) > ($1.trainingDate, $1.startTime) }.prefix(30))
        }
    }

    private func save() async {
        guard let input else { return }
        saving = true
        defer { saving = false }
        let failure: APIError?
        switch mode {
        case .give(let team): failure = await auth.tasks.create(input, for: team.id).failure
        case .edit(let task): failure = await auth.tasks.update(task.id, input).failure
        case .newTemplate: failure = await auth.library.createTemplate(input).failure
        case .editTemplate(let template): failure = await auth.library.updateTemplate(template.id, input).failure
        }
        if let failure {
            error = failure.code == "no_recipients" && audienceKind == .absentees
                ? "На этой тренировке никто не отмечен как не пришедший: сначала отметьте, кого не было." : failure.message
        } else {
            onDone()
            dismiss()
        }
    }
}

extension Result {
    var failure: Failure? { if case .failure(let error) = self { error } else { nil } }
}

/// Choosing the exercises of a task from the coach's library.
struct ExercisePickerView: View {
    let exercises: [Exercise]
    @Binding var selection: [UUID]

    var body: some View {
        List {
            if exercises.isEmpty { Text("В вашей библиотеке пока нет упражнений.").foregroundStyle(.secondary) }
            ForEach(exercises) { exercise in
                Button {
                    if let index = selection.firstIndex(of: exercise.id) {
                        selection.remove(at: index)
                    } else if selection.count < LibraryLimits.maxTemplateExercises {
                        selection.append(exercise.id)
                    }
                } label: {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(exercise.name).foregroundStyle(.primary)
                            Text(exercise.sport).font(.footnote).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if selection.contains(exercise.id) { Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.primary) }
                    }
                }
                .accessibilityIdentifier("picker.exercise")
                .accessibilityValue(selection.contains(exercise.id) ? "Выбрано" : "Не выбрано")
            }
            Section { Text("Не больше \(LibraryLimits.maxTemplateExercises) упражнений.").font(.footnote).foregroundStyle(.secondary) }
        }
        .navigationTitle("Упражнения")
        .navigationBarTitleDisplayMode(.inline)
    }
}
