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
    /// Why the app asks to be updated: required (the server refuses this version; the whole app is replaced by the update screen)
    /// or only offered (a dismissible note). nil while this version is fine.
    private(set) var updateNotice: UpdateNotice?

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
    let notifications: NotificationsStore
    let complaints: ComplaintsService
    let publicProfiles: PublicProfilesService
    let listings: ListingsService
    let reports: ReportsService
    let account: AccountService
    let finance: FinanceService
    let search: SearchService
    let router = Router()
    private let service: AuthService
    private let devices: DevicesService
    /// The token this installation gave the server for the signed-in person; taken back on sign-out.
    private var registeredPushToken: String?
    private let persistence: SessionPersistence

    /// The site's admin panel (the same host as the server; administrators sign in there separately, with a second step).
    let adminPanelURL: URL

    init(environment: AppEnvironment) {
        adminPanelURL = environment.baseURL.appendingPathComponent("admin")
        let holder = ExpiryHolder()
        let updateHolder = UpdateHolder()
        let client = APIClient(
            baseURL: environment.baseURL, onSessionExpired: { holder.fire() }, onUpdateRequired: { updateHolder.fire($0) }
        )
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
        self.notifications = NotificationsStore(client: client)
        self.complaints = ComplaintsService(client: client)
        self.publicProfiles = PublicProfilesService(client: client)
        self.listings = ListingsService(client: client)
        self.reports = ReportsService(client: client)
        self.account = AccountService(client: client)
        self.finance = FinanceService(client: client)
        self.search = SearchService(client: client)
        self.service = AuthService(client: client)
        self.devices = DevicesService(client: client)
        self.persistence = SessionPersistence(
            store: KeychainSecretStore(service: "ru.sportarenaglobal.app", account: "session-cookie"), baseURL: environment.baseURL
        )
        trainings.onChange = { [weak self] in Task { await self?.calendar.reload() } }
        holder.action = { [weak self] in Task { @MainActor in self?.sessionEnded() } }
        // any request the server refuses with 426 (the minimum was raised while the app was open) ends in the update screen
        updateHolder.action = { [weak self] error in Task { @MainActor in self?.updateRequired(error) } }
    }

    /// On launch: a stored cookie either still works (the person is in) or the server says 401 (show sign-in).
    func start() async {
        persistence.restore()  // the session survives the app being closed
        features = (try? await service.features()) ?? ServerFeatures()
        await checkVersion()
        if updateNotice?.isRequired == true { return }  // nothing else would work: the update screen is all that is shown
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

    /// The person saw (or skipped) the welcome tour. A failure never blocks them: the tour may come back at the next sign-in.
    func finishOnboarding() async {
        guard (try? await service.completeOnboarding()) != nil else { return }
        await refreshUser()
    }

    func cancelAccountDeletion() async throws {
        try await service.cancelAccountDeletion()
        await refreshUser()
    }

    /// For the signed-in person: ask permission for push, and give the server this phone's token (now, and again whenever the system replaces it).
    func startPush() async {
        PushCenter.shared.onToken = { [weak self] token in Task { await self?.registerPushToken(token) } }
        if let token = PushCenter.shared.token { await registerPushToken(token) }
        await PushCenter.shared.start()
    }

    private func registerPushToken(_ token: String) async {
        guard case .signedIn = state else { return }
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
        if (try? await devices.register(token: token, appVersion: version)) != nil { registeredPushToken = token }
    }

    func logout() async {
        // While the session still lives: this phone stops receiving this person's notifications.
        if let token = registeredPushToken {
            registeredPushToken = nil
            try? await devices.remove(token: token)
        }
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
        notifications.reset()
        home.reset()
        router.reset()
    }

    /// Asks the server whether this version may still run. An unanswered question changes nothing: a server that cannot be reached
    /// is not a reason to lock the person out (a 426 on any later request still does).
    func checkVersion() async {
        guard let config = try? await service.appConfig() else { return }
        updateNotice = UpdateNotice(config)
    }

    /// «Не сейчас» on the offer of a newer version. A required update cannot be dismissed.
    func dismissUpdateOffer() {
        if updateNotice?.isRequired == false { updateNotice = nil }
    }

    private func updateRequired(_ error: APIError) {
        guard let notice = UpdateNotice(error) else { return }
        // keep the link already known when the refusal itself has none
        updateNotice = UpdateNotice(minVersion: notice.minVersion, url: notice.url ?? updateNotice?.url, isRequired: true)
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

/// The same for a refusal to serve an out-of-date app.
private final class UpdateHolder: @unchecked Sendable {
    var action: ((APIError) -> Void)?
    func fire(_ error: APIError) { action?(error) }
}
