import PhotosUI
import SportArenaKit
import SwiftUI

/// One exercise. Its owner can change it, delete it and open it to teams; a member of such a team only reads it.
struct ExerciseDetailView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let exerciseId: UUID
    let readOnly: Bool
    @State private var load: LoadState<Exercise> = .loading
    @State private var editing: Exercise?
    @State private var confirmingDelete = false
    @State private var notice: String?
    @State private var photo: UIImage?

    var body: some View {
        LoadStateView(state: load, loading: "Загрузка…", failure: "Не удалось загрузить упражнение", retry: { Task { await fetch() } }) { exercise in
            List {
                if let notice { Section { Text(notice).foregroundStyle(.red).accessibilityIdentifier("exercise.notice") } }
                if exercise.photoFileId != nil { photoSection }
                Section {
                    Text(exercise.name).font(.title3.bold()).accessibilityIdentifier("exercise.name")
                    LabeledContent("Вид спорта", value: exercise.sport)
                    if let level = exercise.difficulty { LabeledContent("Сложность", value: level.title) }
                    InfoRow(title: "Нагрузка", text: exercise.prescription)
                    InfoRow(title: "Цель", text: exercise.goal)
                    InfoRow(title: "Описание", text: exercise.description)
                    InfoRow(title: "Инвентарь", text: exercise.equipment)
                }
                if [exercise.technique, exercise.commonMistakes, exercise.warnings].contains(where: { !($0 ?? "").isEmpty }) {
                    Section(sag: "Как делать") {
                        InfoRow(title: "Техника", text: exercise.technique)
                        InfoRow(title: "Частые ошибки", text: exercise.commonMistakes)
                        InfoRow(title: "Предупреждения", text: exercise.warnings)
                    }
                }
                if let video = exercise.videoFileId { Section(sag: "Видео") { WatchVideoButton(fileId: video) } }
                if !readOnly {
                    if !(exercise.coachComment ?? "").isEmpty { Section(sag: "Заметка тренера") { Text(exercise.coachComment ?? "") } }
                    ShareTeamsSection(sharedTeamIds: exercise.sharedTeamIds) { team, on in
                        switch await auth.library.shareExercise(exercise.id, team: team, on: on) {
                        case .success(let updated):
                            load = .loaded(updated)
                            return nil
                        case .failure(let error): return error.message
                        }
                    }
                }
            }
            .refreshable { await fetch() }
        }
        .sagScreen()
        .navigationTitle("Упражнение")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !readOnly, let exercise = load.value {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Изменить", systemImage: "pencil") { editing = exercise }.accessibilityIdentifier("exercise.edit")
                        Button("Удалить", systemImage: "trash", role: .destructive) { confirmingDelete = true }.accessibilityIdentifier("exercise.delete")
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel("Действия с упражнением")
                    .accessibilityIdentifier("exercise.actions")
                }
            }
        }
        .task {
            if case .loading = auth.teams.mine { await auth.teams.reloadMine() }
            await fetch()
        }
        .sheet(item: $editing) { exercise in ExerciseFormView(mode: .edit(exercise)) { updated in load = .loaded(updated) } }
        .confirmationDialog("Удалить упражнение?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Удалить", role: .destructive) { Task { await delete() } }
        } message: {
            Text("Оно исчезнет из планов и шаблонов.")
        }
    }

    @ViewBuilder private var photoSection: some View {
        Section {
            ZStack {
                RoundedRectangle(cornerRadius: 12).fill(Color.black.opacity(0.08))
                if let photo { Image(uiImage: photo).resizable().scaledToFit() } else { ProgressView() }
            }
            .frame(maxWidth: .infinity, minHeight: 120, maxHeight: 260)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .accessibilityLabel("Фото упражнения")
            .task(id: load.value?.photoFileId) {
                guard let id = load.value?.photoFileId else { return }
                photo = await auth.profile.image(for: id, thumbnail: false)
            }
        }
    }

    private func fetch() async {
        switch await auth.library.exercise(exerciseId) {
        case .success(let exercise): load = .loaded(exercise)
        case .failure(let error): if load.value == nil { load = .failed(error.message) } else { notice = error.message }
        }
    }

    private func delete() async {
        if let failure = await auth.library.deleteExercise(exerciseId).failure { notice = failure.message } else { dismiss() }
    }
}

/// Adding an exercise, or changing one.
struct ExerciseFormView: View {
    enum Mode {
        case create
        case edit(Exercise)
    }

    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let mode: Mode
    let onDone: (Exercise) -> Void
    @State private var input = ExerciseInput()
    @State private var photoItem: PhotosPickerItem?
    @State private var photo: Data?
    @State private var video: PickedVideo?
    @State private var videoProblem: String?
    @State private var saving = false
    @State private var error: String?
    @State private var filled = false
    /// Set once the exercise exists on the server, so a second tap on «Сохранить» (after a failed photo) changes it instead of adding another.
    @State private var savedId: UUID?

    private var isCreate: Bool { if case .create = mode { true } else { false } }
    private var hasPhoto: Bool { if case .edit(let exercise) = mode { exercise.photoFileId != nil || photo != nil } else { photo != nil } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Название", text: $input.name).accessibilityIdentifier("exerciseForm.name")
                    SportPicker(sport: $input.sport, identifier: "exerciseForm.sport")
                    Picker("Сложность", selection: $input.difficulty) {
                        Text("Не указана").tag(TeamLevel?.none)
                        ForEach(TeamLevel.allCases) { Text($0.title).tag(TeamLevel?.some($0)) }
                    }
                }
                Section(sag: "Нагрузка") {
                    OptionalIntField(title: "Подходов", value: $input.sets, identifier: "exerciseForm.sets")
                    OptionalIntField(title: "Повторов", value: $input.reps, identifier: "exerciseForm.reps")
                    OptionalIntField(title: "Длительность, секунд", value: $input.durationSeconds)
                    OptionalIntField(title: "Отдых, секунд", value: $input.restSeconds)
                }
                Section(sag: "О упражнении") {
                    TextField("Цель", text: $input.goal, axis: .vertical).lineLimit(1...3)
                    TextField("Описание", text: $input.description, axis: .vertical).lineLimit(2...8)
                    TextField("Инвентарь", text: $input.equipment, axis: .vertical).lineLimit(1...3)
                }
                Section(sag: "Как делать") {
                    TextField("Техника", text: $input.technique, axis: .vertical).lineLimit(2...8)
                    TextField("Частые ошибки", text: $input.commonMistakes, axis: .vertical).lineLimit(2...8)
                    TextField("Предупреждения", text: $input.warnings, axis: .vertical).lineLimit(1...4)
                    TextField("Заметка для себя", text: $input.coachComment, axis: .vertical).lineLimit(1...4)
                }
                Section(sag: "Фото") {
                    if let photo, let image = UIImage(data: photo) {
                        Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 180).clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    PhotosPicker(selection: $photoItem, matching: .images) {
                        Label(hasPhoto ? "Выбрать другое фото" : "Выбрать фото", systemImage: "photo")
                    }
                    .accessibilityIdentifier("exerciseForm.photo")
                }
                Section {
                    VideoAttachmentRow(
                        video: $video, hasUploaded: { if case .edit(let exercise) = mode { exercise.videoFileId != nil } else { false } }(),
                        limitSeconds: VideoRules.maxExerciseSeconds, identifier: "exerciseForm.video", problem: $videoProblem
                    )
                } header: {
                    Text("Видео")
                } footer: {
                    Text("Не длиннее \(VideoRules.maxExerciseSeconds) секунд, до \(VideoRules.maxBytes / 1024 / 1024) МБ.")
                }
                if let message = error ?? videoProblem ?? (input.name.isEmpty ? nil : input.problem) {
                    Section { Text(message).foregroundStyle(.red).accessibilityIdentifier("exerciseForm.error") }
                }
            }
            .sagScreen()
            .navigationTitle(isCreate ? "Новое упражнение" : "Изменить упражнение")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Сохранить") { Task { await save() } }.disabled(!input.isValid || saving).accessibilityIdentifier("exerciseForm.save")
                }
            }
            .onAppear(perform: fill)
            .task { await prefillSport() }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                Task {
                    guard let data = try? await item.loadTransferable(type: Data.self), let jpeg = ImageEncoding.jpeg(from: data) else {
                        error = "Не удалось прочитать фото."
                        return
                    }
                    photo = jpeg
                }
            }
        }
    }

    private func fill() {
        guard !filled else { return }
        filled = true
        if case .edit(let exercise) = mode { input = exercise.asInput }
    }

    /// A new exercise starts with the coach's own sport.
    private func prefillSport() async {
        guard isCreate, input.sport.isEmpty else { return }
        if auth.profile.profile == nil { await auth.profile.refresh() }
        if input.sport.isEmpty { input.sport = auth.profile.profile?.coach?.sport ?? "" }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        var result: Result<Exercise, APIError>
        switch mode {
        case .create:
            if let savedId { result = await auth.library.updateExercise(savedId, input) } else { result = await auth.library.createExercise(input) }
        case .edit(let exercise): result = await auth.library.updateExercise(exercise.id, input)
        }
        // The photo goes after the exercise exists. If it fails the exercise is saved anyway, and the person is told.
        if case .success(let saved) = result { savedId = saved.id }
        if case .success(let saved) = result, let photo {
            switch await auth.library.attachPhoto(photo, to: saved.id) {
            case .success(let withPhoto): result = .success(withPhoto)
            case .failure(let failure):
                onDone(saved)
                error = "Упражнение сохранено, но фото не загрузилось: \(failure.message) Выберите фото ещё раз или закройте форму."
                self.photo = nil
                return
            }
        }
        if case .success(let saved) = result, let picked = video {
            switch await auth.library.attachVideo(picked.data, to: saved.id) {
            case .success(let withVideo): result = .success(withVideo)
            case .failure(let failure):
                onDone(saved)
                error = "Упражнение сохранено, но видео не загрузилось: \(failure.message) Выберите видео ещё раз или закройте форму."
                video = nil
                return
            }
        }
        switch result {
        case .success(let saved):
            onDone(saved)
            dismiss()
        case .failure(let failure):
            error = failure.message
        }
    }
}
