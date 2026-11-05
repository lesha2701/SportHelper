import Foundation

/// The notification feed and the switches of its categories. (Notifications are fetched, not pushed: the app asks every so often.)
public final class NotificationsService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    /// Newest first, as the server sorts them.
    public func list() async throws -> [NotificationItem] {
        try await client.send(.get, "/api/notifications")
    }

    public func markRead(_ id: UUID) async throws {
        try await client.sendIgnoringResponse(.post, "/api/notifications/\(id.uuidString.lowercased())/read")
    }

    public func markAllRead() async throws {
        try await client.sendIgnoringResponse(.post, "/api/notifications/read-all")
    }

    /// Every switchable category with its state (all on until the person switches one off).
    public func preferences() async throws -> [NotificationPreference] {
        try await client.send(.get, "/api/notifications/preferences")
    }

    /// Changes one switch; the answer is the full list as it is now.
    public func set(_ category: NotificationCategory, enabled: Bool) async throws -> [NotificationPreference] {
        try await client.send(
            .put, "/api/notifications/preferences",
            body: NotificationPreferencesRequest(preferences: [NotificationPreference(category: category, enabled: enabled)])
        )
    }
}
