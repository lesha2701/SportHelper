import SwiftUI
import SportArenaKit

@main
struct SportArenaApp: App {
    @State private var auth = AuthStore(environment: .current)

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .tint(Theme.primary)
                .task { await auth.start() }
        }
    }
}
