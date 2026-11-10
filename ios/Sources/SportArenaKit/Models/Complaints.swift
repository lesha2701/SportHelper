import Foundation

/// What can be reported: a person's profile, a coach's listing, a public photo or video. (The server has no complaint about a single
/// chat message: a message is reported as a complaint about its author.)
public enum ComplaintTarget: String, Codable, Sendable {
    case user, listing, media
}

/// Why, in the words of the site's «Пожаловаться» dialog.
public enum ComplaintReason: String, Codable, CaseIterable, Identifiable, Sendable {
    case inappropriate, fraud, spam
    case falseInfo = "false_info"
    case other

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .inappropriate: "Недопустимый контент"
        case .fraud: "Мошенничество"
        case .spam: "Спам"
        case .falseInfo: "Ложная информация"
        case .other: "Другая причина"
        }
    }
}

/// The dialog's answers. A reason is needed; «other» needs words of its own, as on the site and the server.
public struct ComplaintDraft: Equatable, Sendable {
    public static let maxCommentLength = 1000
    public static let minOtherLength = 3

    public var reason: ComplaintReason?
    public var comment = ""

    public init(reason: ComplaintReason? = nil, comment: String = "") {
        self.reason = reason
        self.comment = comment
    }

    /// The comment as the server keeps it: single spaces, nothing at the ends, nil when empty.
    public var tidyComment: String? {
        let text = comment.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return text.isEmpty ? nil : String(text.prefix(Self.maxCommentLength))
    }

    public var needsComment: Bool { reason == .other }

    public var isReady: Bool {
        guard let reason else { return false }
        return reason != .other || (tidyComment?.count ?? 0) >= Self.minOtherLength
    }
}

struct ComplaintRequest: Encodable, Sendable {
    let targetType: ComplaintTarget
    let targetId: UUID
    let reason: ComplaintReason
    let comment: String?
}
