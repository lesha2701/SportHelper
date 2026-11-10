import SportArenaKit
import SwiftUI

/// Asking to delete the account (required by the App Store). The server keeps the account for a grace period, so this can be undone.
struct DeleteAccountView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth

    @State private var password = ""
    @State private var isWorking = false
    @State private var errorMessage: String?
    @State private var doneMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                if let doneMessage {
                    Section {
                        Label(doneMessage, systemImage: "checkmark.circle").accessibilityIdentifier("delete.done")
                        Button("Закрыть") { dismiss() }
                    }
                } else {
                    Section {
                        Text("Аккаунт и ваши данные будут удалены. Пока не закончился срок хранения, удаление можно отменить в профиле.")
                    }
                    Section(sag: "Подтвердите паролем") {
                        SecureField("Пароль", text: $password).textContentType(.password).accessibilityIdentifier("delete.password")
                        if let errorMessage { Text(errorMessage).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("delete.error") }
                    }
                    Section {
                        Button("Удалить аккаунт", role: .destructive) { Task { await submit() } }
                            .disabled(password.isEmpty || isWorking)
                            .accessibilityIdentifier("delete.confirm")
                    }
                }
            }
            .sagScreen()
            .navigationTitle("Удаление аккаунта")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if doneMessage == nil { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } } }
            }
        }
    }

    private func submit() async {
        errorMessage = nil
        isWorking = true
        defer { isWorking = false }
        do {
            doneMessage = try await auth.requestAccountDeletion(password: password)
        } catch let error as APIError {
            errorMessage = error.message
        } catch {
            errorMessage = APIError.unknown.message
        }
    }
}
