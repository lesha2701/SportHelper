import Foundation

/// Blog articles: reading (open to guests on the server, but the app always has a session), writing, likes, saving, hiding, comments.
public final class BlogService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    private func id(_ value: UUID) -> String { value.uuidString.lowercased() }
    private func post(_ value: UUID, _ tail: String = "") -> String { "/api/blog/posts/\(id(value))\(tail)" }

    // MARK: reading

    public func sports() async throws -> [String] {
        try await client.send(.get, "/api/blog/sports")
    }

    /// The feed: filtered by sport (nil: all), by author, in the given order, page by page.
    public func feed(sport: String? = nil, author: UUID? = nil, sort: FeedSort = .new, limit: Int = 20, offset: Int = 0) async throws -> PostPage {
        var query = [URLQueryItem(name: "sort", value: sort.rawValue), URLQueryItem(name: "limit", value: String(limit)), URLQueryItem(name: "offset", value: String(offset))]
        if let sport, !sport.isEmpty { query.append(URLQueryItem(name: "sport", value: sport)) }
        if let author { query.append(URLQueryItem(name: "author_id", value: id(author))) }
        return try await client.send(.get, "/api/blog/posts", query: query)
    }

    /// The article for the home screen: the best one for the person's sport (nil when there is none).
    public func featured() async throws -> PostCard? {
        try await client.send(.get, "/api/blog/featured")
    }

    public func mine() async throws -> [MyPost] {
        try await client.send(.get, "/api/blog/mine")
    }

    public func bookmarks(limit: Int = 20, offset: Int = 0) async throws -> PostPage {
        try await client.send(
            .get, "/api/blog/bookmarks", query: [URLQueryItem(name: "limit", value: String(limit)), URLQueryItem(name: "offset", value: String(offset))]
        )
    }

    public func read(_ postId: UUID) async throws -> Post {
        try await client.send(.get, post(postId))
    }

    /// Counts the view (once a day for a person, never the author's own); a failure matters to nobody.
    public func countView(_ postId: UUID) async {
        try? await client.sendIgnoringResponse(.post, post(postId, "/view"))
    }

    // MARK: writing

    /// Uploads one photo; the article names it afterwards in `imageIds`.
    public func uploadImage(_ data: Data, filename: String = "post.jpg", mimeType: String = "image/jpeg") async throws -> UUID {
        let image: BlogImage = try await client.upload("/api/blog/images", file: UploadFile(filename: filename, mimeType: mimeType, data: data))
        return image.fileId
    }

    public func create(_ draft: PostDraft) async throws -> Post {
        try await client.send(.post, "/api/blog/posts", body: draft)
    }

    public func update(_ postId: UUID, _ draft: PostDraft) async throws -> Post {
        try await client.send(.put, post(postId), body: draft)
    }

    public func delete(_ postId: UUID) async throws {
        try await client.sendIgnoringResponse(.delete, post(postId))
    }

    // MARK: reactions

    public func like(_ postId: UUID, on: Bool) async throws -> LikeState {
        try await client.send(on ? .put : .delete, post(postId, "/like"))
    }

    public func bookmark(_ postId: UUID, on: Bool) async throws {
        try await client.sendIgnoringResponse(on ? .put : .delete, post(postId, "/bookmark"))
    }

    public func hide(_ postId: UUID, on: Bool) async throws {
        try await client.sendIgnoringResponse(on ? .put : .delete, post(postId, "/hide"))
    }

    public func muteAuthor(_ author: UUID, on: Bool) async throws {
        try await client.sendIgnoringResponse(on ? .put : .delete, "/api/blog/authors/\(id(author))/mute")
    }

    // MARK: comments

    public func comments(_ postId: UUID) async throws -> [PostComment] {
        try await client.send(.get, post(postId, "/comments"))
    }

    public func addComment(_ postId: UUID, body: String) async throws -> PostComment {
        try await client.send(.post, post(postId, "/comments"), body: CommentRequest(body: body))
    }

    public func deleteComment(_ commentId: UUID) async throws {
        try await client.sendIgnoringResponse(.delete, "/api/blog/comments/\(id(commentId))")
    }

    // MARK: authors and settings

    public func author(_ authorId: UUID) async throws -> AuthorProfile {
        try await client.send(.get, "/api/blog/authors/\(id(authorId))")
    }

    public func settings() async throws -> BlogSettings {
        try await client.send(.get, "/api/blog/settings")
    }

    public func setShowProfile(_ show: Bool) async throws -> BlogSettings {
        try await client.send(.put, "/api/blog/settings", body: SettingsRequest(showProfileInPosts: show))
    }
}

struct CommentRequest: Encodable, Sendable { let body: String }
struct SettingsRequest: Encodable, Sendable { let showProfileInPosts: Bool }
