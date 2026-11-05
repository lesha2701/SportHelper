import PhotosUI
import SportArenaKit
import SwiftUI

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
    @State private var video: PickedVideo?
    @State private var videoProblem: String?
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
        if hasVideo { items.removeAll { $0 == TaskRequirement.video.title } }
        return items
    }

    private var hasVideo: Bool { video != nil || assignment?.videoFileId != nil }

    var body: some View {
        NavigationStack {
            Form {
                Section(sag: "Комментарий\(task.requireComment ? "" : " (необязательно)")") {
                    TextField("Как прошло", text: $comment, axis: .vertical).lineLimit(3...8).accessibilityIdentifier("submit.comment")
                }
                if task.requireSetsReps {
                    Section(sag: "Подходы и повторы") {
                        TextField("Подходов", text: $sets).keyboardType(.numberPad).accessibilityIdentifier("submit.sets")
                        TextField("Повторов в подходе", text: $reps).keyboardType(.numberPad).accessibilityIdentifier("submit.reps")
                    }
                }
                if task.requireDuration {
                    Section(sag: "Длительность") {
                        TextField("Минут", text: $duration).keyboardType(.numberPad).accessibilityIdentifier("submit.duration")
                    }
                }
                if task.requireMetricValue {
                    Section(sag: task.metricTitle ?? "Результат") {
                        TextField("Число", text: $metric).keyboardType(.decimalPad).accessibilityIdentifier("submit.metric")
                    }
                }
                if task.requireDifficulty {
                    Section(sag: "Насколько было тяжело") {
                        Picker("Сложность", selection: $difficulty) {
                            Text("Не выбрано").tag(0)
                            ForEach(1...10, id: \.self) { Text("\($0) из 10").tag($0) }
                        }
                        .accessibilityIdentifier("submit.difficulty")
                    }
                }
                if task.requireWellbeing {
                    Section(sag: "Как вы себя чувствуете") {
                        Picker("Самочувствие", selection: $wellbeing) {
                            Text("Не выбрано").tag(0)
                            ForEach(1...5, id: \.self) { Text("\($0) из 5").tag($0) }
                        }
                        .accessibilityIdentifier("submit.wellbeing")
                    }
                }
                if task.requirePhoto { photoSection }
                if task.requireVideo { videoSection }
                if let message = error ?? videoProblem ?? (garbage ? "Вместо числа введено что-то другое." : nil) {
                    Section { Text(message).foregroundStyle(.red).accessibilityIdentifier("submit.error") }
                } else if !missing.isEmpty {
                    Section { Text("Ещё нужно: \(missing.joined(separator: ", ").lowercased())").font(.footnote).foregroundStyle(.secondary) }
                }
            }
            .sagScreen()
            .navigationTitle("Сдать задание")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Отправить") { Task { await send() } }
                        .disabled(submission == nil || !missing.isEmpty || sending)
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

    private var videoSection: some View {
        Section {
            VideoAttachmentRow(
                video: $video, hasUploaded: assignment?.videoFileId != nil, limitSeconds: nil, identifier: "submit.video", problem: $videoProblem
            )
        } header: {
            Text("Видео")
        } footer: {
            Text("Видео сожмётся до 720p, не больше \(VideoRules.maxBytes / 1024 / 1024) МБ.")
        }
    }

    private var photoSection: some View {
        Section(sag: "Фото") {
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
        switch await auth.tasks.submit(task.id, submission, photo: task.requirePhoto ? photo : nil, video: task.requireVideo ? video?.data : nil) {
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
        .sagScreen()
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
            Section(sag: title) {
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
