import SwiftUI
import SportArenaKit

/// The signed-in app: the same sections as the site (Главная, Команды, Календарь, Тренеры, Профиль).
struct MainTabView: View {
    @Environment(AuthStore.self) private var auth
    let user: AuthUser

    var body: some View {
        @Bindable var router = auth.router
        return TabView(selection: $router.tab) {
            ComingSoonView(title: "Главная", symbol: "house", text: "Здесь будут ближайшие тренировки и задания.")
                .tabItem { Label("Главная", systemImage: "house") }
                .tag(AppTab.home)
            ComingSoonView(title: "Команды", symbol: "trophy", text: "Составы команд, приглашения и чат команды.")
                .tabItem { Label("Команды", systemImage: "trophy") }
                .tag(AppTab.teams)
            CalendarView(store: auth.calendar)
                .tabItem { Label("Календарь", systemImage: "calendar") }
                .tag(AppTab.calendar)
            CoachesView(store: auth.coaches)
                .tabItem { Label("Тренеры", systemImage: "person.2") }
                .tag(AppTab.coaches)
            ProfileView(user: user, store: auth.profile)
                .tabItem { Label("Профиль", systemImage: "person.crop.circle") }
                .tag(AppTab.profile)
        }
    }
}
