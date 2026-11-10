import Foundation

public final class SearchService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    /// Up to five of each kind. An empty list for a question shorter than two letters, without asking the server.
    public func search(_ text: String) async throws -> [SearchResult] {
        guard let question = SearchLogic.question(text) else { return [] }
        return try await client.send(.get, "/api/search", query: [URLQueryItem(name: "q", value: question)])
    }
}
