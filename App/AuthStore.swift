import Foundation
import Observation
import SportArenaKit

/// Who is signed in, for the whole app. One place decides which screen to show: loading, sign-in or the app.
@MainActor
@Observable
final class AuthStore {
    enum State: Equatable {
        case starting
        case signedOut
        case signedIn(AuthUser)
    }

    private(set) var state: State = .starting
    private(set) var features = ServerFeatures()
    /// Shown under the sign-in form (the server's own Russian text).
    var errorMessage: String?
    private(set) var isWorking = false

    let client: APIClient
    private let service: AuthService

    init(environment: AppEnvironment) {
        let holder = ExpiryHolder()
        let client = APIClient(baseURL: environment.baseURL, onSessionExpired: { holder.fire() })
        self.client = client
        self.service = AuthService(client: client)
        holder.action = { [weak self] in Task { @MainActor in self?.sessionEnded() } }
    }

    /// On launch: a stored cookie either still works (the person is in) or the server says 401 (show sign-in).
    func start() async {
        features = (try? await service.features()) ?? ServerFeatures()
        do {
            state = .signedIn(try await service.currentUser())
        } catch {
            state = .signedOut
        }
    }

    func login(email: String, password: String) async {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            state = .signedIn(try await service.login(email: email, password: password))
        } catch let error as APIError {
            errorMessage = error.message
        } catch {
            errorMessage = APIError.unknown.message
        }
    }

    func logout() async {
        try? await service.logout()
        state = .signedOut
    }

    private func sessionEnded() {
        if case .signedIn = state { state = .signedOut }
    }
}

/// Lets the (non-isolated) client call back into the main-actor store.
private final class ExpiryHolder: @unchecked Sendable {
    var action: (() -> Void)?
    func fire() { action?() }
}
