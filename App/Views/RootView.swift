import SwiftUI

struct RootView: View {
    @Environment(AuthStore.self) private var auth

    var body: some View {
        switch auth.state {
        case .starting:
            ProgressView("Загрузка…")
        case .unreachable(let message):
            ContentUnavailableView {
                Label("Нет связи с сервером", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Повторить") { Task { await auth.start() } }
                    .accessibilityIdentifier("root.retry")
            }
        case .signedOut:
            LoginView()
        case .signedIn(let user):
            MainTabView(user: user)
        }
    }
}
