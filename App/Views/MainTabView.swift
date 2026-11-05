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

    var body: some View {
        @Bindable var router = auth.router
        return TabView(selection: $router.tab) {
            HomeView(user: user)
                .tabItem { Label("Главная", systemImage: "house") }
                .tag(AppTab.home)
            TeamsView(user: user)
                .tabItem { Label("Команды", systemImage: "trophy") }
                .badge(auth.chatUnread.teamTotal)
                .tag(AppTab.teams)
            if user.isCoach {
                LibraryView()
                    .tabItem { Label("Библиотека", systemImage: "book") }
                    .tag(AppTab.library)
            }
            CalendarView(store: auth.calendar)
                .tabItem { Label("Календарь", systemImage: "calendar") }
                .tag(AppTab.calendar)
            if !user.isCoach {
                CoachesView(store: auth.coaches)
                    .tabItem { Label("Тренеры", systemImage: "person.2") }
                    .tag(AppTab.coaches)
            }
            ProfileView(user: user, store: auth.profile)
                .tabItem { Label("Профиль", systemImage: "person.crop.circle") }
                .badge(auth.chatUnread.bookingTotal)
                .tag(AppTab.profile)
        }
        .toolbar(.hidden, for: .tabBar)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            SagTabBar(items: bar, selection: $router.tab)
        }
        // Unread counts are refreshed while the app is on screen.
        .task(id: scenePhase == .active) {
            if scenePhase == .active { await auth.chatUnread.keepFresh() }
        }
        .task(id: scenePhase == .active) {
            if scenePhase == .active { await auth.notifications.keepFresh() }
        }
    }
}
