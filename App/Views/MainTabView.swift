import SwiftUI
import SportArenaKit

/// The signed-in app: the same sections as the site (Главная, Команды, Календарь, Тренеры, Профиль).
struct MainTabView: View {
    @Environment(AuthStore.self) private var auth
    let user: AuthUser

    var body: some View {
        TabView {
            ComingSoonView(title: "Главная", symbol: "house", text: "Здесь будут ближайшие тренировки и задания.")
                .tabItem { Label("Главная", systemImage: "house") }
            ComingSoonView(title: "Команды", symbol: "trophy", text: "Составы команд, приглашения и чат команды.")
                .tabItem { Label("Команды", systemImage: "trophy") }
            ComingSoonView(title: "Календарь", symbol: "calendar", text: "Тренировки, матчи и сроки заданий.")
                .tabItem { Label("Календарь", systemImage: "calendar") }
            ComingSoonView(title: "Тренеры", symbol: "person.2", text: "Каталог тренеров, запись на личные тренировки и оплата.")
                .tabItem { Label("Тренеры", systemImage: "person.2") }
            ProfileView(user: user, store: auth.profile)
                .tabItem { Label("Профиль", systemImage: "person.crop.circle") }
        }
    }
}
