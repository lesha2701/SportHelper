import SwiftUI
import SportArenaKit

/// The signed-in app: the same sections as the site (Главная, Команды, Календарь, Тренеры, Профиль). A coach also has the Библиотека.
/// The tab bar of a phone holds five, so until «Главная» has content (it is a placeholder) the coach's «Библиотека» takes its place.
struct MainTabView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.scenePhase) private var scenePhase
    let user: AuthUser

    var body: some View {
        @Bindable var router = auth.router
        return TabView(selection: $router.tab) {
            if user.isCoach {
                LibraryView()
                    .tabItem { Label("Библиотека", systemImage: "book") }
                    .tag(AppTab.library)
            } else {
                ComingSoonView(title: "Главная", symbol: "house", text: "Здесь будут ближайшие тренировки и задания.")
                    .tabItem { Label("Главная", systemImage: "house") }
                    .tag(AppTab.home)
            }
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
        .onAppear(perform: keepTabValid)
        .onChange(of: user.isCoach) { keepTabValid() }
        // Unread counts are refreshed while the app is on screen.
        .task(id: scenePhase == .active) {
            if scenePhase == .active { await auth.chatUnread.keepFresh() }
        }
    }

    /// The first tab is «Библиотека» for a coach and «Главная» for everybody else: the selection must name a tab that exists.
    private func keepTabValid() {
        let router = auth.router
        if user.isCoach, router.tab == .home { router.tab = .library }
        if !user.isCoach, router.tab == .library { router.tab = .home }
    }
}
