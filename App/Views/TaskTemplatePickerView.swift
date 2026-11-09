import SportArenaKit
import SwiftUI

/// The templates of the coach's library, to start a task from one.
struct TaskTemplatePickerView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let onPick: (TaskTemplate) -> Void
    @State private var load: LoadState<[TaskTemplate]> = .loading

    var body: some View {
        NavigationStack {
            Group {
                switch load {
                case .loading:
                    ProgressView("Загрузка…")
                case .failed(let message):
                    ContentUnavailableView {
                        Label("Не удалось загрузить библиотеку", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(message)
                    } actions: {
                        Button("Повторить") { Task { await fetch() } }
                    }
                case .loaded(let templates) where templates.isEmpty:
                    ContentUnavailableView(
                        "В библиотеке нет заданий", systemImage: "books.vertical",
                        description: Text("Шаблон — заготовка задания, которую можно назначать командам. Создайте его: Библиотека → «Шаблоны заданий» → «+».")
                    )
                    .accessibilityIdentifier("taskPicker.empty")
                case .loaded(let templates):
                    List(templates) { template in
                        Button {
                            onPick(template)
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(template.title).font(.headline).foregroundStyle(.primary)
                                if !template.requirements.isEmpty {
                                    Text("Сдать: " + template.requirements.map { $0.title.lowercased() }.joined(separator: ", "))
                                        .font(.footnote).foregroundStyle(.secondary)
                                }
                            }
                        }
                        .accessibilityIdentifier("taskPicker.template")
                    }
                    .sagScreen()
                }
            }
            .sagScreen()
            .navigationTitle("Задание из библиотеки")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } } }
            .task { await fetch() }
        }
    }

    private func fetch() async {
        switch await auth.library.templates() {
        case .success(let list): load = .loaded(list)
        case .failure(let error): load = .failed(error.message)
        }
    }
}
