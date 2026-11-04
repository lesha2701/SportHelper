import SwiftUI
import SportArenaKit

/// The signed-in app: «Главная», «Команды», «Календарь», «Профиль», and «Тренеры» for a player or «Библиотека» for a coach (a phone's
/// tab bar holds five; a coach reaches the catalogue of trainers from the profile).
struct MainTabView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.scenePhase) private var scenePhase
    let user: AuthUser

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
        // Unread counts are refreshed while the app is on screen.
        .task(id: scenePhase == .active) {
            if scenePhase == .active { await auth.chatUnread.keepFresh() }
        }
    }
}
