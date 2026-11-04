import SportArenaKit
import SwiftUI

/// The coach's library: exercises, training plans and task templates.
struct LibraryView: View {
    private enum Section: String, CaseIterable, Identifiable {
        case exercises = "Упражнения", plans = "Планы", templates = "Задания"
        var id: String { rawValue }
    }

    @State private var section = Section.exercises
    @State private var path: [LibraryRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                Picker("Раздел", selection: $section) {
                    ForEach(Section.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.bottom, 8)
                .accessibilityIdentifier("library.section")
                switch section {
                case .exercises: ExercisesListView()
                case .plans: PlansListView()
                case .templates: TemplatesListView()
                }
            }
            .navigationTitle("Библиотека")
            .navigationDestination(for: LibraryRoute.self) { route in
                switch route {
                case .exercise(let id): ExerciseDetailView(exerciseId: id, readOnly: false)
                case .plan(let id): PlanDetailView(planId: id, readOnly: false)
                case .template(let template): TemplateDetailView(template: template)
                }
            }
        }
    }
}

enum LibraryRoute: Hashable {
    case exercise(UUID)
    case plan(UUID)
    case template(TaskTemplate)
}

struct ExercisesListView: View {
    @Environment(AuthStore.self) private var auth
    @State private var load: LoadState<[Exercise]> = .loading
    @State private var adding = false

    var body: some View {
        LoadStateView(state: load, loading: "Загрузка упражнений…", failure: "Не удалось загрузить упражнения", retry: { Task { await fetch() } }) { items in
            List {
                if items.isEmpty {
                    ContentUnavailableView("Упражнений нет", systemImage: "figure.strengthtraining.traditional", description: Text("Добавьте первое кнопкой «+»."))
                        .listRowBackground(Color.clear)
                }
                ForEach(items) { exercise in
                    NavigationLink(value: LibraryRoute.exercise(exercise.id)) { ExerciseRow(exercise: exercise) }.accessibilityIdentifier("library.row")
                }
            }
            .refreshable { await fetch() }
            .accessibilityIdentifier("library.exercises")
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { Button("Добавить", systemImage: "plus") { adding = true }.accessibilityIdentifier("library.add") }
        }
        .task { await fetch() }
        .sheet(isPresented: $adding) { ExerciseFormView(mode: .create) { _ in Task { await fetch() } } }
    }

    private func fetch() async {
        switch await auth.library.exercises() {
        case .success(let items): load = .loaded(items)
        case .failure(let error): if load.value == nil { load = .failed(error.message) }
        }
    }
}

struct ExerciseRow: View {
    let exercise: Exercise

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(exercise.name).font(.headline)
            Text([exercise.sport, exercise.difficulty?.title, exercise.prescription].compactMap { $0 }.joined(separator: " · "))
                .font(.footnote).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}

struct PlansListView: View {
    @Environment(AuthStore.self) private var auth
    @State private var load: LoadState<[Plan]> = .loading
    @State private var adding = false

    var body: some View {
        LoadStateView(state: load, loading: "Загрузка планов…", failure: "Не удалось загрузить планы", retry: { Task { await fetch() } }) { items in
            List {
                if items.isEmpty {
                    ContentUnavailableView("Планов нет", systemImage: "list.bullet.clipboard", description: Text("Составьте первый план кнопкой «+»."))
                        .listRowBackground(Color.clear)
                }
                ForEach(items) { plan in
                    NavigationLink(value: LibraryRoute.plan(plan.id)) { PlanRow(plan: plan) }.accessibilityIdentifier("library.row")
                }
            }
            .refreshable { await fetch() }
            .accessibilityIdentifier("library.plans")
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { Button("Добавить", systemImage: "plus") { adding = true }.accessibilityIdentifier("library.add") }
        }
        .task { await fetch() }
        .sheet(isPresented: $adding) { PlanFormView(mode: .create) { _ in Task { await fetch() } } }
    }

    private func fetch() async {
        switch await auth.library.plans() {
        case .success(let items): load = .loaded(items)
        case .failure(let error): if load.value == nil { load = .failed(error.message) }
        }
    }
}

struct PlanRow: View {
    let plan: Plan

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(plan.name).font(.headline)
            Text([plan.sport, plan.durationMinutes.map { "\($0) мин" }].compactMap { $0 }.joined(separator: " · "))
                .font(.footnote).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}

struct TemplatesListView: View {
    @Environment(AuthStore.self) private var auth
    @State private var load: LoadState<[TaskTemplate]> = .loading
    @State private var adding = false

    var body: some View {
        LoadStateView(state: load, loading: "Загрузка шаблонов…", failure: "Не удалось загрузить шаблоны", retry: { Task { await fetch() } }) { items in
            List {
                if items.isEmpty {
                    ContentUnavailableView(
                        "Шаблонов нет", systemImage: "checklist",
                        description: Text("Сохраните задание, которое даёте часто, и потом выдавайте его в пару нажатий.")
                    )
                    .listRowBackground(Color.clear)
                }
                ForEach(items) { template in
                    NavigationLink(value: LibraryRoute.template(template)) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(template.title).font(.headline)
                            if !template.requirements.isEmpty {
                                Text("Сдать: " + template.requirements.map { $0.title.lowercased() }.joined(separator: ", "))
                                    .font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    .accessibilityIdentifier("library.row")
                }
            }
            .refreshable { await fetch() }
            .accessibilityIdentifier("library.templates")
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { Button("Добавить", systemImage: "plus") { adding = true }.accessibilityIdentifier("library.add") }
        }
        .task { await fetch() }
        .sheet(isPresented: $adding) { TaskFormView(mode: .newTemplate) { Task { await fetch() } } }
    }

    private func fetch() async {
        switch await auth.library.templates() {
        case .success(let items): load = .loaded(items)
        case .failure(let error): if load.value == nil { load = .failed(error.message) }
        }
    }
}

/// A template: what it holds, with changing and deleting.
struct TemplateDetailView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State var template: TaskTemplate
    @State private var editing = false
    @State private var confirmingDelete = false
    @State private var error: String?

    var body: some View {
        List {
            if let error { Section { Text(error).foregroundStyle(.red) } }
            Section {
                Text(template.title).font(.title3.bold()).accessibilityIdentifier("template.title")
                InfoRow(title: "Описание", text: template.description)
                if let name = template.metricName, !name.isEmpty {
                    InfoRow(title: "Показатель", text: [name, template.metricUnit].compactMap { $0 }.joined(separator: ", "))
                    if let target = template.metricTarget { InfoRow(title: "Цель", text: LocalDateFormat.number(target)) }
                }
            }
            if !template.exercises.isEmpty {
                Section("Упражнения") {
                    ForEach(template.exercises.sorted { $0.orderIndex < $1.orderIndex }) { Text($0.exerciseName ?? "Упражнение") }
                }
            }
            if !template.requirements.isEmpty {
                Section("Что нужно сдать") { ForEach(template.requirements) { Label($0.title, systemImage: "checkmark.square") } }
            }
            Section {
                Text("Чтобы дать задание по шаблону, откройте команду → «Задания» → «+» и выберите шаблон.").font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Шаблон")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Изменить", systemImage: "pencil") { editing = true }.accessibilityIdentifier("template.edit")
                    Button("Удалить", systemImage: "trash", role: .destructive) { confirmingDelete = true }.accessibilityIdentifier("template.delete")
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("Действия с шаблоном")
                .accessibilityIdentifier("template.actions")
            }
        }
        .sheet(isPresented: $editing) { TaskFormView(mode: .editTemplate(template)) { Task { await reload() } } }
        .confirmationDialog("Удалить шаблон?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Удалить", role: .destructive) { Task { await delete() } }
        } message: {
            Text("Уже выданные по нему задания останутся.")
        }
    }

    private func reload() async {
        switch await auth.library.templates() {
        case .success(let all): if let fresh = all.first(where: { $0.id == template.id }) { template = fresh }
        case .failure(let failure): error = failure.message
        }
    }

    private func delete() async {
        if let failure = await auth.library.deleteTemplate(template.id).failure { error = failure.message } else { dismiss() }
    }
}
