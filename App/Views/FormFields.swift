import SportArenaKit
import SwiftUI

/// A whole-number field that may be left empty (the keyboard allows digits only).
struct OptionalIntField: View {
    let title: String
    @Binding var value: Int?
    var identifier = ""
    @State private var text = ""

    var body: some View {
        TextField(title, text: $text)
            .keyboardType(.numberPad)
            .accessibilityIdentifier(identifier)
            .onAppear { text = value.map(String.init) ?? "" }
            .onChange(of: text) { _, new in
                let trimmed = new.trimmingCharacters(in: .whitespaces)
                value = trimmed.isEmpty ? nil : Int(trimmed)
            }
    }
}

/// The sports of the site, plus the value an older record may hold.
struct SportPicker: View {
    @Binding var sport: String
    var identifier = "sport"

    var body: some View {
        Picker("Вид спорта", selection: $sport) {
            if sport.isEmpty { Text("Выберите").tag("") }
            ForEach(CommonSports.all + (sport.isEmpty || CommonSports.all.contains(sport) ? [] : [sport]), id: \.self) { Text($0).tag($0) }
        }
        .accessibilityIdentifier(identifier)
    }
}

/// A line "Название — значение" that is left out when there is no value.
struct InfoRow: View {
    let title: String
    let text: String?

    var body: some View {
        if let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.footnote).foregroundStyle(.secondary)
                Text(text)
            }
            .accessibilityElement(children: .combine)
        }
    }
}

/// Opening an exercise or a plan to the teams the person runs (the members of such a team then read it).
struct ShareTeamsSection: View {
    @Environment(AuthStore.self) private var auth
    let sharedTeamIds: [UUID]
    let toggle: (UUID, Bool) async -> String?
    @State private var busy: UUID?
    @State private var error: String?

    private var teams: [Team] { auth.teams.mine.loadedTeams.filter(\.canManage) }

    var body: some View {
        if !teams.isEmpty {
            Section {
                ForEach(teams) { team in
                    Toggle(team.name, isOn: Binding(
                        get: { sharedTeamIds.contains(team.id) },
                        set: { on in Task { await change(team, on) } }
                    ))
                    .disabled(busy != nil)
                    .accessibilityIdentifier("share.team")
                }
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
            } header: {
                Text("Доступно командам")
            } footer: {
                Text("Игроки этих команд увидят это в разделе команды.")
            }
        }
    }

    private func change(_ team: Team, _ on: Bool) async {
        busy = team.id
        defer { busy = nil }
        error = await toggle(team.id, on)
    }
}

/// What a screen shows while one thing loads from the server: a spinner, the error with "Повторить", or the content.
struct LoadStateView<Value, Content: View>: View {
    let state: LoadState<Value>
    let loading: String
    let failure: String
    let retry: () -> Void
    @ViewBuilder let content: (Value) -> Content

    var body: some View {
        switch state {
        case .loading:
            ProgressView(loading)
        case .failed(let message):
            ContentUnavailableView {
                Label(failure, systemImage: "exclamationmark.triangle")
            } description: {
                Text(message)
            } actions: {
                Button("Повторить", action: retry)
            }
        case .loaded(let value):
            content(value)
        }
    }
}
