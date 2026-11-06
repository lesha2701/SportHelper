import SportArenaKit
import SwiftUI

/// «Безопасность аккаунта»: the email, the password, and the places where the person is signed in.
struct AccountSecurityView: View {
    @Environment(AuthStore.self) private var auth
    let user: AuthUser

    @State private var sessions = LoadState<[AccountSession]>.loading
    @State private var busy: UUID?
    @State private var confirmingAll = false
    @State private var error: String?

    /// An account made through Telegram has no password; both changes below ask for one.
    private var hasPassword: Bool { user.hasPassword ?? true }

    var body: some View {
        List {
            emailSection
            passwordSection
            sessionsSection
        }
        .sagScreen()
        .navigationTitle("Безопасность")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await auth.refreshUser()  // the email may have been confirmed on the site meanwhile
            await load()
        }
        .refreshable { await load() }
        .confirmationDialog("Выйти везде?", isPresented: $confirmingAll, titleVisibility: .visible) {
            Button("Выйти везде", role: .destructive) { Task { await endAll() } }.accessibilityIdentifier("account.endAll.confirm")
        } message: {
            Text("Вы выйдете из аккаунта на всех устройствах, включая это. Чтобы продолжить, нужно будет войти заново.")
        }
    }

    // MARK: email and password

    private var emailSection: some View {
        Section(sag: "Email") {
            HStack {
                Text("Адрес").foregroundStyle(.secondary)
                Spacer()
                Text(user.email ?? "—").accessibilityIdentifier("account.email")
            }
            if user.emailVerified == true {
                Label("Подтверждён", systemImage: "checkmark.seal").font(.footnote).foregroundStyle(Theme.success)
            }
            if hasPassword {
                NavigationLink { ChangeEmailView(currentEmail: user.email) } label: { Label("Изменить email", systemImage: "envelope") }
                    .accessibilityIdentifier("account.changeEmail")
            }
        }
    }

    private var passwordSection: some View {
        Section(sag: "Пароль") {
            if hasPassword {
                NavigationLink {
                    ChangePasswordView { Task { await load() } }
                } label: {
                    Label("Сменить пароль", systemImage: "lock.rotation")
                }
                .accessibilityIdentifier("account.changePassword")
            } else {
                Text("У этого аккаунта нет пароля: он создан через Telegram. Email и пароль можно задать на сайте.").foregroundStyle(.secondary)
            }
        } footer: {
            if hasPassword { Text("После смены пароля вы останетесь в аккаунте на этом устройстве, а на остальных выйдете.") }
        }
    }

    // MARK: sessions

    private var sessionsSection: some View {
        Section(sag: "Устройства и сессии") {
            switch sessions {
            case .loading: ProgressView().frame(maxWidth: .infinity)
            case .failed(let message):
                Text(message).foregroundStyle(.red)
                Button("Повторить") { Task { await load() } }
            case .loaded(let list):
                ForEach(list) { session in row(session) }
            }
            if let error { Text(error).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("account.error") }
            Button("Выйти на всех устройствах", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) { confirmingAll = true }
                .accessibilityIdentifier("account.endAll")
        } footer: {
            Text("Здесь все места, где выполнен вход. Незнакомое устройство можно завершить.")
        }
    }

    private func row(_ session: AccountSession) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "iphone.and.arrow.forward").foregroundStyle(Theme.primary).frame(width: 28).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(session.device).font(Theme.body(15, weight: .semibold))
                Text(detail(session)).font(.footnote).foregroundStyle(.secondary)
                if session.current { Text("это устройство").font(.caption.weight(.semibold)).foregroundStyle(Theme.success) }
            }
            Spacer()
            if !session.current {
                Button("Завершить") { Task { await end(session) } }
                    .buttonStyle(.bordered).controlSize(.small)
                    .disabled(busy == session.id)
                    .accessibilityIdentifier("account.endSession")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("account.session")
    }

    private func detail(_ session: AccountSession) -> String {
        let seen = "активность " + LocalDateFormat.deadline(session.lastSeenAt)
        return [session.ipAddress, seen].compactMap { $0 }.joined(separator: " · ")
    }

    // MARK: actions

    private func load() async {
        do {
            sessions = .loaded(try await auth.account.sessions())
        } catch let error as APIError {
            if sessions.value == nil { sessions = .failed(error.message) }
        } catch {
            if sessions.value == nil { sessions = .failed(APIError.unknown.message) }
        }
    }

    private func end(_ session: AccountSession) async {
        busy = session.id
        error = nil
        defer { busy = nil }
        do {
            try await auth.account.endSession(session.id)
            await load()
        } catch let failure as APIError {
            error = failure.message
        } catch {
            self.error = APIError.unknown.message
        }
    }

    private func endAll() async {
        error = nil
        do {
            try await auth.account.endAllSessions()
            await auth.logout()
        } catch let failure as APIError {
            error = failure.message
        } catch {
            self.error = APIError.unknown.message
        }
    }
}
