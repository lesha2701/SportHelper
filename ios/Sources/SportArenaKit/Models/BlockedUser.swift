import Foundation

/// A person the user has blocked (`BlockedUserOut`): their messages are hidden and they cannot be written to.
public struct BlockedUser: Decodable, Equatable, Identifiable, Sendable {
    public let userId: UUID
    public let fullName: String
    public let blockedAt: Date

    public var id: UUID { userId }

    public init(userId: UUID, fullName: String, blockedAt: Date) {
        self.userId = userId
        self.fullName = fullName
        self.blockedAt = blockedAt
    }
}
