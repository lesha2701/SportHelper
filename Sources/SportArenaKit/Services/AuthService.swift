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

    public func features() async throws -> ServerFeatures {
        try await client.send(.get, "/api/features")
    }
}
