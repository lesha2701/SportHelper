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
}

/// Lets any screen send the person elsewhere (after booking: to "Мои брони") without knowing how the app is laid out.
@MainActor
@Observable
final class Router {
    var tab: AppTab = .home
    var profilePath: [ProfileRoute] = []

    func open(_ route: ProfileRoute) {
        profilePath = [route]
        tab = .profile
    }

    func reset() {
        tab = .home
        profilePath = []
    }
}
