import Foundation

/// Where a report stands (`status`): handed in, accepted by the coaching staff, or sent back.
public enum ReportStatus: Equatable, Sendable {
    case pending, accepted, needsRevision
    case other(String)

    init(raw: String) {
        switch raw {
        case "pending": self = .pending
        case "accepted": self = .accepted
        case "needs_revision": self = .needsRevision
        default: self = .other(raw)
        }
    }

    public var title: String {
        switch self {
        case .pending: "На проверке"
        case .accepted: "Принят"
        case .needsRevision: "Нужно доработать"
        case .other(let raw): raw
        }
    }
}

/// The report of a training the team held without its coach, written by the player responsible for it (`ReportOut`).
public struct TrainingReport: Decodable, Equatable, Sendable {
    public let trainingId: UUID
    public let submittedBy: UUID
    public let textReport: String
    public let photoFileId: UUID?
    public let videoFileId: UUID?
    public let statusRaw: String
    public let coachComment: String?
    public let reviewedBy: UUID?
    public let reviewedAt: Date?

    private enum CodingKeys: String, CodingKey {
        case trainingId, submittedBy, textReport, photoFileId, videoFileId, coachComment, reviewedBy, reviewedAt
        case statusRaw = "status"
    }

    public var status: ReportStatus { ReportStatus(raw: statusRaw) }
}

/// What the responsible player writes.
public struct ReportDraft: Equatable, Sendable {
    public static let maxLength = 2000

    public var text: String

    public init(text: String = "") { self.text = text }

    /// The text as it is sent: nothing at the ends, cut at the server's limit.
    public var tidyText: String { String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(Self.maxLength)) }

    public var isReady: Bool { !tidyText.isEmpty }
}

/// The staff's answer to a report.
public enum ReportDecision: String, Sendable {
    case accepted
    case needsRevision = "needs_revision"
}

public enum ReportReview {
    public static let maxCommentLength = 1000

    /// The comment as sent: nothing at the ends, cut at the limit, nil when empty.
    public static func tidyComment(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : String(trimmed.prefix(maxCommentLength))
    }
}

struct ReportSubmitBody: Encodable, Sendable {
    let textReport: String
}

struct ReportReviewBody: Encodable, Sendable {
    let decision: String
    let coachComment: String?

    private enum CodingKeys: String, CodingKey { case decision, coachComment }

    /// The site sends an empty comment as an explicit null.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(decision, forKey: .decision)
        try container.encode(coachComment, forKey: .coachComment)
    }
}

public extension Training {
    /// The training is over: marked held, or still «scheduled» on a day that has passed (the site's «просрочена»). A report is written then.
    func hasHappened(today: LocalDate) -> Bool {
        status == "completed" || (status == "scheduled" && trainingDate < today)
    }
}
