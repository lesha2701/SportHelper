import SportArenaKit
import SwiftUI

/// For an administrator only: the way into the site's admin panel, and the switch between working as a coach and as a player.
struct AdminSection: View {
    @Environment(AuthStore.self) private var auth
    let user: AuthUser
    let me: ProfileMe
    let store: ProfileStore
    @State private var panel: URL?
    @State private var error: String?
    @State private var switching = false

    private var target: String { user.isCoach ? "player" : "coach" }
    private var targetTitle: String { user.isCoach ? "игрока" : "тренера" }
    private var targetExists: Bool { user.isCoach ? me.player != nil : me.coach != nil }

    var body: some View {
        Section {
            Button {
                panel = auth.adminPanelURL
            } label: {
                Label("Открыть админ-панель", systemImage: "shield")
            }
            .accessibilityIdentifier("profile.admin")
            Button {
                Task { await switchRole() }
            } label: {
                Label("Переключиться на профиль \(targetTitle)", systemImage: "arrow.left.arrow.right")
            }
            .disabled(switching)
            .accessibilityIdentifier("profile.switchRole")
            if let error { Text(error).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("profile.switchRole.error") }
        } header: {
            SagSectionHeader(title: "Администратор")
        } footer: {
            Text(targetExists
                 ? "Админ-панель откроется на сайте: вход туда отдельный, с подтверждением. Переключатель меняет, как вы работаете в приложении."
                 : "Профиля \(targetTitle) у вас ещё нет — завести его можно на сайте, в разделе «Профиль».")
        }
        .sheet(item: $panel) { SafariView(url: $0).ignoresSafeArea() }
    }

    private func switchRole() async {
        guard targetExists else {
            error = "Профиля \(targetTitle) ещё нет. Заведите его на сайте, в разделе «Профиль»."
            return
        }
        switching = true
        defer { switching = false }
        error = await store.switchMode(to: target)
        if error == nil {
            await auth.refreshUser()
            auth.router.reset()
        }
    }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}
