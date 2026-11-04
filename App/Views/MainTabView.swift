import SwiftUI
import SportArenaKit

/// The signed-in app: the same sections as the site (Главная, Команды, Календарь, Тренеры, Профиль).
struct MainTabView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.scenePhase) private var scenePhase
    let user: AuthUser

    var body: some View {
        @Bindable var router = auth.router
        return TabView(selection: $router.tab) {
            ComingSoonView(title: "Главная", symbol: "house", text: "Здесь будут ближайшие тренировки и задания.")
                .tabItem { Label("Главная", systemImage: "house") }
                .tag(AppTab.home)
            TeamsView(user: user)
                .tabItem { Label("Команды", systemImage: "trophy") }
                .badge(auth.chatUnread.teamTotal)
                .tag(AppTab.teams)
            CalendarView(store: auth.calendar)
                .tabItem { Label("Календарь", systemImage: "calendar") }
                .tag(AppTab.calendar)
            CoachesView(store: auth.coaches)
                .tabItem { Label("Тренеры", systemImage: "person.2") }
                .tag(AppTab.coaches)
            ProfileView(user: user, store: auth.profile)
                .tabItem { Label("Профиль", systemImage: "person.crop.circle") }
                .badge(auth.chatUnread.bookingTotal)
                .tag(AppTab.profile)
        }
        // Unread counts are refreshed while the app is on screen.
        .task(id: scenePhase == .active) {
            if scenePhase == .active { await auth.chatUnread.keepFresh() }
        }
    }
}
