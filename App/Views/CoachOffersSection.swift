import SwiftUI

/// A coach's offers to the players: their listings, the money from them, and the catalogue they appear in. (A phone's tab bar holds five
/// tabs: a coach has «Библиотека» in the place of «Тренеры», so the catalogue is reached from here.)
struct CoachOffersSection: View {
    @Environment(AuthStore.self) private var auth

    var body: some View {
        Section(sag: "Объявления") {
            NavigationLink(value: ProfileRoute.myListings) { Label("Мои объявления", systemImage: "megaphone") }
                .accessibilityIdentifier("profile.myListings")
            if auth.features.trainerBalance { FinanceLink() }
            NavigationLink(value: ProfileRoute.coachCatalog) { Label("Каталог тренеров", systemImage: "person.2") }
                .accessibilityIdentifier("profile.coachCatalog")
        }
    }
}
