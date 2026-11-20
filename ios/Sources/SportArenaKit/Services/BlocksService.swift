import Foundation

/// Blocking a person (App Store guideline 1.2): the server hides their chat messages from the one who blocked and closes the chat for
/// writing in both directions. Blocking and unblocking can be repeated safely.
public final class BlocksService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    private func path(_ user: UUID) -> String { "/api/blocks/\(user.uuidString.lowercased())" }

    public func blocked() async throws -> [BlockedUser] {
        try await client.send(.get, "/api/blocks")
    }

    public func block(_ user: UUID) async throws {
        try await client.sendIgnoringResponse(.put, path(user))
    }

    public func unblock(_ user: UUID) async throws {
        try await client.sendIgnoringResponse(.delete, path(user))
    }
}
