import Foundation
import Observation
import SportArenaKit

/// Who is signed in, for the whole app. One place decides which screen to show: loading, sign-in or the app.
@MainActor
@Observable
final class AuthStore {
    enum State: Equatable {
        case starting
        /// The server could not be reached at launch; the saved session is kept.
        case unreachable(String)
        case signedOut
        case signedIn(AuthUser)
    }

    private(set) var state: State = .starting
    private(set) var features = ServerFeatures()
    /// Shown under the sign-in form (the server's own Russian text).
    var errorMessage: String?
    private(set) var isWorking = false

    let client: APIClient
    /// The signed-in person's profile data; emptied on sign-out so the next person never sees it.
    let profile: ProfileStore
    let calendar: CalendarStore
    private let service: AuthService
    private let persistence: SessionPersistence

    init(environment: AppEnvironment) {
        let holder = ExpiryHolder()
        let client = APIClient(baseURL: environment.baseURL, onSessionExpired: { holder.fire() })
        self.client = client
        self.profile = ProfileStore(client: client)
        self.calendar = CalendarStore(client: client)
        self.service = AuthService(client: client)
        self.persistence = SessionPersistence(
            store: KeychainSecretStore(service: "ru.sportarenaglobal.app", account: "session-cookie"), baseURL: environment.baseURL
        )
        holder.action = { [weak self] in Task { @MainActor in self?.sessionEnded() } }
    }

    /// On launch: a stored cookie either still works (the person is in) or the server says 401 (show sign-in).
    func start() async {
        persistence.restore()  // the session survives the app being closed
        features = (try? await service.features()) ?? ServerFeatures()
        do {
            state = .signedIn(try await service.currentUser())
            persistence.save()
        } catch let error as APIError where error.isSessionExpired {
            // The server itself says there is no session (it ended, or the person signed out elsewhere): forget it.
            persistence.clear()
            state = .signedOut
        } catch let error as APIError {
            // No network, a server hiccup: the saved session may be perfectly good, so keep it and let the person retry.
            state = .unreachable(error.message)
        } catch {
            state = .unreachable(APIError.unknown.message)
        }
    }

    func login(email: String, password: String) async {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            state = .signedIn(try await service.login(email: email, password: password))
            persistence.save()
        } catch let error as APIError {
            errorMessage = error.message
        } catch {
            errorMessage = APIError.unknown.message
        }
    }

    /// The signed-in person, when there is one.
    var user: AuthUser? {
        if case .signedIn(let user) = state { return user }
        return nil
    }

    /// Reads the account again (after an avatar change, after asking to delete the account).
    func refreshUser() async {
        guard let fresh = try? await service.currentUser() else { return }
        if case .signedIn = state { state = .signedIn(fresh) }
    }

    /// Asks to delete the account. Returns the server's explanation, throws its `APIError` (a wrong password, for one).
    func requestAccountDeletion(password: String) async throws -> String {
        let message = try await service.requestAccountDeletion(password: password)
        await refreshUser()
        return message
    }

    func cancelAccountDeletion() async throws {
        try await service.cancelAccountDeletion()
        await refreshUser()
    }

    func logout() async {
        try? await service.logout()
        persistence.clear()
        profile.reset()
        calendar.reset()
        state = .signedOut
    }

    private func sessionEnded() {
        if case .signedIn = state {
            persistence.clear()
            profile.reset()
            calendar.reset()
            state = .signedOut
        }
    }
}

/// Lets the (non-isolated) client call back into the main-actor store.
private final class ExpiryHolder: @unchecked Sendable {
    var action: (() -> Void)?
    func fire() { action?() }
}
