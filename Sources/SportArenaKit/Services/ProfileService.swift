import Foundation

/// The person's profile and avatar.
public final class ProfileService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    public func me() async throws -> ProfileMe {
        try await client.send(.get, "/api/profile/me")
    }

    public func savePlayer(_ input: PlayerProfileInput) async throws -> PlayerProfile {
        try await client.send(.put, "/api/profile/player", body: input)
    }

    public func saveCoach(_ input: CoachProfileInput) async throws -> CoachProfile {
        try await client.send(.put, "/api/profile/coach", body: input)
    }

    /// Sets a new avatar. The server checks the picture itself, shrinks it and converts it, so any common photo format works.
    public func uploadAvatar(data: Data, filename: String = "avatar.jpg", mimeType: String = "image/jpeg") async throws -> UserSummary {
        try await client.upload("/api/users/me/avatar", file: UploadFile(filename: filename, mimeType: mimeType, data: data))
    }

    public func removeAvatar() async throws -> UserSummary {
        try await client.send(.delete, "/api/users/me/avatar")
    }

    /// A picture the person may see (an avatar, a photo in a chat): the small copy for lists, or the full file.
    public func fileData(id: UUID, thumbnail: Bool = true) async throws -> Data {
        try await client.data("/api/files/\(id.uuidString.lowercased())", query: thumbnail ? [URLQueryItem(name: "size", value: "thumb")] : [])
    }
}
