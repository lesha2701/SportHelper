import SportArenaKit
import SwiftUI

/// One plan with its exercises by section. Its owner builds and changes it and opens it to teams; a team member only reads it.
struct PlanDetailView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let planId: UUID
    let readOnly: Bool
    @State private var load: LoadState<Plan> = .loading
    @State private var editing: Plan?
    @State private var itemForm: PlanItemFormView.Mode?
    @State private var confirmingDelete = false
    @State private var notice: String?

    var body: some View {
        LoadStateView(state: load, loading: "Загрузка…", failure: "Не удалось загрузить план", retry: { Task { await fetch() } }) { plan in
            List {
                if let notice { Section { Text(notice).foregroundStyle(.red).accessibilityIdentifier("plan.notice") } }
                Section {
                    Text(plan.name).font(.title3.bold()).accessibilityIdentifier("plan.name")
                    LabeledContent("Вид спорта", value: plan.sport)
                    if let minutes = plan.durationMinutes { LabeledContent("Длительность", value: "\(minutes) мин") }
                    InfoRow(title: "Описание", text: plan.description)
                    InfoRow(title: "Инвентарь", text: plan.equipment)
                    if !readOnly { InfoRow(title: "Заметка тренера", text: plan.comment) }
                }
                ForEach(PlanSection.allCases) { section in sectionView(plan, section) }
                if !readOnly {
                    ShareTeamsSection(sharedTeamIds: plan.sharedTeamIds) { team, on in
                        switch await auth.library.sharePlan(plan.id, team: team, on: on) {
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
        .navigationTitle("План")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !readOnly, let plan = load.value {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Изменить", systemImage: "pencil") { editing = plan }.accessibilityIdentifier("plan.edit")
                        Button("Сделать копию", systemImage: "doc.on.doc") { Task { await duplicate() } }.accessibilityIdentifier("plan.duplicate")
                        Button("Удалить", systemImage: "trash", role: .destructive) { confirmingDelete = true }.accessibilityIdentifier("plan.delete")
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel("Действия с планом")
                    .accessibilityIdentifier("plan.actions")
                }
            }
        }
        .task {
            if case .loading = auth.teams.mine { await auth.teams.reloadMine() }
            await fetch()
        }
        .sheet(item: $editing) { plan in PlanFormView(mode: .edit(plan)) { updated in load = .loaded(updated) } }
        .sheet(item: $itemForm) { mode in PlanItemFormView(mode: mode) { Task { await fetch() } } }
        .confirmationDialog("Удалить план?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Удалить", role: .destructive) { Task { await delete() } }
        } message: {
            Text("Упражнения останутся в библиотеке.")
        }
    }

    @ViewBuilder private func sectionView(_ plan: Plan, _ section: PlanSection) -> some View {
        let items = plan.exercises(in: section)
        if !items.isEmpty || !readOnly {
            Section(sag: section.title) {
                ForEach(items) { item in
                    let row = VStack(alignment: .leading, spacing: 2) {
                        Text(item.exerciseName ?? "Упражнение")
                        if let text = item.prescription { Text(text).font(.footnote).foregroundStyle(.secondary) }
                        if let notes = item.notes, !notes.isEmpty { Text(notes).font(.footnote).foregroundStyle(.secondary) }
                    }
                    .accessibilityElement(children: .combine)
                    if readOnly {
                        row
                    } else {
                        Button { itemForm = .edit(plan, item) } label: { row }
                            .foregroundStyle(.primary)
                            .accessibilityIdentifier("plan.item")
                            .swipeActions { Button("Убрать", role: .destructive) { Task { await remove(plan, item) } } }
                    }
                }
                if !readOnly {
                    Button("Добавить упражнение", systemImage: "plus.circle") { itemForm = .add(plan, section) }
                        .accessibilityIdentifier("plan.add.\(section.rawValue)")
                }
            }
        }
    }

    private func fetch() async {
        switch await auth.library.plan(planId) {
        case .success(let plan): load = .loaded(plan)
        case .failure(let error): if load.value == nil { load = .failed(error.message) } else { notice = error.message }
        }
    }

    private func remove(_ plan: Plan, _ item: PlanExercise) async {
        if let failure = await auth.library.removeExercise(item.id, from: plan.id).failure { notice = failure.message } else { await fetch() }
    }

    private func duplicate() async {
        switch await auth.library.duplicatePlan(planId) {
        case .success(let copy): notice = "Копия «\(copy.name)» создана: она в списке планов."
        case .failure(let failure): notice = failure.message
        }
    }

    private func delete() async {
        if let failure = await auth.library.deletePlan(planId).failure { notice = failure.message } else { dismiss() }
    }
}

/// Adding a plan, or changing one.
struct PlanFormView: View {
    enum Mode {
        case create
        case edit(Plan)
    }

    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let mode: Mode
    let onDone: (Plan) -> Void
    @State private var input = PlanInput()
    @State private var saving = false
    @State private var error: String?
    @State private var filled = false

    private var isCreate: Bool { if case .create = mode { true } else { false } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Название", text: $input.name).accessibilityIdentifier("planForm.name")
                    SportPicker(sport: $input.sport, identifier: "planForm.sport")
                    OptionalIntField(title: "Длительность, минут", value: $input.durationMinutes, identifier: "planForm.duration")
                }
                Section(sag: "О плане") {
                    TextField("Описание", text: $input.description, axis: .vertical).lineLimit(2...8)
                    TextField("Инвентарь", text: $input.equipment, axis: .vertical).lineLimit(1...3)
                    TextField("Заметка для себя", text: $input.comment, axis: .vertical).lineLimit(1...4)
                }
                if let message = error ?? (input.name.isEmpty ? nil : input.problem) {
                    Section { Text(message).foregroundStyle(.red).accessibilityIdentifier("planForm.error") }
                }
            }
            .sagScreen()
            .navigationTitle(isCreate ? "Новый план" : "Изменить план")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Сохранить") { Task { await save() } }.disabled(!input.isValid || saving).accessibilityIdentifier("planForm.save")
                }
            }
            .onAppear {
                guard !filled else { return }
                filled = true
                if case .edit(let plan) = mode { input = plan.asInput }
            }
            .task {
                // A new plan starts with the coach's own sport.
                guard isCreate, input.sport.isEmpty else { return }
                if auth.profile.profile == nil { await auth.profile.refresh() }
                if input.sport.isEmpty { input.sport = auth.profile.profile?.coach?.sport ?? "" }
            }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let result: Result<Plan, APIError>
        switch mode {
        case .create: result = await auth.library.createPlan(input)
        case .edit(let plan): result = await auth.library.updatePlan(plan.id, input)
        }
        switch result {
        case .success(let plan):
            onDone(plan)
            dismiss()
        case .failure(let failure):
            error = failure.message
        }
    }
}

/// Putting an exercise of the library into a plan, or changing how it is done there.
struct PlanItemFormView: View {
    enum Mode: Identifiable {
        case add(Plan, PlanSection)
        case edit(Plan, PlanExercise)

        var id: String {
            switch self {
            case .add(let plan, let section): "add-\(plan.id)-\(section.rawValue)"
            case .edit(_, let item): "edit-\(item.id)"
            }
        }
    }

    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let mode: Mode
    let onDone: () -> Void
    @State private var exercises: LoadState<[Exercise]> = .loading
    @State private var input: PlanExerciseInput?
    @State private var saving = false
    @State private var error: String?

    private var plan: Plan {
        switch mode {
        case .add(let plan, _), .edit(let plan, _): plan
        }
    }
    private var isAdd: Bool { if case .add = mode { true } else { false } }

    var body: some View {
        NavigationStack {
            LoadStateView(state: exercises, loading: "Загрузка упражнений…", failure: "Не удалось загрузить упражнения", retry: { Task { await load() } }) { list in
                if list.isEmpty {
                    ContentUnavailableView(
                        "В библиотеке нет упражнений", systemImage: "figure.strengthtraining.traditional",
                        description: Text("Сначала добавьте упражнение в разделе «Упражнения».")
                    )
                } else if input != nil {
                    form(list)
                }
            }
            .sagScreen()
            .navigationTitle(isAdd ? "Упражнение в план" : "Упражнение в плане")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Сохранить") { Task { await save() } }.disabled(input?.isValid != true || saving).accessibilityIdentifier("planItem.save")
                }
            }
            .task { await load() }
        }
    }

    private func form(_ list: [Exercise]) -> some View {
        let binding = Binding(get: { input ?? PlanExerciseInput(exerciseId: UUID()) }, set: { input = $0 })
        return Form {
            Section {
                Picker("Упражнение", selection: binding.exerciseId) {
                    ForEach(list) { Text($0.name).tag($0.id) }
                }
                .accessibilityIdentifier("planItem.exercise")
                Picker("Часть тренировки", selection: binding.section) {
                    ForEach(PlanSection.allCases) { Text($0.title).tag($0) }
                }
            }
            Section(sag: "Как делать в этом плане") {
                OptionalIntField(title: "Подходов", value: binding.sets)
                OptionalIntField(title: "Повторов", value: binding.reps, identifier: "planItem.reps")
                OptionalIntField(title: "Длительность, секунд", value: binding.durationSeconds)
                OptionalIntField(title: "Отдых, секунд", value: binding.restSeconds)
                TextField("Заметка", text: binding.notes, axis: .vertical).lineLimit(1...4)
            }
            if let message = error ?? input?.problem { Section { Text(message).foregroundStyle(.red) } }
        }
    }

    private func load() async {
        switch await auth.library.exercises() {
        case .success(let list):
            exercises = .loaded(list)
            if input == nil {
                switch mode {
                case .add(let plan, let section):
                    var value = PlanExerciseInput(exerciseId: list.first?.id ?? UUID(), section: section, orderIndex: plan.exercises(in: section).count)
                    if let first = list.first { (value.sets, value.reps, value.durationSeconds, value.restSeconds) = (first.sets, first.reps, first.durationSeconds, first.restSeconds) }
                    input = value
                case .edit(_, let item): input = item.asInput
                }
            }
        case .failure(let failure):
            exercises = .failed(failure.message)
        }
    }

    private func save() async {
        guard let input else { return }
        saving = true
        defer { saving = false }
        let failure: APIError?
        switch mode {
        case .add(let plan, _): failure = await auth.library.addExercise(input, to: plan.id).failure
        case .edit(let plan, let item): failure = await auth.library.updateExercise(item.id, in: plan.id, input).failure
        }
        if let failure {
            error = failure.message
        } else {
            onDone()
            dismiss()
        }
    }
}
