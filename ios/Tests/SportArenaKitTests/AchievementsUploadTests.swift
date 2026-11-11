import Foundation
import Testing
@testable import SportArenaKit

private let host = URL(string: "https://sportarenaglobal.ru")!

struct AchievementsUploadTests {
    private let mediaJSON = """
    {"id":"AAAAAAAA-2222-4333-8444-555555555551","user_id":"11111111-2222-4333-8444-555555555555","file_id":"BBBBBBBB-2222-4333-8444-555555555552",
     "media_type":"photo","caption":null,"sort_order":0,"created_at":"2026-11-11T10:00:00Z"}
    """

    private func client(_ handler: @escaping MockServer.Handler) -> APIClient { APIClient(baseURL: host, session: MockServer.session(handler)) }

    @Test func aPhotoIsSentAsAMultipartFileToTheGalleryRoute() async throws {
        let seen = RequestLog()
        let service = ProfileService(client: client { request in seen.add(request); return json(mediaJSON) })
        let media = try await service.addAchievementPhoto(data: Data([1, 2, 3]))
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "POST" && request.url?.path == "/api/profile/media/photo")
        #expect(request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data; boundary=") == true)
        let body = String(decoding: try #require(request.bodyData), as: UTF8.self)
        #expect(body.contains("name=\"file\"; filename=\"photo.jpg\"") && body.contains("Content-Type: image/jpeg"))
        #expect(media.kind == .photo && media.sortOrder == 0)
    }

    @Test func aVideoIsSentAsAnMP4AndTheAnswerIsAVideo() async throws {
        let seen = RequestLog()
        let video = mediaJSON.replacingOccurrences(of: "\"photo\"", with: "\"video\"")
        let service = ProfileService(client: client { request in seen.add(request); return json(video) })
        let media = try await service.addAchievementVideo(data: Data([9, 9]))
        let request = try #require(seen.all.first)
        #expect(request.url?.path == "/api/profile/media/video")
        let body = String(decoding: try #require(request.bodyData), as: UTF8.self)
        #expect(body.contains("filename=\"video.mp4\"") && body.contains("Content-Type: video/mp4"))
        #expect(media.kind == .video)
    }

    @Test func deletingUsesTheMediaIdInTheLowerCasePath() async throws {
        let seen = RequestLog()
        let service = ProfileService(client: client { request in seen.add(request); return (204, [:], Data()) })
        try await service.deleteAchievement(id: try #require(UUID(uuidString: "AAAAAAAA-2222-4333-8444-555555555551")))
        #expect(seen.all.first?.httpMethod == "DELETE" && seen.all.first?.url?.path == "/api/profile/media/aaaaaaaa-2222-4333-8444-555555555551")
    }

    @Test func aTeamLogoGoesToTheTeamsLogoRouteAndTheTeamComesBack() async throws {
        let seen = RequestLog()
        let team = """
        {"id":"CCCCCCCC-2222-4333-8444-555555555553","name":"Орлы","description":null,"sport":"Футбол","age_category":null,"status":"active",
         "created_by":"11111111-2222-4333-8444-555555555555","logo_file_id":"DDDDDDDD-2222-4333-8444-555555555554","my_role":"head_coach","members_count":5}
        """
        let service = TeamsService(client: client { request in seen.add(request); return json(team) })
        let id = try #require(UUID(uuidString: "CCCCCCCC-2222-4333-8444-555555555553"))
        let updated = try await service.uploadLogo(of: id, data: Data([1]))
        #expect(seen.all.first?.url?.path == "/api/teams/cccccccc-2222-4333-8444-555555555553/logo")
        #expect(updated.logoFileId == UUID(uuidString: "DDDDDDDD-2222-4333-8444-555555555554") && updated.canManage)
    }

    @Test func theServersRefusalsOfAVideoAreToldInRussian() {
        #expect(VideoRules.russian(code: "video_too_long")?.contains("60") == true)
        #expect(VideoRules.russian(code: "invalid_video") != nil)
        #expect(VideoRules.russian(code: "storage_error") == nil)
    }
}
