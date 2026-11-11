import Foundation

/// The person's profile and avatar.
public final class ProfileService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    public func me() async throws -> ProfileMe {
        try await client.send(.get, "/api/profile/me")
    }

    /// An administrator works as a player or as a coach and may change over (anyone else is told the role is fixed).
    public func switchMode(to mode: String) async throws -> ProfileMe {
        try await client.send(.post, "/api/profile/active-mode", body: ["mode": mode])
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

    // MARK: achievements (the person's own gallery; other people's is read through `PublicProfilesService`)

    /// Adds a photo to the gallery. The server checks it, shrinks it and converts it, like an avatar.
    public func addAchievementPhoto(data: Data, filename: String = "photo.jpg", mimeType: String = "image/jpeg") async throws -> ProfileMedia {
        try await client.upload("/api/profile/media/photo", file: UploadFile(filename: filename, mimeType: mimeType, data: data))
    }

    /// Adds a video (an MP4 the app made of the picked one: at most 100 МБ and 60 seconds, `VideoRules`). A long upload: the timeout is longer.
    public func addAchievementVideo(data: Data) async throws -> ProfileMedia {
        try await client.upload(
            "/api/profile/media/video", file: UploadFile(filename: "video.mp4", mimeType: VideoRules.mimeType, data: data), timeout: 300
        )
    }

    /// Takes one of the person's own photos or videos out of the gallery (404 for anyone else's).
    public func deleteAchievement(id: UUID) async throws {
        try await client.sendIgnoringResponse(.delete, "/api/profile/media/\(id.uuidString.lowercased())")
    }

    /// A picture the person may see (an avatar, a photo in a chat): the small copy for lists, or the full file.
    public func fileData(id: UUID, thumbnail: Bool = true) async throws -> Data {
        try await client.data("/api/files/\(id.uuidString.lowercased())", query: thumbnail ? [URLQueryItem(name: "size", value: "thumb")] : [])
    }
}
