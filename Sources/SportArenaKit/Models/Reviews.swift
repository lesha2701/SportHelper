import Foundation

/// The review dialog's answers: stars and an optional comment. Used for the athlete's review of a coach and the coach's review of an
/// athlete; the server takes the same body for both.
public struct ReviewDraft: Equatable, Sendable {
    public static let stars = 1...5
    public static let maxTextLength = 2000

    /// Five stars are preselected, as on the site.
    public var rating: Int
    public var text: String

    public init(rating: Int = 5, text: String = "") {
        self.rating = rating
        self.text = text
    }

    public var isReady: Bool { Self.stars.contains(rating) }

    /// The comment as the server keeps it: nothing at the ends, nil when empty.
    public var tidyText: String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : String(trimmed.prefix(Self.maxTextLength))
    }
}

struct ReviewRequest: Encodable, Sendable {
    let rating: Int
    let text: String?
}
