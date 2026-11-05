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
    /// The server's code for that message: «email_not_verified» offers to send the letter again.
    private(set) var errorCode: String?
    private(set) var isWorking = false

    let client: APIClient
    /// The signed-in person's profile data; emptied on sign-out so the next person never sees it.
    let profile: ProfileStore
    let calendar: CalendarStore
    let coaches: CoachesStore
    let bookings: BookingsStore
    let teams: TeamsStore
    let trainings: TrainingsStore
    let tasks: TasksStore
    let matches: MatchesStore
    let library: LibraryStore
    let home: HomeStore
    let stats: StatsStore
    let chatUnread: ChatUnreadStore
    let complaints: ComplaintsService
    let router = Router()
    private let service: AuthService
    private let persistence: SessionPersistence

    init(environment: AppEnvironment) {
        let holder = ExpiryHolder()
        let client = APIClient(baseURL: environment.baseURL, onSessionExpired: { holder.fire() })
        self.client = client
        self.profile = ProfileStore(client: client)
        self.calendar = CalendarStore(client: client)
        self.coaches = CoachesStore(client: client)
        self.bookings = BookingsStore(client: client)
        self.teams = TeamsStore(client: client)
        self.trainings = TrainingsStore(client: client)
        self.tasks = TasksStore(client: client)
        self.matches = MatchesStore(client: client)
        self.library = LibraryStore(client: client)
        self.home = HomeStore(client: client)
        self.stats = StatsStore(client: client)
        self.chatUnread = ChatUnreadStore(client: client)
        self.complaints = ComplaintsService(client: client)
        self.service = AuthService(client: client)
        self.persistence = SessionPersistence(
            store: KeychainSecretStore(service: "ru.sportarenaglobal.app", account: "session-cookie"), baseURL: environment.baseURL
        )
        trainings.onChange = { [weak self] in Task { await self?.calendar.reload() } }
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
        errorCode = nil
        defer { isWorking = false }
        do {
            state = .signedIn(try await service.login(email: email, password: password))
            persistence.save()
        } catch let error as APIError {
            errorMessage = error.message
            errorCode = error.code
        } catch {
            errorMessage = APIError.unknown.message
        }
    }

    /// Signs up: the server sends a confirmation letter; the person is not signed in until the address is confirmed.
    func register(_ request: RegistrationRequest) async throws -> String {
        try await service.register(request).email
    }

    func resendVerification(email: String) async throws -> String { try await service.resendVerification(email: email) }

    func forgotPassword(email: String) async throws -> String { try await service.forgotPassword(email: email) }

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
        resetPersonalData()
        state = .signedOut
    }

    /// A chat of the signed-in person (a personal training or a team). Reading it clears its unread count.
    func chatStore(for target: ChatStore.Target) -> ChatStore {
        var userId = UUID()
        if case .signedIn(let user) = state { userId = user.id }
        return ChatStore(client: client, target: target, userId: userId, onRead: { [weak self] in Task { await self?.chatUnread.refresh() } })
    }

    /// Everything that belongs to the person who was signed in: the next person must never see it.
    private func resetPersonalData() {
        calendar.reset()
        coaches.reset()
        bookings.reset()
        teams.reset()
        chatUnread.reset()
        home.reset()
        router.reset()
    }

    private func sessionEnded() {
        if case .signedIn = state {
            persistence.clear()
            profile.reset()
            resetPersonalData()
            state = .signedOut
        }
    }
}

/// Lets the (non-isolated) client call back into the main-actor store.
private final class ExpiryHolder: @unchecked Sendable {
    var action: (() -> Void)?
    func fire() { action?() }
}
