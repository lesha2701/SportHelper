import Observation
import SwiftUI

enum AppTab: Hashable {
    case home, library, teams, calendar, coaches, profile
}

/// Where inside the profile a screen lives ("Мои брони" and the coach's requests are reached from the profile, like on the site).
enum ProfileRoute: Hashable {
    case myBookings
    case incomingRequests
    case coachBookings
    case bookingChat(UUID)
    case myTasks
    case coachCatalog
    case myStats
    case notifications
    case myListings
    case accountSecurity
    case privacy
    case finance
    case legalDocuments
    case myAchievements
}

/// Lets any screen send the person elsewhere (after booking: to "Мои брони") without knowing how the app is laid out.
@MainActor
@Observable
final class Router {
    var tab: AppTab = .home
    var profilePath: [ProfileRoute] = []
    /// Bumped when the person taps the tab they are already on: the tab's screens are made again, so it shows its first screen.
    private(set) var resets: [AppTab: Int] = [:]

    /// A second tap on the current tab returns it to its start, as on any iPhone.
    func reselect(_ tab: AppTab) {
        if tab == .profile { profilePath = [] }
        resets[tab, default: 0] += 1
    }

    func open(_ route: ProfileRoute) {
        profilePath = [route]
        tab = .profile
    }

    func reset() {
        tab = .home
        profilePath = []
    }
}
