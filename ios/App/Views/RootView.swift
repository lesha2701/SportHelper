import SwiftUI

struct RootView: View {
    @Environment(AuthStore.self) private var auth
    /// The person who closed the tour in this run: it stays closed even if saving that on the account failed.
    @State private var tourClosedFor: UUID?

    var body: some View {
        content
            // lists and forms show the site's background, not the system's grey
            .scrollContentBackground(.hidden)
            .background(Theme.bg.ignoresSafeArea())
    }

    @ViewBuilder private var content: some View {
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
                .fullScreenCover(isPresented: Binding(get: { user.needsOnboarding && tourClosedFor != user.id }, set: { _ in })) {
                    WelcomeGuideView(ownRole: user.isCoach ? "coach" : "player") {
                        tourClosedFor = user.id
                        Task { await auth.finishOnboarding() }
                    }
                }
        }
    }
}
