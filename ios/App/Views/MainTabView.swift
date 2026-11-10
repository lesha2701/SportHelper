import SwiftUI
import SportArenaKit

/// The signed-in app: «Главная», «Команды», «Календарь», «Профиль», and «Тренеры» for a player or «Библиотека» for a coach (a phone's
/// tab bar holds five; a coach reaches the catalogue of trainers from the profile).
struct MainTabView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.scenePhase) private var scenePhase
    let user: AuthUser

    private var bar: [SagTabBar.Item] {
        var items = [
            SagTabBar.Item(tab: .home, title: "Главная", symbol: "house"),
            SagTabBar.Item(tab: .teams, title: "Команды", symbol: "trophy", badge: auth.chatUnread.teamTotal),
        ]
        if user.isCoach { items.append(SagTabBar.Item(tab: .library, title: "Библиотека", symbol: "book")) }
        items.append(SagTabBar.Item(tab: .calendar, title: "Календарь", symbol: "calendar"))
        if !user.isCoach { items.append(SagTabBar.Item(tab: .coaches, title: "Тренеры", symbol: "person.2")) }
        items.append(SagTabBar.Item(tab: .profile, title: "Профиль", symbol: "person.crop.circle", badge: auth.chatUnread.bookingTotal))
        return items
    }

    /// The tabs this person has, in the order of the bar.
    private var tabs: [AppTab] { bar.map(\.tab) }

    /// The tabs that were opened so far stay alive (their screens keep their place and what they loaded); the others are made only when
    /// the person first goes there.
    @State private var opened: Set<AppTab> = []

    var body: some View {
        @Bindable var router = auth.router
        let current = tabs.contains(router.tab) ? router.tab : .home
        // Not the system's TabView: on an iPad, and on a Mac that runs the iPhone app, it adds a tab bar of its own that cannot be hidden,
        // and the app would have two. The bar below is the only one.
        // The bar is laid out under the screens, not added as a safe-area inset: a screen inside a navigation stack (a chat) did not get the
        // inset, and its composer ended up behind the bar. The keyboard is ignored by the whole column and covers the bar; the screens above
        // it make room for the keyboard themselves.
        return VStack(spacing: 0) {
            ZStack {
                ForEach(tabs, id: \.self) { tab in
                    if tab == current || opened.contains(tab) {
                        content(of: tab)
                            .id(router.resets[tab, default: 0])
                            .opacity(tab == current ? 1 : 0)
                            .allowsHitTesting(tab == current)
                            .accessibilityHidden(tab != current)
                    }
                }
            }
            SagTabBar(items: bar, selection: $router.tab) { router.reselect($0) }
        }
        .ignoresSafeArea(.keyboard)
        .onChange(of: current, initial: true) { _, tab in opened.insert(tab) }
        // Unread counts are refreshed while the app is on screen.
        .task(id: scenePhase == .active) {
            if scenePhase == .active { await auth.chatUnread.keepFresh() }
        }
        .task(id: scenePhase == .active) {
            if scenePhase == .active { await auth.notifications.keepFresh() }
        }
    }

    @ViewBuilder private func content(of tab: AppTab) -> some View {
        switch tab {
        case .home: HomeView(user: user)
        case .teams: TeamsView(user: user)
        case .library: LibraryView()
        case .calendar: CalendarView(store: auth.calendar)
        case .coaches: CoachesView(store: auth.coaches)
        case .profile: ProfileView(user: user, store: auth.profile)
        }
    }
}
