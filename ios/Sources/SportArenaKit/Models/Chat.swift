import Foundation

public enum ChatLimits {
    /// The longest message the server accepts.
    public static let maxMessageLength = 2000
}

/// A chat of a personal training (a booking) or of a team.
public struct ChatConversation: Decodable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let kind: String
    public let bookingId: UUID?
    public let teamId: UUID?
    public let title: String
    public let subtitle: String?
    /// False when the chat is read-only (a finished or cancelled session, a member who was removed).
    public let canSend: Bool
    public let sendBlockedReason: String?
    /// Whether the person may delete other people's messages (the team's coaching staff).
    public let canModerate: Bool

    public init(
        id: UUID, kind: String, bookingId: UUID? = nil, teamId: UUID? = nil, title: String, subtitle: String? = nil,
        canSend: Bool = true, sendBlockedReason: String? = nil, canModerate: Bool = false
    ) {
        self.id = id
        self.kind = kind
        self.bookingId = bookingId
        self.teamId = teamId
        self.title = title
        self.subtitle = subtitle
        self.canSend = canSend
        self.sendBlockedReason = sendBlockedReason
        self.canModerate = canModerate
    }
}

public struct ChatAttachment: Decodable, Equatable, Hashable, Sendable {
    public enum Kind: String, Decodable, Sendable { case photo, video }
    public let kind: Kind
    public let fileId: UUID
    public let filename: String
    public let hasThumb: Bool

    public init(kind: Kind, fileId: UUID, filename: String, hasThumb: Bool = false) {
        self.kind = kind
        self.fileId = fileId
        self.filename = filename
        self.hasThumb = hasThumb
    }

    private enum CodingKeys: String, CodingKey { case kind, fileId, filename, hasThumb }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        kind = try values.decode(Kind.self, forKey: .kind)
        fileId = try values.decode(UUID.self, forKey: .fileId)
        filename = try values.decode(String.self, forKey: .filename)
        hasThumb = try values.decodeIfPresent(Bool.self, forKey: .hasThumb) ?? false
    }
}

public struct ChatMessage: Decodable, Equatable, Identifiable, Sendable {
    /// Grows with time inside one chat: it is the order of the conversation and the cursor for "what is new".
    public let id: Int
    public let senderId: UUID
    public let senderName: String
    public let body: String?
    public let attachment: ChatAttachment?
    public let createdAt: Date
    /// A deleted message stays as a gap in the conversation, without its text or file.
    public let deleted: Bool

    public init(id: Int, senderId: UUID, senderName: String, body: String?, attachment: ChatAttachment? = nil, createdAt: Date, deleted: Bool = false) {
        self.id = id
        self.senderId = senderId
        self.senderName = senderName
        self.body = body
        self.attachment = attachment
        self.createdAt = createdAt
        self.deleted = deleted
    }

    private enum CodingKeys: String, CodingKey { case id, senderId, senderName, body, attachment, createdAt, deleted }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(Int.self, forKey: .id)
        senderId = try values.decode(UUID.self, forKey: .senderId)
        senderName = try values.decode(String.self, forKey: .senderName)
        body = try values.decodeIfPresent(String.self, forKey: .body)
        attachment = try values.decodeIfPresent(ChatAttachment.self, forKey: .attachment)
        createdAt = try values.decode(Date.self, forKey: .createdAt)
        deleted = try values.decodeIfPresent(Bool.self, forKey: .deleted) ?? false
    }
}

public struct ChatPage: Decodable, Equatable, Sendable {
    public let items: [ChatMessage]
    public let hasMoreBefore: Bool

    public init(items: [ChatMessage], hasMoreBefore: Bool) {
        self.items = items
        self.hasMoreBefore = hasMoreBefore
    }
}

/// Unread messages: per personal-training chat (by booking) and per team chat (by team).
public struct ChatUnread: Decodable, Equatable, Sendable {
    public let booking: [String: Int]
    public let team: [String: Int]
    public let total: Int

    public init(booking: [String: Int] = [:], team: [String: Int] = [:], total: Int = 0) {
        self.booking = booking
        self.team = team
        self.total = total
    }

    public func forBooking(_ id: UUID) -> Int { booking[id.uuidString.lowercased()] ?? booking[id.uuidString] ?? 0 }
    public func forTeam(_ id: UUID) -> Int { team[id.uuidString.lowercased()] ?? team[id.uuidString] ?? 0 }
}

struct ChatMessageRequest: Encodable, Sendable {
    let body: String
    let clientKey: String
}

struct ChatReadRequest: Encodable, Sendable {
    let upToId: Int
}

/// The messages of one chat as the screen shows them: ordered, without repeats, able to take in what a refresh brings.
public struct ChatThread: Equatable, Sendable {
    public private(set) var messages: [ChatMessage] = []
    /// Whether older messages exist than the ones loaded.
    public var hasMoreBefore = false

    public init() {}

    public var isEmpty: Bool { messages.isEmpty }
    /// What to ask the server for next to get only the new messages.
    public var newestID: Int? { messages.last?.id }
    public var oldestID: Int? { messages.first?.id }

    /// Takes in messages from any request. A message that is already here is replaced (it may have been deleted meanwhile).
    public mutating func merge(_ incoming: [ChatMessage]) {
        guard !incoming.isEmpty else { return }
        var byID = Dictionary(messages.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        for message in incoming { byID[message.id] = message }
        messages = byID.values.sorted { $0.id < $1.id }
    }

    /// A page of older messages (`before_id`): they go in front, and the page says whether there is still more.
    public mutating func prepend(_ page: ChatPage) {
        merge(page.items)
        hasMoreBefore = page.hasMoreBefore
    }

    public mutating func remove(id: Int) {
        messages.removeAll { $0.id == id }
    }
}
