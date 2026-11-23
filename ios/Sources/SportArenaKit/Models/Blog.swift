import Foundation

public enum PostStatus: String, Codable, Sendable {
    case draft, pending, published, rejected, removed

    public var title: String {
        switch self {
        case .draft: "Черновик"
        case .pending: "На проверке"
        case .published: "Опубликована"
        case .rejected: "Отклонена"
        case .removed: "Снята"
        }
    }
}

public enum FeedSort: String, CaseIterable, Identifiable, Sendable {
    case new, popular

    public var id: String { rawValue }
    public var title: String { self == .new ? "Новые" : "Популярные" }
}

public enum BlockType: String, Codable, CaseIterable, Sendable {
    case paragraph, heading, quote, list

    public var title: String {
        switch self {
        case .paragraph: "Абзац"
        case .heading: "Заголовок"
        case .quote: "Цитата"
        case .list: "Список"
        }
    }
}

/// One block of an article: `text` for a paragraph, a heading and a quote, `items` for a list. Only `**bold**` and `*italic*` mean anything inside.
public struct PostBlock: Codable, Equatable, Sendable, Identifiable {
    public var type: BlockType
    public var text: String?
    public var items: [String]?
    /// Not sent: lets the editor keep a stable identity for a block while it is edited.
    public let id: UUID

    public init(type: BlockType, text: String? = nil, items: [String]? = nil, id: UUID = UUID()) {
        self.type = type
        self.text = text
        self.items = items
        self.id = id
    }

    private enum CodingKeys: String, CodingKey { case type, text, items }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        type = try container.decode(BlockType.self, forKey: .type)
        text = try container.decodeIfPresent(String.self, forKey: .text)
        items = try container.decodeIfPresent([String].self, forKey: .items)
        id = UUID()
    }

    /// What the editor shows in its one text field: a list is one item per line.
    public var editableText: String {
        type == .list ? (items ?? []).joined(separator: "\n") : (text ?? "")
    }

    /// The block as the server takes it (a list from its lines; an empty block is dropped by the caller).
    public static func make(_ type: BlockType, from editable: String) -> PostBlock {
        if type == .list {
            let items = editable.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            return PostBlock(type: .list, items: items)
        }
        return PostBlock(type: type, text: editable.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    public var isEmpty: Bool {
        type == .list ? (items ?? []).allSatisfy { $0.isEmpty } : (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

public struct PostAuthor: Decodable, Equatable, Sendable {
    public let id: UUID
    public let name: String
    public let isCoach: Bool
    public let isPro: Bool
    /// A trainer's profile is always open; a player's only when they allowed it.
    public let profileOpen: Bool
    public let avatarFileId: UUID?

    public init(id: UUID, name: String, isCoach: Bool, isPro: Bool = false, profileOpen: Bool, avatarFileId: UUID? = nil) {
        self.id = id
        self.name = name
        self.isCoach = isCoach
        self.isPro = isPro
        self.profileOpen = profileOpen
        self.avatarFileId = avatarFileId
    }
}

public struct PostListingCard: Decodable, Equatable, Sendable, Identifiable {
    public let id: UUID
    public let title: String
    public let pricePerSession: Double?
    public let currency: String
    public let photoFileId: UUID?
    public let coachUserId: UUID
}

public struct PostCard: Decodable, Equatable, Sendable, Identifiable {
    public let id: UUID
    public let title: String
    public let sport: String
    public let excerpt: String
    public let coverFileId: UUID?
    public let imagesCount: Int
    public let author: PostAuthor
    public let likesCount: Int
    public let commentsCount: Int
    public let viewsCount: Int
    public let publishedAt: Date?
    public let likedByMe: Bool

    public init(
        id: UUID, title: String, sport: String, excerpt: String = "", coverFileId: UUID? = nil, imagesCount: Int = 0, author: PostAuthor,
        likesCount: Int = 0, commentsCount: Int = 0, viewsCount: Int = 0, publishedAt: Date? = nil, likedByMe: Bool = false
    ) {
        self.id = id
        self.title = title
        self.sport = sport
        self.excerpt = excerpt
        self.coverFileId = coverFileId
        self.imagesCount = imagesCount
        self.author = author
        self.likesCount = likesCount
        self.commentsCount = commentsCount
        self.viewsCount = viewsCount
        self.publishedAt = publishedAt
        self.likedByMe = likedByMe
    }
}

public struct Post: Decodable, Equatable, Sendable, Identifiable {
    public let id: UUID
    public let title: String
    public let sport: String
    public let excerpt: String
    public let coverFileId: UUID?
    public let imagesCount: Int
    public let author: PostAuthor
    public var likesCount: Int
    public var commentsCount: Int
    public let viewsCount: Int
    public let publishedAt: Date?
    public var likedByMe: Bool
    public let status: PostStatus
    public let blocks: [PostBlock]
    public let imageIds: [UUID]
    public let listing: PostListingCard?
    public var bookmarkedByMe: Bool
    public let isMine: Bool
    public let rejectReason: String?
    public let flags: [String]
    public let updatedAt: Date
    /// For the author: this edit sent the article back to the administrators.
    public let sentForReview: Bool
}

public struct PostPage: Decodable, Equatable, Sendable {
    public let total: Int
    public let limit: Int
    public let offset: Int
    public let items: [PostCard]

    public var hasMore: Bool { offset + items.count < total }
}

public struct MyPost: Decodable, Equatable, Sendable, Identifiable {
    public let id: UUID
    public let title: String
    public let sport: String
    public let status: PostStatus
    public let rejectReason: String?
    public let publishedAt: Date?
    public let updatedAt: Date
    public let likesCount: Int
    public let commentsCount: Int
    public let viewsCount: Int
    public let coverFileId: UUID?
}

public struct PostComment: Decodable, Equatable, Sendable, Identifiable {
    public let id: UUID
    public let postId: UUID
    public let author: PostAuthor
    public let body: String
    /// A contact in the text was covered with «[контакт скрыт]».
    public let contactHidden: Bool
    public let createdAt: Date
    public let isMine: Bool
}

public struct BlogSettings: Codable, Equatable, Sendable {
    public var showProfileInPosts: Bool
    public let isCoach: Bool

    public init(showProfileInPosts: Bool, isCoach: Bool = false) {
        self.showProfileInPosts = showProfileInPosts
        self.isCoach = isCoach
    }
}

public struct LikeState: Decodable, Equatable, Sendable {
    public let liked: Bool
    public let likesCount: Int
}

public struct AuthorProfile: Decodable, Equatable, Sendable {
    public let id: UUID
    public let name: String
    public let isCoach: Bool
    public let isPro: Bool
    public let profileOpen: Bool
    public let avatarFileId: UUID?
    public let sport: String?
    public let specialization: String?
    public let experienceYears: Int?
    public let postsCount: Int
    public let mutedByMe: Bool
}

struct BlogImage: Decodable, Sendable {
    let fileId: UUID
}

/// An article as the author sends it. `submit` false keeps a draft; true sends it through the automatic check.
public struct PostDraft: Encodable, Equatable, Sendable {
    public var title: String
    public var sport: String
    public var blocks: [PostBlock]
    public var imageIds: [UUID]
    public var listingId: UUID?
    public var submit: Bool

    public init(title: String = "", sport: String = "", blocks: [PostBlock] = [], imageIds: [UUID] = [], listingId: UUID? = nil, submit: Bool = false) {
        self.title = title
        self.sport = sport
        self.blocks = blocks
        self.imageIds = imageIds
        self.listingId = listingId
        self.submit = submit
    }

    public static let titleRange = 3...120
    public static let minLength = 30
    public static let maxLength = 10_000
    public static let maxImages = 3

    /// The count of characters the server checks the length by (without the markers).
    public var textLength: Int {
        blocks.reduce(0) { total, block in
            total + (block.type == .list ? (block.items ?? []).reduce(0) { $0 + BlogMarkup.plain($1).count } : BlogMarkup.plain(block.text ?? "").count)
        }
    }

    /// What is wrong, in words the author can act on (the server checks again, and also looks for contacts).
    public var problems: [String] {
        var found: [String] = []
        let title = title.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        if !Self.titleRange.contains(title.count) { found.append("Заголовок: от 3 до 120 знаков.") }
        if sport.isEmpty { found.append("Выберите вид спорта.") }
        if textLength < Self.minLength { found.append("Статья слишком короткая: нужно хотя бы 30 знаков.") }
        if textLength > Self.maxLength { found.append("Статья слишком длинная: не больше 10 000 знаков.") }
        return found
    }

    public var isReady: Bool { problems.isEmpty }

    private enum CodingKeys: String, CodingKey { case title, sport, blocks, imageIds, listingId, submit }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(title, forKey: .title)
        try container.encode(sport, forKey: .sport)
        try container.encode(blocks.filter { !$0.isEmpty }, forKey: .blocks)
        try container.encode(imageIds, forKey: .imageIds)
        try container.encodeIfPresent(listingId, forKey: .listingId)
        try container.encode(submit, forKey: .submit)
    }

    /// The draft of an existing article, for editing.
    public init(editing post: Post) {
        self.init(title: post.title, sport: post.sport, blocks: post.blocks, imageIds: post.imageIds, listingId: post.listing?.id)
    }
}

/// The inline markers of the text: `**bold**` and `*italic*`, nothing else. The text is shown as text (never as HTML), and an unpaired
/// marker stays as typed — the same rule as the site's.
public enum BlogMarkup {
    public struct Run: Equatable, Sendable {
        public let text: String
        public let bold: Bool
        public let italic: Bool
    }

    private static let pattern = try! NSRegularExpression(pattern: #"\*\*(.+?)\*\*|\*(.+?)\*"#)

    public static func runs(_ text: String) -> [Run] {
        let source = text as NSString
        var result: [Run] = []
        var last = 0
        for match in pattern.matches(in: text, range: NSRange(location: 0, length: source.length)) {
            if match.range.location > last {
                result.append(Run(text: source.substring(with: NSRange(location: last, length: match.range.location - last)), bold: false, italic: false))
            }
            let bold = match.range(at: 1)
            if bold.location != NSNotFound {
                result.append(Run(text: source.substring(with: bold), bold: true, italic: false))
            } else {
                result.append(Run(text: source.substring(with: match.range(at: 2)), bold: false, italic: true))
            }
            last = match.range.location + match.range.length
        }
        if last < source.length { result.append(Run(text: source.substring(from: last), bold: false, italic: false)) }
        return result
    }

    /// The text with the markers removed: what its length is counted by.
    public static func plain(_ text: String) -> String { text.replacingOccurrences(of: "*", with: "") }

    /// Puts the marker around the selection (UTF-16 offsets, as a text view counts them); with nothing selected, a pair of markers with the
    /// cursor between them. A selection already wrapped in this marker is unwrapped.
    public static func wrap(_ text: String, location: Int, length: Int, marker: String) -> (text: String, location: Int, length: Int) {
        let source = text as NSString
        let location = max(0, min(location, source.length))
        let length = max(0, min(length, source.length - location))
        let before = source.substring(to: location)
        let chosen = source.substring(with: NSRange(location: location, length: length))
        let after = source.substring(from: location + length)
        let markerLength = (marker as NSString).length
        if (chosen as NSString).length >= markerLength * 2, chosen.hasPrefix(marker), chosen.hasSuffix(marker) {
            let inner = (chosen as NSString).substring(with: NSRange(location: markerLength, length: (chosen as NSString).length - markerLength * 2))
            return (before + inner + after, location, (inner as NSString).length)
        }
        return (before + marker + chosen + marker + after, location + markerLength, length)
    }
}

extension CoachListingCard {
    /// The card of an offer attached to an article, as the booking screens take it (they read the rest of the offer from the server).
    public init(blogListing listing: PostListingCard, coachName: String, sport: String) {
        self.init(
            id: listing.id, title: listing.title, description: nil, coachUserId: listing.coachUserId, coachFullName: coachName, coachIsPro: nil,
            sport: sport, specialization: nil, experienceYears: nil, averageRating: nil, reviewCount: 0,
            pricePerSession: listing.pricePerSession.map { Decimal($0) }, currency: listing.currency, location: nil, offersOnline: false,
            offersOffline: false, photoFileId: listing.photoFileId, nextAvailableSlot: nil
        )
    }
}
