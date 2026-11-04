import Foundation
import Observation
import SportArenaKit

/// One open chat: the messages, what the person is sending, and the polling that keeps it current while the screen is visible.
@MainActor
@Observable
final class ChatStore {
    enum Target: Equatable {
        case booking(UUID)
        case team(UUID)
    }

    /// A message of the person that the server has not confirmed yet. It is shown at the end of the conversation (sending, or failed
    /// with a way to retry); the `id` is the client key, so retrying can never create the message twice.
    struct Outgoing: Identifiable, Equatable {
        let id: UUID
        let text: String
        let photo: Data?
        var isSending = true
        var failure: String?
    }

    enum Load: Equatable {
        case loading
        case loaded(ChatConversation)
        case failed(String)
    }

    private(set) var conversation: Load = .loading
    private(set) var thread = ChatThread()
    private(set) var outgoing: [Outgoing] = []
    private(set) var isLoadingOlder = false
    /// The last refresh failed (no connection): shown as a quiet note, the messages already loaded stay.
    private(set) var offline = false

    let target: Target
    let userId: UUID
    private let service: ChatService
    private let onRead: () -> Void
    private var lastRead = 0

    init(client: APIClient, target: Target, userId: UUID, onRead: @escaping () -> Void = {}) {
        service = ChatService(client: client)
        self.target = target
        self.userId = userId
        self.onRead = onRead
    }

    var conversationInfo: ChatConversation? { if case .loaded(let value) = conversation { value } else { nil } }

    func isMine(_ message: ChatMessage) -> Bool { message.senderId == userId }

    // MARK: loading

    func open() async {
        do {
            let value: ChatConversation
            switch target {
            case .booking(let id): value = try await service.conversation(forBooking: id)
            case .team(let id): value = try await service.conversation(forTeam: id)
            }
            conversation = .loaded(value)
            let page = try await service.messages(in: value.id)
            thread.merge(page.items)
            thread.hasMoreBefore = page.hasMoreBefore
            offline = false
            await markRead()
        } catch let error as APIError {
            conversation = .failed(error.message)
        } catch {
            conversation = .failed(APIError.unknown.message)
        }
    }

    /// Keeps the chat current: asks for what came after the last message every few seconds, more slowly while the connection is bad.
    /// Cancelled with the screen (and while the app is in the background).
    func poll() async {
        while !Task.isCancelled {
            await refresh()
            try? await Task.sleep(for: .seconds(offline ? 10 : 3))
        }
    }

    func refresh() async {
        guard let info = conversationInfo else { return }
        do {
            let page = try await service.messages(in: info.id, after: thread.newestID)
            let before = thread.newestID
            thread.merge(page.items)
            offline = false
            if thread.newestID != before { await markRead() }
        } catch {
            offline = true
        }
    }

    func loadOlder() async {
        guard let info = conversationInfo, thread.hasMoreBefore, !isLoadingOlder, let oldest = thread.oldestID else { return }
        isLoadingOlder = true
        defer { isLoadingOlder = false }
        if let page = try? await service.messages(in: info.id, before: oldest) { thread.prepend(page) }
    }

    private func markRead() async {
        guard let info = conversationInfo, let newest = thread.newestID, newest > lastRead else { return }
        lastRead = newest
        try? await service.markRead(upTo: newest, in: info.id)
        onRead()
    }

    // MARK: sending

    /// What the person typed, trimmed; nil when there is nothing to send or it is longer than the server accepts.
    static func prepared(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty || trimmed.count > ChatLimits.maxMessageLength ? nil : trimmed
    }

    func send(_ text: String) async {
        guard let text = Self.prepared(text) else { return }
        let message = Outgoing(id: UUID(), text: text, photo: nil)
        outgoing.append(message)
        await deliver(message.id)
    }

    func sendPhoto(_ jpeg: Data, caption: String = "") async {
        let message = Outgoing(id: UUID(), text: caption.trimmingCharacters(in: .whitespacesAndNewlines), photo: jpeg)
        outgoing.append(message)
        await deliver(message.id)
    }

    func retry(_ id: UUID) async {
        guard let index = outgoing.firstIndex(where: { $0.id == id }), !outgoing[index].isSending else { return }
        outgoing[index].isSending = true
        outgoing[index].failure = nil
        await deliver(id)
    }

    func discard(_ id: UUID) {
        outgoing.removeAll { $0.id == id && !$0.isSending }
    }

    private func deliver(_ id: UUID) async {
        guard let info = conversationInfo, let message = outgoing.first(where: { $0.id == id }) else { return }
        do {
            let sent: ChatMessage
            if let photo = message.photo {
                sent = try await service.sendMedia(
                    photo, filename: "photo.jpg", mimeType: "image/jpeg", caption: message.text, to: info.id, clientKey: id
                )
            } else {
                sent = try await service.send(message.text, to: info.id, clientKey: id)
            }
            thread.merge([sent])
            outgoing.removeAll { $0.id == id }
            await markRead()
        } catch let error as APIError {
            fail(id, error.message)
        } catch {
            fail(id, APIError.unknown.message)
        }
    }

    private func fail(_ id: UUID, _ text: String) {
        guard let index = outgoing.firstIndex(where: { $0.id == id }) else { return }
        outgoing[index].isSending = false
        outgoing[index].failure = text
    }

    // MARK: deleting

    func canDelete(_ message: ChatMessage) -> Bool {
        !message.deleted && (isMine(message) || (conversationInfo?.canModerate ?? false))
    }

    /// Returns the server's error text, or nil when the message is gone.
    func delete(_ message: ChatMessage) async -> String? {
        guard let info = conversationInfo else { return nil }
        do {
            try await service.delete(message: message.id, in: info.id)
            thread.merge([ChatMessage(
                id: message.id, senderId: message.senderId, senderName: message.senderName, body: nil, attachment: nil,
                createdAt: message.createdAt, deleted: true
            )])
            return nil
        } catch let error as APIError {
            return error.message
        } catch {
            return APIError.unknown.message
        }
    }
}

/// Unread messages across all chats: the badges on the tabs and on the chat entries.
@MainActor
@Observable
final class ChatUnreadStore {
    private(set) var unread = ChatUnread()
    private let service: ChatService

    init(client: APIClient) { service = ChatService(client: client) }

    var teamTotal: Int { unread.team.values.reduce(0, +) }
    var bookingTotal: Int { unread.booking.values.reduce(0, +) }

    func refresh() async {
        if let fresh = try? await service.unread() { unread = fresh }
    }

    /// While the app is on screen: ask every so often. Cancelled when the app goes to the background.
    func keepFresh() async {
        while !Task.isCancelled {
            await refresh()
            try? await Task.sleep(for: .seconds(20))
        }
    }

    func reset() { unread = ChatUnread() }
}
