import Foundation

/// Tells the server which phone to send push notifications to (docs/push.md).
public final class DevicesService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    /// After sign-in and whenever the system gives the app a new token. Idempotent: the same token again only refreshes it.
    public func register(token: String, appVersion: String?) async throws {
        try await client.sendIgnoringResponse(.put, "/api/devices", body: DeviceBody(platform: "ios", token: token, appVersion: appVersion))
    }

    /// On sign-out, while the session still lives: this phone stops receiving this person's notifications.
    public func remove(token: String) async throws {
        try await client.sendIgnoringResponse(.post, "/api/devices/remove", body: DeviceRemoveBody(token: token))
    }

    /// The token as the server wants it: the bytes the system hands over, in lower-case hexadecimal.
    public static func hex(_ token: Data) -> String { token.map { String(format: "%02x", $0) }.joined() }
}

struct DeviceBody: Encodable, Sendable {
    let platform: String
    let token: String
    let appVersion: String?
}

struct DeviceRemoveBody: Encodable, Sendable {
    let token: String
}

/// What the server puts into a push besides the text: which notification it is and what it is about.
public struct PushPayload: Equatable, Sendable {
    public let category: NotificationCategory
    public let entityId: UUID

    /// The `userInfo` of a delivered push (a payload without the fields, or about a thing the app has no screen for, is not one to open).
    public init?(userInfo: [AnyHashable: Any]) {
        guard let rawCategory = userInfo["category"] as? String, let raw = userInfo["entity_id"] as? String, let id = UUID(uuidString: raw)
        else { return nil }
        category = NotificationCategory(rawValue: rawCategory) ?? .other
        entityId = id
    }

    public var target: NotificationTarget { NotificationTarget(category: category, entityId: entityId) }
}
