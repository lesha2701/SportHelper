import SwiftUI

struct RootView: View {
    @Environment(AuthStore.self) private var auth

    var body: some View {
        switch auth.state {
        case .starting:
            ProgressView("Загрузка…")
        case .signedOut:
            LoginView()
        case .signedIn(let user):
            MainView(user: user)
        }
    }
}
