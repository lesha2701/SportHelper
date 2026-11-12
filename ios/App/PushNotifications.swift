import Observation
import SportArenaKit
import UIKit
import UserNotifications

/// Push notifications (docs/push.md): the system hands the app a token, the app gives it to the server, and a tap on a push opens
/// the screen it is about. Everything is best effort: with notifications refused, on a simulator, or in a build without the push
/// capability the bell inside the app still shows everything.
@MainActor
@Observable
final class PushCenter {
    static let shared = PushCenter()

    /// The token the system issued for this installation (nil until it does).
    private(set) var token: String?
    /// A push the person tapped, waiting for the signed-in app to open its screen (the tap can arrive before the screens exist).
    var pendingTap: PushPayload?
    /// Called with every token the system issues, including a replacement.
    @ObservationIgnored var onToken: ((String) -> Void)?

    func tokenArrived(_ token: String) {
        self.token = token
        onToken?(token)
    }

    func tapped(_ payload: PushPayload?) { pendingTap = payload }

    /// Asks the person for permission (the system shows its own question once) and, if allowed, asks the system for a token.
    func start() async {
        let center = UNUserNotificationCenter.current()
        guard (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) == true else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = DevicesService.hex(deviceToken)
        Task { @MainActor in PushCenter.shared.tokenArrived(token) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // A simulator, or a build without the push capability: nothing to do, the bell still works.
    }

    /// A push that arrives while the app is open is shown as a banner too.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let payload = PushPayload(userInfo: response.notification.request.content.userInfo)
        await MainActor.run { PushCenter.shared.tapped(payload) }
    }
}

extension Router {
    /// Opens the screen a tapped push is about. What has no screen of its own here (a training, a match, a task, a team chat) opens the
    /// notification feed, where the same notification is one tap away.
    func open(push target: NotificationTarget) {
        switch target {
        case .incomingBookings: open(.incomingRequests)
        case .myBookings, .reviewBooking: open(.myBookings)
        case .bookingChat(let id): open(.bookingChat(id))
        case .finance: open(.finance)
        case .training, .match, .task, .teamChat, .newPersonalTraining: open(.notifications)
        case .none: break
        }
    }
}
