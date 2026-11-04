import Foundation

/// The chats of personal trainings and of teams. New messages are fetched by asking for what came after the last one (the server keeps
/// no open connection), so a screen polls while it is visible.
public final class ChatService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    private func base(_ id: UUID, _ tail: String = "") -> String { "/api/chats/\(id.uuidString.lowercased())\(tail)" }

    public func conversation(forBooking id: UUID) async throws -> ChatConversation {
        try await client.send(.get, "/api/chats/for-booking/\(id.uuidString.lowercased())")
    }

    public func conversation(forTeam id: UUID) async throws -> ChatConversation {
        try await client.send(.get, "/api/chats/for-team/\(id.uuidString.lowercased())")
    }

    public func unread() async throws -> ChatUnread {
        try await client.send(.get, "/api/chats/unread")
    }

    /// The newest messages (no cursor), older ones (`before`), or only the new ones (`after`).
    public func messages(in conversation: UUID, before: Int? = nil, after: Int? = nil, limit: Int = 30) async throws -> ChatPage {
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let before { query.append(URLQueryItem(name: "before_id", value: String(before))) }
        if let after { query.append(URLQueryItem(name: "after_id", value: String(after))) }
        return try await client.send(.get, base(conversation, "/messages"), query: query)
    }

    /// Sends text. `clientKey` makes a retry safe: the same key sent again returns the message that was already created.
    public func send(_ text: String, to conversation: UUID, clientKey: UUID) async throws -> ChatMessage {
        try await client.send(.post, base(conversation, "/messages"), body: ChatMessageRequest(body: text, clientKey: clientKey.uuidString.lowercased()))
    }

    /// Sends a photo or video with an optional caption.
    public func sendMedia(
        _ file: Data, filename: String, mimeType: String, caption: String?, to conversation: UUID, clientKey: UUID
    ) async throws -> ChatMessage {
        var fields = ["client_key": clientKey.uuidString.lowercased()]
        if let caption, !caption.isEmpty { fields["body"] = caption }
        return try await client.upload(
            base(conversation, "/messages/media"), file: UploadFile(filename: filename, mimeType: mimeType, data: file), fields: fields
        )
    }

    public func delete(message id: Int, in conversation: UUID) async throws {
        try await client.sendIgnoringResponse(.delete, base(conversation, "/messages/\(id)"))
    }

    public func markRead(upTo id: Int, in conversation: UUID) async throws {
        try await client.sendIgnoringResponse(.post, base(conversation, "/read"), body: ChatReadRequest(upToId: id))
    }
}
