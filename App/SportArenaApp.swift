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
                // the app is Russian only: date pickers and system buttons speak Russian whatever the phone's language is
                .environment(\.locale, Locale(identifier: "ru_RU"))
                .task { await auth.start() }
        }
    }
}
