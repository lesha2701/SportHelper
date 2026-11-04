import PhotosUI
import SportArenaKit
import SwiftUI

/// Giving a task to the team, or changing one.
struct TaskFormView: View {
    enum Mode {
        case give(Team)
        case edit(TeamTask)
    }

    private enum AudienceKind: Hashable { case team, players, position }

    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let mode: Mode
    let onDone: (TeamTask) -> Void

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
    @State private var players: [TeamMember] = []
    @State private var saving = false
    @State private var error: String?
    @State private var filled = false

    private var isGive: Bool { if case .give = mode { true } else { false } }

    private var teamId: UUID {
        switch mode {
        case .give(let team): team.id
        case .edit(let task): task.teamId
        }
    }

    /// Positions the players have, for "everyone playing at…".
    private var positions: [String] {
        Array(Set(players.compactMap(\.position).filter { !$0.isEmpty })).sorted()
    }

    private var audience: TaskAudience {
        switch audienceKind {
        case .team: .team
        case .players: .players(players.map(\.userId).filter(chosenPlayers.contains))
        case .position: .position(position)
        }
    }

    private var targetValue: Double? { LocalDateFormat.parseNumber(metricTarget) }

    private var targetIsGarbage: Bool { !metricTarget.trimmingCharacters(in: .whitespaces).isEmpty && targetValue == nil }

    private var input: TaskInput? {
        guard !targetIsGarbage, case .edit(let task) = mode else { return makeInput(plan: nil, exercises: []) }
        return makeInput(plan: task.planId, exercises: task.exercises.sorted { $0.orderIndex < $1.orderIndex }.map(\.exerciseId))
    }

    private func makeInput(plan: UUID?, exercises: [UUID]) -> TaskInput? {
        guard !targetIsGarbage else { return nil }
        return TaskInput(
            title: title, description: details, deadline: hasDeadline ? deadline : nil, metricName: metricName, metricUnit: metricUnit,
            metricTarget: targetValue, requirements: requirements, audience: isGive ? audience : .team, planId: plan, exerciseIds: exercises
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

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Название", text: $title).accessibilityIdentifier("taskForm.title")
                    TextField("Что нужно сделать (необязательно)", text: $details, axis: .vertical).lineLimit(3...8)
                        .accessibilityIdentifier("taskForm.details")
                }
                Section {
                    Toggle("Срок выполнения", isOn: $hasDeadline).accessibilityIdentifier("taskForm.hasDeadline")
                    if hasDeadline { DatePicker("До", selection: $deadline) }
                }
                Section {
                    TextField("Показатель, например «Вес» (необязательно)", text: $metricName).accessibilityIdentifier("taskForm.metric")
                    if !metricName.trimmingCharacters(in: .whitespaces).isEmpty {
                        TextField("Единица, например «кг»", text: $metricUnit)
                        TextField("Цель (число)", text: $metricTarget).keyboardType(.decimalPad)
                    }
                } footer: {
                    Text("Игроки будут вписывать результат по этому показателю.")
                }
                requirementsSection
                if isGive { audienceSection } else {
                    Section { Text("Кому дано задание, изменить нельзя.").font(.footnote).foregroundStyle(.secondary) }
                }
                if let message = error ?? problem {
                    Section { Text(message).foregroundStyle(.red).accessibilityIdentifier("taskForm.error") }
                }
            }
            .navigationTitle(isGive ? "Новое задание" : "Изменить задание")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isGive ? "Дать" : "Сохранить") { Task { await save() } }
                        .disabled(input == nil || saving)
                        .accessibilityIdentifier("taskForm.save")
                }
            }
            .onAppear(perform: fill)
            .task { await loadPlayers() }
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
        } footer: {
            Text("Видео пока можно приложить только на сайте: в приложении такое задание не сдать.")
        }
    }

    private var audienceSection: some View {
        Section("Кому") {
            Picker("Кому", selection: $audienceKind) {
                Text("Вся команда").tag(AudienceKind.team)
                Text("Игроки").tag(AudienceKind.players)
                Text("Позиция").tag(AudienceKind.position)
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
            }
        }
    }

    private func fill() {
        guard !filled else { return }
        filled = true
        if case .edit(let task) = mode {
            title = task.title
            details = task.description ?? ""
            if let date = task.deadline {
                hasDeadline = true
                deadline = date
            }
            metricName = task.metricName ?? ""
            metricUnit = task.metricUnit ?? ""
            metricTarget = task.metricTarget.map(LocalDateFormat.number) ?? ""
            for requirement in task.requirements { requirements[requirement] = true }
        }
    }

    /// Only players and the captain get tasks.
    private func loadPlayers() async {
        guard let members = try? await auth.teams.service.members(of: teamId) else { return }
        players = members.filter { !$0.role.isStaff }.sorted { $0.fullName < $1.fullName }
    }

    private func save() async {
        guard let input else { return }
        saving = true
        defer { saving = false }
        let result: Result<TeamTask, APIError>
        switch mode {
        case .give(let team): result = await auth.tasks.create(input, for: team.id)
        case .edit(let task): result = await auth.tasks.update(task.id, input)
        }
        switch result {
        case .success(let task):
            onDone(task)
            dismiss()
        case .failure(let failure):
            error = failure.message
        }
    }
}

/// A player hands a task in: the numbers and words it asks for, and a photo if it wants one.
struct TaskSubmitView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let task: TeamTask
    let assignment: TaskAssignment?
    let onDone: () -> Void

    @State private var comment = ""
    @State private var sets = ""
    @State private var reps = ""
    @State private var duration = ""
    @State private var metric = ""
    @State private var difficulty = 0
    @State private var wellbeing = 0
    @State private var photoItem: PhotosPickerItem?
    @State private var photo: Data?
    @State private var sending = false
    @State private var error: String?
    @State private var filled = false

    private func whole(_ text: String) -> Int? { Int(text.trimmingCharacters(in: .whitespaces)) }

    /// A field that holds something but not a number is a mistake, not "empty".
    private var garbage: Bool {
        func bad(_ text: String, _ parse: (String) -> Any?) -> Bool { !text.trimmingCharacters(in: .whitespaces).isEmpty && parse(text) == nil }
        return bad(sets, whole) || bad(reps, whole) || bad(duration, whole) || bad(metric, LocalDateFormat.parseNumber)
    }

    private var submission: TaskSubmission? {
        guard !garbage else { return nil }
        return TaskSubmission(
            comment: comment, sets: whole(sets), reps: whole(reps), durationMinutes: whole(duration), metricValue: LocalDateFormat.parseNumber(metric),
            difficulty: difficulty == 0 ? nil : difficulty, wellbeing: wellbeing == 0 ? nil : wellbeing
        )
    }

    private var hasPhoto: Bool { photo != nil || assignment?.photoFileId != nil }

    /// What the task still asks for, in words.
    private var missing: [String] {
        guard let submission else { return [] }
        var items = submission.missing(for: task, assignment: assignment).map(\.title)
        if hasPhoto { items.removeAll { $0 == TaskRequirement.photo.title } }
        return items
    }

    private var videoBlocks: Bool { task.requireVideo && assignment?.videoFileId == nil }

    var body: some View {
        NavigationStack {
            Form {
                Section("Комментарий\(task.requireComment ? "" : " (необязательно)")") {
                    TextField("Как прошло", text: $comment, axis: .vertical).lineLimit(3...8).accessibilityIdentifier("submit.comment")
                }
                if task.requireSetsReps {
                    Section("Подходы и повторы") {
                        TextField("Подходов", text: $sets).keyboardType(.numberPad).accessibilityIdentifier("submit.sets")
                        TextField("Повторов в подходе", text: $reps).keyboardType(.numberPad).accessibilityIdentifier("submit.reps")
                    }
                }
                if task.requireDuration {
                    Section("Длительность") {
                        TextField("Минут", text: $duration).keyboardType(.numberPad).accessibilityIdentifier("submit.duration")
                    }
                }
                if task.requireMetricValue {
                    Section(task.metricTitle ?? "Результат") {
                        TextField("Число", text: $metric).keyboardType(.decimalPad).accessibilityIdentifier("submit.metric")
                    }
                }
                if task.requireDifficulty {
                    Section("Насколько было тяжело") {
                        Picker("Сложность", selection: $difficulty) {
                            Text("Не выбрано").tag(0)
                            ForEach(1...10, id: \.self) { Text("\($0) из 10").tag($0) }
                        }
                        .accessibilityIdentifier("submit.difficulty")
                    }
                }
                if task.requireWellbeing {
                    Section("Как вы себя чувствуете") {
                        Picker("Самочувствие", selection: $wellbeing) {
                            Text("Не выбрано").tag(0)
                            ForEach(1...5, id: \.self) { Text("\($0) из 5").tag($0) }
                        }
                        .accessibilityIdentifier("submit.wellbeing")
                    }
                }
                if task.requirePhoto { photoSection }
                if videoBlocks {
                    Section {
                        Label("Задание просит видео. Приложить его можно на сайте, потом задание можно будет сдать здесь.", systemImage: "video.slash")
                            .font(.footnote).foregroundStyle(.orange).accessibilityIdentifier("submit.videoBlocked")
                    }
                }
                if let message = error ?? (garbage ? "Вместо числа введено что-то другое." : nil) {
                    Section { Text(message).foregroundStyle(.red).accessibilityIdentifier("submit.error") }
                } else if !missing.isEmpty {
                    Section { Text("Ещё нужно: \(missing.joined(separator: ", ").lowercased())").font(.footnote).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle("Сдать задание")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Отправить") { Task { await send() } }
                        .disabled(submission == nil || !missing.isEmpty || videoBlocks || sending)
                        .accessibilityIdentifier("submit.send")
                }
            }
            .onAppear(perform: fill)
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                Task { await pick(item) }
            }
        }
    }

    private var photoSection: some View {
        Section("Фото") {
            if let photo, let image = UIImage(data: photo) {
                Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 200).clipShape(RoundedRectangle(cornerRadius: 10))
            } else if assignment?.photoFileId != nil {
                Label("Фото уже приложено", systemImage: "checkmark.circle").foregroundStyle(.green)
            }
            PhotosPicker(selection: $photoItem, matching: .images) {
                Label(hasPhoto ? "Выбрать другое фото" : "Выбрать фото", systemImage: "photo")
            }
            .accessibilityIdentifier("submit.photo")
        }
    }

    /// A second try after "на доработку" starts from what was handed in the first time.
    private func fill() {
        guard !filled, let assignment else { return }
        filled = true
        comment = assignment.comment ?? ""
        sets = assignment.sets.map(String.init) ?? ""
        reps = assignment.reps.map(String.init) ?? ""
        duration = assignment.durationMinutes.map(String.init) ?? ""
        metric = assignment.metricValue.map(LocalDateFormat.number) ?? ""
        difficulty = assignment.difficulty ?? 0
        wellbeing = assignment.wellbeing ?? 0
    }

    private func pick(_ item: PhotosPickerItem) async {
        error = nil
        guard let data = try? await item.loadTransferable(type: Data.self), let jpeg = ImageEncoding.jpeg(from: data) else {
            error = "Не удалось прочитать фото."
            return
        }
        photo = jpeg
    }

    private func send() async {
        guard let submission else { return }
        sending = true
        defer { sending = false }
        switch await auth.tasks.submit(task.id, submission, photo: task.requirePhoto ? photo : nil) {
        case .success:
            onDone()
            dismiss()
        case .failure(let failure):
            error = failure.message
        }
    }
}

/// The player's own tasks from all their teams, the ones to do first.
struct MyTasksView: View {
    @Environment(AuthStore.self) private var auth
    @State private var load: LoadState<[MyTask]> = .loading

    var body: some View {
        Group {
            switch load {
            case .loading:
                ProgressView("Загрузка заданий…")
            case .failed(let message):
                ContentUnavailableView {
                    Label("Не удалось загрузить задания", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Повторить") { Task { await fetch() } }
                }
            case .loaded(let tasks):
                list(tasks)
            }
        }
        .navigationTitle("Мои задания")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if case .loading = auth.teams.mine { await auth.teams.reloadMine() }
            await fetch()
        }
    }

    private func list(_ tasks: [MyTask]) -> some View {
        let toDo = tasks.filter { $0.assignment.status.canSubmit }
        let waiting = tasks.filter { $0.assignment.status == .submitted }
        let closed = tasks.filter { $0.assignment.status.isClosed }
        return List {
            if tasks.isEmpty {
                ContentUnavailableView("Заданий нет", systemImage: "checklist", description: Text("Тренер ещё не давал вам заданий."))
                    .listRowBackground(Color.clear)
            }
            section("Нужно сделать", toDo)
            section("На проверке", waiting)
            section("Завершённые", closed)
        }
        .refreshable { await fetch() }
        .accessibilityIdentifier("myTasks.list")
    }

    @ViewBuilder private func section(_ title: String, _ items: [MyTask]) -> some View {
        if !items.isEmpty {
            Section(title) {
                ForEach(items.sorted { ($0.task.deadline ?? .distantFuture) < ($1.task.deadline ?? .distantFuture) }) { item in
                    NavigationLink {
                        TaskDetailView(taskId: item.task.id, teamId: item.task.teamId)
                    } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.task.title).font(.headline)
                            HStack(spacing: 8) {
                                Text(item.assignment.status.title).font(.footnote.weight(.semibold)).foregroundStyle(item.assignment.status.color)
                                if let deadline = item.task.deadline {
                                    Text("до \(LocalDateFormat.deadline(deadline))").font(.footnote).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    .accessibilityIdentifier("myTasks.row")
                }
            }
        }
    }

    private func fetch() async {
        switch await auth.tasks.mine() {
        case .success(let tasks): load = .loaded(tasks)
        case .failure(let error): if load.value == nil { load = .failed(error.message) }
        }
    }
}
