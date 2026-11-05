import Foundation

/// Signing up, in and out. The session itself is the server's cookie (kept by URLSession); what this service holds on to is
/// the CSRF token that goes with it, which it passes to the client after every sign-in and every `me` call.
public final class AuthService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    private struct LoginBody: Encodable, Sendable { let email: String; let password: String }

    /// Signs in. A wrong password is `invalid_credentials`-style APIError with the server's Russian `message`;
    /// a not yet confirmed address answers 403.
    @discardableResult
    public func login(email: String, password: String) async throws -> AuthUser {
        let user: AuthUser = try await client.send(.post, "/api/auth/login", body: LoginBody(email: email.trimmingCharacters(in: .whitespaces), password: password))
        await client.setCSRFToken(user.csrfToken)
        return user
    }

    /// Who is signed in right now. Call it when the app starts: a stored cookie either still works (the person is in,
    /// and a fresh CSRF token arrives) or the server answers 401 (show the sign-in screen).
    public func currentUser() async throws -> AuthUser {
        let user: AuthUser = try await client.send(.get, "/api/auth/me")
        await client.setCSRFToken(user.csrfToken)
        return user
    }

    public func logout() async throws {
        defer { Task { await client.setCSRFToken(nil) } }
        try await client.sendIgnoringResponse(.post, "/api/auth/logout")
    }

    public func register(_ request: RegistrationRequest) async throws -> RegistrationResult {
        try await client.send(.post, "/api/auth/register", body: request)
    }

    private struct EmailBody: Encodable, Sendable { let email: String }

    /// Sends the confirmation letter again. The server answers in the same words whether or not the address is known.
    @discardableResult
    public func resendVerification(email: String) async throws -> String {
        let answer: MessageResponse = try await client.send(.post, "/api/auth/resend-verification", body: EmailBody(email: email.trimmingCharacters(in: .whitespaces)))
        return answer.message
    }

    /// Asks for a letter with a link to choose a new password (the link opens the site). Like the one above, it does not tell
    /// whether the address has an account.
    @discardableResult
    public func forgotPassword(email: String) async throws -> String {
        let answer: MessageResponse = try await client.send(.post, "/api/auth/forgot-password", body: EmailBody(email: email.trimmingCharacters(in: .whitespaces)))
        return answer.message
    }

    public func features() async throws -> ServerFeatures {
        try await client.send(.get, "/api/features")
    }

    private struct PasswordBody: Encodable, Sendable { let password: String }

    /// Asks to delete the account (an App Store requirement). The server keeps it for a grace period and can still undo it;
    /// the password is asked again, so a lost phone cannot delete an account.
    public func requestAccountDeletion(password: String) async throws -> String {
        let answer: MessageResponse = try await client.send(.post, "/api/auth/account/delete", body: PasswordBody(password: password))
        return answer.message
    }

    public func cancelAccountDeletion() async throws {
        try await client.sendIgnoringResponse(.post, "/api/auth/account/delete/cancel")
    }
}
