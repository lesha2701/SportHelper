import SportArenaKit
import SwiftUI

/// Creating a team, or editing the details of one.
struct TeamFormView: View {
    enum Mode {
        case create
        case edit(Team)
    }

    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let mode: Mode
    let onSaved: (Team) -> Void

    @State private var name = ""
    @State private var sport = ""
    @State private var age = ""
    @State private var level: TeamLevel?
    @State private var details = ""
    @State private var saving = false
    @State private var error: String?
    @State private var loaded = false

    private var input: TeamInput? { TeamInput(name: name, sport: sport, description: details, ageCategory: age, level: level) }
    private var isCreate: Bool { if case .create = mode { true } else { false } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Название", text: $name).accessibilityIdentifier("teamForm.name")
                    TextField("Вид спорта", text: $sport).accessibilityIdentifier("teamForm.sport")
                    TextField("Возрастная группа (необязательно)", text: $age)
                    Picker("Уровень", selection: $level) {
                        Text("Не указан").tag(TeamLevel?.none)
                        ForEach(TeamLevel.allCases) { Text($0.title).tag(TeamLevel?.some($0)) }
                    }
                }
                Section("Описание") {
                    TextField("О команде (необязательно)", text: $details, axis: .vertical).lineLimit(3...8)
                    if details.count > TeamInput.maxDescription {
                        Text("Не длиннее \(TeamInput.maxDescription) символов.").font(.footnote).foregroundStyle(.red)
                    }
                }
                if let error { Section { Text(error).foregroundStyle(.red).accessibilityIdentifier("teamForm.error") } }
            }
            .navigationTitle(isCreate ? "Новая команда" : "Команда")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isCreate ? "Создать" : "Сохранить") { Task { await save() } }
                        .disabled(input == nil || saving)
                        .accessibilityIdentifier("teamForm.save")
                }
            }
            .onAppear(perform: fill)
        }
    }

    private func fill() {
        guard !loaded else { return }
        loaded = true
        if case .edit(let team) = mode {
            name = team.name
            sport = team.sport
            age = team.ageCategory ?? ""
            level = team.level
            details = team.description ?? ""
        }
    }

    private func save() async {
        guard let input else { return }
        saving = true
        defer { saving = false }
        let result: Result<Team, APIError>
        switch mode {
        case .create: result = await auth.teams.create(input)
        case .edit(let team): result = await auth.teams.update(team, input)
        }
        switch result {
        case .success(let team):
            onSaved(team)
            dismiss()
        case .failure(let failure):
            error = failure.message
        }
    }
}
