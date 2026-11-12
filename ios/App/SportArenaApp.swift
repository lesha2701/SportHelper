import SwiftUI
import SportArenaKit

@main
struct SportArenaApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var auth = AuthStore(environment: .current)
    @State private var appearance = AppearanceStore()

    init() { Chrome.apply() }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .environment(appearance)
                .preferredColorScheme(appearance.choice.scheme)
                .tint(Theme.primary)
                // the app is Russian only: date pickers and system buttons speak Russian whatever the phone's language is
                .environment(\.locale, Locale(identifier: "ru_RU"))
                .task { await auth.start() }
        }
    }
}
