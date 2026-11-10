import SportArenaKit
import SwiftUI

/// The head coach hands the role to another member of the team. The coach stays in the team as an assistant coach.
/// The site asks to type a long sentence; here the person picks someone and confirms in a dialog, and the app writes the sentence.
struct TransferOwnershipView: View {
    @Environment(\.dismiss) private var dismiss
    let teamName: String
    let candidates: [TeamMember]
    /// Hands the role over; nil when it went through, otherwise the text of what went wrong.
    let transfer: (TeamMember) async -> String?

    @State private var chosen: UUID?
    @State private var confirming = false
    @State private var working = false
    @State private var error: String?

    private var selected: TeamMember? { candidates.first { $0.userId == chosen } }

    var body: some View {
        NavigationStack {
            Form {
                if candidates.isEmpty {
                    Section { Text("Некому передать роль: в команде пока нет других участников.").foregroundStyle(.secondary) }
                } else {
                    Section {
                        ForEach(candidates) { member in
                            Button { chosen = member.userId } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(member.fullName).foregroundStyle(Theme.text)
                                        Text(member.role.title).font(.footnote).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if chosen == member.userId { Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.primary) }
                                }
                            }
                            .accessibilityAddTraits(chosen == member.userId ? .isSelected : [])
                            .accessibilityIdentifier("transfer.candidate")
                        }
                    } header: {
                        Text("Кому передать")
                    } footer: {
                        Text("Новый главный тренер получит все права управления командой. Вы останетесь в команде помощником тренера.")
                    }
                    if let error {
                        Section { Text(error).foregroundStyle(.red).accessibilityIdentifier("transfer.error") }
                    }
                    Section {
                        Button("Передать роль", role: .destructive) { confirming = true }
                            .disabled(selected == nil || working)
                            .accessibilityIdentifier("transfer.submit")
                    }
                }
            }
            .sagScreen()
            .navigationTitle("Передать роль")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() }.disabled(working) } }
            .confirmationDialog(
                "Передать роль главного тренера?", isPresented: $confirming, titleVisibility: .visible
            ) {
                Button("Передать роль", role: .destructive) { Task { await run() } }.accessibilityIdentifier("transfer.confirm")
            } message: {
                Text("\(selected?.fullName ?? "Участник") станет главным тренером команды «\(teamName)». Вернуть роль сможет только он.")
            }
        }
    }

    private func run() async {
        guard let selected else { return }
        working = true
        error = nil
        defer { working = false }
        if let failure = await transfer(selected) { error = failure } else { dismiss() }
    }
}
