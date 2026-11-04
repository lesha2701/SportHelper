import SportArenaKit
import SwiftUI

/// Joining a team with the invitation link (or code) the coach shared.
struct JoinTeamView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var team: Team?
    @State private var token: String?
    @State private var working = false
    @State private var error: String?
    @State private var outcome: JoinResult?

    var body: some View {
        NavigationStack {
            Form {
                if let outcome {
                    resultSection(outcome)
                } else {
                    inputSection
                    if let team { teamSection(team) }
                    if let error { Section { Text(error).foregroundStyle(.red).accessibilityIdentifier("join.error") } }
                }
            }
            .navigationTitle("Вступить в команду")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(outcome == nil ? "Отмена" : "Готово") { dismiss() } } }
        }
    }

    private var inputSection: some View {
        Section {
            TextField("Ссылка или код приглашения", text: $text, axis: .vertical)
                .lineLimit(1...4)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("join.input")
                .onChange(of: text) { team = nil; token = nil; error = nil }
            PasteButton(payloadType: String.self) { strings in
                Task { @MainActor in text = strings.first ?? text }
            }
            Button { Task { await find() } } label: {
                if working { ProgressView().frame(maxWidth: .infinity) } else { Text("Найти команду").frame(maxWidth: .infinity) }
            }
            .disabled(InviteToken.parse(text) == nil || working)
            .accessibilityIdentifier("join.find")
        } footer: {
            Text("Ссылку присылает тренер команды. Она выглядит как адрес сайта со словом invite.")
        }
    }

    private func teamSection(_ team: Team) -> some View {
        Section("Команда") {
            Text(team.name).font(.headline).accessibilityIdentifier("join.teamName")
            LabeledContent("Вид спорта", value: team.sport)
            if let level = team.level { LabeledContent("Уровень", value: level.title) }
            if let text = team.description, !text.isEmpty { Text(text).font(.subheadline) }
            Button { Task { await apply() } } label: { Text("Подать заявку").bold().frame(maxWidth: .infinity) }
                .buttonStyle(.borderedProminent)
                .disabled(working)
                .accessibilityIdentifier("join.apply")
        }
    }

    private func resultSection(_ result: JoinResult) -> some View {
        Section {
            if result.joined {
                Label("Вы в команде «\(result.team.name)»", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    .accessibilityIdentifier("join.joined")
            } else {
                Label("Заявка отправлена", systemImage: "paperplane.fill").foregroundStyle(.green).accessibilityIdentifier("join.pending")
                Text("Тренер команды «\(result.team.name)» рассмотрит её. Когда вас примут, команда появится в списке.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private func find() async {
        guard let parsed = InviteToken.parse(text) else { return }
        working = true
        defer { working = false }
        switch await auth.teams.preview(parsed) {
        case .success(let found):
            team = found
            token = parsed
            error = nil
        case .failure(let failure):
            error = failure.message
        }
    }

    private func apply() async {
        guard let token else { return }
        working = true
        defer { working = false }
        switch await auth.teams.apply(token) {
        case .success(let result): outcome = result
        case .failure(let failure): error = failure.message
        }
    }
}
