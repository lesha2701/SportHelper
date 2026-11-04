import SwiftUI
import SportArenaKit

/// The signed-in app. For now only the profile card and sign-out: the real tabs come with the next steps.
struct MainView: View {
    @Environment(AuthStore.self) private var auth
    let user: AuthUser

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Имя", value: user.fullName)
                    LabeledContent("Роль", value: user.isCoach ? "Тренер" : "Игрок")
                    if let email = user.email { LabeledContent("Email", value: email) }
                }
                Section {
                    Button("Выйти из аккаунта", role: .destructive) { Task { await auth.logout() } }
                        .accessibilityIdentifier("main.logout")
                }
            }
            .navigationTitle("Профиль")
        }
    }
}
