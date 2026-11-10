import Foundation

/// The security side of the account: the password, the email, and the places where the person is signed in.
public final class AccountService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    /// Changes the password. The other devices are signed out by the server; this one stays in. Returns the server's message.
    @discardableResult
    public func changePassword(_ draft: PasswordChangeDraft) async throws -> String {
        let answer: MessageResponse = try await client.send(
            .post, "/api/auth/change-password",
            body: PasswordChangeBody(currentPassword: draft.current, newPassword: draft.new, newPasswordConfirm: draft.confirm)
        )
        return answer.message
    }

    /// Asks for a new email. Nothing changes until the link in the letter to the new address is opened (it opens the site).
    @discardableResult
    public func changeEmail(_ draft: EmailChangeDraft) async throws -> String {
        let answer: MessageResponse = try await client.send(
            .post, "/api/auth/change-email", body: EmailChangeBody(newEmail: draft.tidyEmail, password: draft.password)
        )
        return answer.message
    }

    public func sessions() async throws -> [AccountSession] {
        AccountSession.ordered(try await client.send(.get, "/api/auth/sessions"))
    }

    public func endSession(_ id: UUID) async throws {
        try await client.sendIgnoringResponse(.delete, "/api/auth/sessions/\(id.uuidString.lowercased())")
    }

    /// Signs the person out everywhere, this device too.
    public func endAllSessions() async throws {
        try await client.sendIgnoringResponse(.post, "/api/auth/logout-all")
    }

    // MARK: privacy

    public func privacy() async throws -> PrivacySettings {
        try await client.send(.get, "/api/users/me/privacy")
    }

    /// Allows or forbids a personal coach to use the person's data for an AI analysis. Forbidding it also deletes the analyses
    /// that were already made (the server does it).
    public func setAiAnalysisAllowed(_ allowed: Bool) async throws -> PrivacySettings {
        try await client.send(.put, "/api/users/me/privacy", body: PrivacySettingsBody(allowAiAnalysisByPersonalCoach: allowed))
    }
}
