import SportArenaKit
import SwiftUI

extension AssignmentStatus {
    var color: Color {
        switch self {
        case .accepted: .green
        case .submitted: .orange
        case .needsRevision, .overdue, .missed: .red
        case .cancelled: .secondary
        default: Theme.primary
        }
    }
}

/// The tasks of one team. The coaching staff sees all of them with how far everyone got; a player sees their own.
struct TeamTasksView: View {
    @Environment(AuthStore.self) private var auth
    let team: Team
    @State private var load: LoadState<[TeamTask]> = .loading
    @State private var giving: GiveSheet?

    /// How a task is started: from nothing, by choosing a template of the library first, or from the template chosen.
    private enum GiveSheet: Identifiable {
        case blank, picker, template(TaskTemplate)
        var id: String {
            switch self {
            case .blank: "blank"
            case .picker: "picker"
            case .template(let template): "template-\(template.id)"
            }
        }
    }

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
        .sagScreen()
        .navigationTitle("Задания")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if team.canManage {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Назначить задание", systemImage: "plus") { giving = .blank }.accessibilityIdentifier("tasks.add")
                }
            }
        }
        .task { await fetch() }
        .sheet(item: $giving) { sheet in
            switch sheet {
            case .blank: TaskFormView(mode: .give(team)) { Task { await fetch() } }
            case .template(let template): TaskFormView(mode: .give(team), template: template) { Task { await fetch() } }
            case .picker: TaskTemplatePickerView { giving = .template($0) }
            }
        }
    }

    /// The first thing a coach sees: the tasks they have already made in the library are one tap away.
    private var startSection: some View {
        Section {
            Button { giving = .picker } label: { Label("Добавить задание из библиотеки", systemImage: "books.vertical") }
                .buttonStyle(.sag)
                .accessibilityIdentifier("tasks.fromLibrary")
            Button { giving = .blank } label: { Label("Создать новое задание", systemImage: "plus") }
                .buttonStyle(.sagGhost)
                .accessibilityIdentifier("tasks.new")
        }
        .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
        .listRowBackground(Color.clear)
    }

    private func list(_ tasks: [TeamTask]) -> some View {
        List {
            if team.canManage { startSection }
            if tasks.isEmpty {
                ContentUnavailableView(
                    "Заданий нет", systemImage: "checklist",
                    description: Text(team.canManage ? "Назначьте первое задание: из библиотеки или новое." : "Тренер ещё не давал вам заданий.")
                )
                .listRowBackground(Color.clear)
            }
            ForEach(tasks.sorted { $0.createdAt > $1.createdAt }) { task in
                NavigationLink {
                    TaskDetailView(taskId: task.id, teamId: team.id)
                } label: {
                    TaskRow(task: task, staff: team.canManage, userId: auth.user?.id)
                }
                .accessibilityIdentifier("tasks.row")
            }
        }
        .refreshable { await fetch() }
        .accessibilityIdentifier("tasks.list")
    }

    private func fetch() async {
        switch await auth.tasks.tasks(of: team.id) {
        case .success(let tasks): load = .loaded(tasks)
        case .failure(let error): if load.value == nil { load = .failed(error.message) }
        }
    }
}

struct TaskRow: View {
    let task: TeamTask
    let staff: Bool
    let userId: UUID?

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(task.title).font(.headline)
            if let deadline = task.deadline {
                Text("До \(LocalDateFormat.deadline(deadline))").font(.footnote).foregroundStyle(.secondary)
            }
            if staff {
                let total = task.activeAssignments.count
                HStack(spacing: 8) {
                    Text("Принято \(task.acceptedCount) из \(total)").font(.footnote).foregroundStyle(.secondary)
                    if task.waitingForReviewCount > 0 {
                        Text("Ждут проверки: \(task.waitingForReviewCount)").font(.footnote.weight(.semibold)).foregroundStyle(.orange)
                    }
                }
            } else if let mine = userId.flatMap(task.assignment(of:)) {
                Text(mine.status.title).font(.footnote.weight(.semibold)).foregroundStyle(mine.status.color)
            }
        }
        .padding(.vertical, 2)
    }
}

/// One task: what to do, and either the player's own part (start, hand in) or everyone's part for the coaching staff (review).
struct TaskDetailView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let taskId: UUID
    let teamId: UUID
    @State private var load: LoadState<TeamTask> = .loading
    @State private var editing: TeamTask?
    @State private var submitting: TeamTask?
    @State private var confirmingDelete = false
    @State private var notice: (text: String, isError: Bool)?
    @State private var working = false

    private var team: Team? { auth.teams.mine.loadedTeams.first { $0.id == teamId } }
    private var staff: Bool { team?.canManage ?? false }

    var body: some View {
        Group {
            switch load {
            case .loading:
                ProgressView("Загрузка…")
            case .failed(let message):
                ContentUnavailableView {
                    Label("Не удалось загрузить задание", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Повторить") { Task { await fetch() } }
                }
            case .loaded(let task):
                details(task)
            }
        }
        .sagScreen()
        .navigationTitle("Задание")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let task = load.value, staff {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Изменить", systemImage: "pencil") { editing = task }.accessibilityIdentifier("task.edit")
                        Button("Удалить", systemImage: "trash", role: .destructive) { confirmingDelete = true }.accessibilityIdentifier("task.delete")
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel("Действия с заданием")
                    .accessibilityIdentifier("task.actions")
                }
            }
        }
        .task {
            if case .loading = auth.teams.mine { await auth.teams.reloadMine() }
            await fetch()
        }
        .sheet(item: $editing) { task in TaskFormView(mode: .edit(task)) { Task { await fetch() } } }
        .sheet(item: $submitting) { task in
            TaskSubmitView(task: task, assignment: auth.user.flatMap { task.assignment(of: $0.id) }) { Task { await fetch() } }
        }
        .confirmationDialog("Удалить задание?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Удалить", role: .destructive) { Task { await delete() } }
        } message: {
            Text("Оно пропадёт у всех игроков, незавершённые выполнения будут отменены.")
        }
    }

    // MARK: sections

    private func details(_ task: TeamTask) -> some View {
        List {
            if let notice {
                Section {
                    Label(notice.text, systemImage: notice.isError ? "exclamationmark.triangle" : "checkmark.circle")
                        .foregroundStyle(notice.isError ? .red : .green).accessibilityIdentifier("task.notice")
                }
            }
            Section {
                Text(task.title).font(.title3.bold()).accessibilityIdentifier("task.title")
                if let text = task.description, !text.isEmpty { Text(text) }
                if let deadline = task.deadline { LabeledContent("Срок", value: LocalDateFormat.deadline(deadline)) }
                if let metric = task.metricTitle {
                    LabeledContent("Показатель", value: metric)
                    if let target = task.metricTarget { LabeledContent("Цель", value: LocalDateFormat.number(target)) }
                }
                if staff, let target = task.target {
                    LabeledContent("Кому", value: task.targetPosition.map { "\(target.title): \($0)" } ?? target.title)
                }
            }
            if !task.exercises.isEmpty {
                Section(sag: "Упражнения") {
                    ForEach(task.exercises.sorted { $0.orderIndex < $1.orderIndex }) { Text($0.exerciseName ?? "Упражнение") }
                }
            }
            if !task.requirements.isEmpty {
                Section(sag: "Что нужно сдать") {
                    ForEach(task.requirements) { Label($0.title, systemImage: "checkmark.square") }
                }
            }
            if staff { staffSection(task) } else { playerSection(task) }
        }
        .refreshable { await fetch() }
    }

    @ViewBuilder private func playerSection(_ task: TeamTask) -> some View {
        if let mine = auth.user.flatMap({ task.assignment(of: $0.id) }) {
            Section(sag: "Ваше выполнение") {
                HStack {
                    Text("Статус")
                    Spacer()
                    Text(mine.status.title).fontWeight(.semibold).foregroundStyle(mine.status.color).accessibilityIdentifier("task.status")
                }
                if let comment = mine.coachComment, !comment.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Комментарий тренера").font(.footnote).foregroundStyle(.secondary)
                        Text(comment).accessibilityIdentifier("task.coachComment")
                    }
                }
                SubmissionDetails(task: task, assignment: mine)
                if mine.status.canStart {
                    Button("Начать", systemImage: "play.circle") { Task { await start() } }.disabled(working).accessibilityIdentifier("task.start")
                }
                if mine.status.canSubmit {
                    Button(mine.status == .needsRevision ? "Сдать заново" : "Сдать задание", systemImage: "paperplane") { submitting = task }
                        .disabled(working).accessibilityIdentifier("task.submit")
                }
            }
        }
    }

    private func staffSection(_ task: TeamTask) -> some View {
        Section(sag: "Выполнение (\(task.acceptedCount) из \(task.activeAssignments.count) принято)") {
            if task.assignments.isEmpty { Text("Задание никому не назначено.").foregroundStyle(.secondary) }
            ForEach(task.assignments) { assignment in
                NavigationLink {
                    AssignmentReviewView(task: task, assignment: assignment) { Task { await fetch() } }
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(assignment.fullName)
                            if let position = assignment.position, !position.isEmpty {
                                Text(position).font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Text(assignment.status.title).font(.footnote.weight(.semibold)).foregroundStyle(assignment.status.color)
                    }
                }
                .accessibilityIdentifier("task.assignment")
            }
        }
    }

    // MARK: actions

    private func fetch() async {
        switch await auth.tasks.task(taskId) {
        case .success(let task): load = .loaded(task)
        case .failure(let error): if load.value == nil { load = .failed(error.message) } else { notice = (error.message, true) }
        }
    }

    private func start() async {
        working = true
        defer { working = false }
        switch await auth.tasks.start(taskId) {
        case .success:
            notice = nil
            await fetch()
        case .failure(let error): notice = (error.message, true)
        }
    }

    private func delete() async {
        working = true
        defer { working = false }
        switch await auth.tasks.delete(taskId) {
        case .success: dismiss()
        case .failure(let error): notice = (error.message, true)
        }
    }
}

extension TeamsStore.Load where Value == [Team] {
    var loadedTeams: [Team] { if case .loaded(let teams) = self { teams } else { [] } }
}

/// What a player handed in, as the player and the coach read it.
struct SubmissionDetails: View {
    let task: TeamTask
    let assignment: TaskAssignment

    var body: some View {
        Group {
            if let submittedAt = assignment.submittedAt, assignment.status != .assigned {
                LabeledContent("Сдано", value: LocalDateFormat.deadline(submittedAt))
            }
            if let comment = assignment.comment, !comment.isEmpty { LabeledContent("Комментарий", value: comment) }
            if let sets = assignment.sets, let reps = assignment.reps { LabeledContent("Подходы × повторы", value: "\(sets) × \(reps)") }
            if let minutes = assignment.durationMinutes { LabeledContent("Длительность", value: "\(minutes) мин") }
            if let value = assignment.metricValue {
                LabeledContent(task.metricName ?? "Результат", value: [LocalDateFormat.number(value), task.metricUnit].compactMap { $0 }.joined(separator: " "))
            }
            if let difficulty = assignment.difficulty { LabeledContent("Сложность", value: "\(difficulty) из 10") }
            if let wellbeing = assignment.wellbeing { LabeledContent("Самочувствие", value: "\(wellbeing) из 5") }
            if let photo = assignment.photoFileId { SubmittedPhoto(fileId: photo) }
            if let video = assignment.videoFileId { WatchVideoButton(fileId: video) }
        }
    }
}

private struct SubmittedPhoto: View {
    let fileId: UUID
    @Environment(AuthStore.self) private var auth
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12).fill(Color.black.opacity(0.08))
            if let image { Image(uiImage: image).resizable().scaledToFit() } else { ProgressView() }
        }
        .frame(maxWidth: .infinity, minHeight: 120, maxHeight: 260)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityLabel("Фото к заданию")
        .task(id: fileId) { image = await auth.profile.image(for: fileId, thumbnail: false) }
    }
}

/// A coach looks at one player's part and accepts it or sends it back.
struct AssignmentReviewView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let task: TeamTask
    let assignment: TaskAssignment
    let onDone: () -> Void
    @State private var comment = ""
    @State private var working = false
    @State private var error: String?

    private var canReview: Bool {
        switch assignment.status {
        case .submitted, .accepted, .needsRevision: true
        default: false
        }
    }

    var body: some View {
        List {
            Section {
                Text(assignment.fullName).font(.title3.bold())
                if let position = assignment.position, !position.isEmpty { Text(position).foregroundStyle(.secondary) }
                HStack {
                    Text("Статус")
                    Spacer()
                    Text(assignment.status.title).fontWeight(.semibold).foregroundStyle(assignment.status.color).accessibilityIdentifier("review.status")
                }
            }
            Section(sag: "Что сдано") {
                if assignment.submittedAt == nil && assignment.status != .submitted {
                    Text("Пока ничего не сдано.").foregroundStyle(.secondary)
                }
                SubmissionDetails(task: task, assignment: assignment)
            }
            if let previous = assignment.coachComment, !previous.isEmpty {
                Section(sag: "Ваш комментарий") { Text(previous) }
            }
            if canReview {
                Section(sag: "Решение") {
                    TextField("Комментарий игроку (необязательно)", text: $comment, axis: .vertical).lineLimit(2...6)
                        .accessibilityIdentifier("review.comment")
                    if comment.count > TaskLimits.maxReviewComment {
                        Text("Комментарий не длиннее \(TaskLimits.maxReviewComment) символов.").font(.footnote).foregroundStyle(.red)
                    }
                    if let error { Text(error).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("review.error") }
                    HStack(spacing: 12) {
                        Button { Task { await review(.accepted) } } label: { Text("Принять").frame(maxWidth: .infinity) }
                            .buttonStyle(.borderedProminent).accessibilityIdentifier("review.accept")
                        Button { Task { await review(.needsRevision) } } label: { Text("На доработку").frame(maxWidth: .infinity) }
                            .buttonStyle(.bordered).accessibilityIdentifier("review.revise")
                    }
                    .disabled(working || comment.count > TaskLimits.maxReviewComment)
                }
            }
        }
        .sagScreen()
        .navigationTitle("Выполнение")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func review(_ decision: TaskDecision) async {
        working = true
        defer { working = false }
        switch await auth.tasks.review(task.id, player: assignment.userId, decision: decision, comment: comment) {
        case .success:
            onDone()
            dismiss()
        case .failure(let failure):
            error = failure.message
        }
    }
}
