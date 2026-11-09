import SportArenaKit
import SwiftUI

/// The coach picks which of their own exercises or plans this team can read.
struct TeamLibraryShareSheet: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let team: Team
    let plans: Bool
    let onChange: () -> Void
    @State private var exercises: LoadState<[Exercise]> = .loading
    @State private var planList: LoadState<[Plan]> = .loading
    @State private var shared: Set<UUID> = []
    @State private var busy: UUID?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if plans {
                    LoadStateView(state: planList, loading: "Загрузка планов…", failure: "Не удалось загрузить планы", retry: reload) { items in
                        content(items.map { ($0.id, $0.name, $0.sharedTeamIds) }, empty: "В вашей библиотеке пока нет планов.")
                    }
                } else {
                    LoadStateView(state: exercises, loading: "Загрузка упражнений…", failure: "Не удалось загрузить упражнения", retry: reload) { items in
                        content(items.map { ($0.id, $0.name, $0.sharedTeamIds) }, empty: "В вашей библиотеке пока нет упражнений.")
                    }
                }
            }
            .sagScreen()
            .navigationTitle(plans ? "Открыть планы команде" : "Открыть упражнения команде")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { dismiss() }.accessibilityIdentifier("teamLibrary.shareDone") } }
            .task { await load() }
        }
    }

    private func reload() { Task { await load() } }

    private func content(_ items: [(UUID, String, [UUID])], empty: String) -> some View {
        List {
            if items.isEmpty {
                Text(empty + " Создайте их во вкладке «Библиотека».").foregroundStyle(.secondary)
            } else {
                Section {
                    ForEach(items, id: \.0) { item in
                        Toggle(item.1, isOn: Binding(
                            get: { shared.contains(item.0) },
                            set: { on in Task { await change(item.0, on) } }
                        ))
                        .disabled(busy != nil)
                        .accessibilityIdentifier("teamLibrary.shareToggle")
                    }
                    if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                } footer: {
                    Text("Включённое увидят все участники команды «\(team.name)» в разделе «Упражнения и планы».")
                }
            }
        }
        .onAppear {
            shared = Set(items.filter { $0.2.contains(team.id) }.map { $0.0 })
        }
    }

    private func change(_ id: UUID, _ on: Bool) async {
        busy = id
        defer { busy = nil }
        error = nil
        let failure: String?
        if plans {
            if case .failure(let e) = await auth.library.sharePlan(id, team: team.id, on: on) { failure = e.message } else { failure = nil }
        } else {
            if case .failure(let e) = await auth.library.shareExercise(id, team: team.id, on: on) { failure = e.message } else { failure = nil }
        }
        if let failure {
            error = failure
        } else {
            if on { shared.insert(id) } else { shared.remove(id) }
            onChange()
        }
    }

    private func load() async {
        if plans {
            switch await auth.library.plans() {
            case .success(let items): planList = .loaded(items)
            case .failure(let e): planList = .failed(e.message)
            }
        } else {
            switch await auth.library.exercises() {
            case .success(let items): exercises = .loaded(items)
            case .failure(let e): exercises = .failed(e.message)
            }
        }
    }
}
