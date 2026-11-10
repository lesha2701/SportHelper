import Foundation
import Testing
@testable import SportArenaKit

private let base = URL(string: "https://sportarenaglobal.ru")!
private let one = "11111111-2222-4333-8444-555555555555"

/// JSON from a dictionary: the fields of the server's answers are many and the lines would be long.
private func body(_ value: Any) -> (status: Int, headers: [String: String], body: Data) {
    let data = (try? JSONSerialization.data(withJSONObject: value)) ?? Data()
    return (200, ["Content-Type": "application/json"], data)
}

private let none = NSNull()

private func coachFields(rating: Any = 4.75, reviews: Int = 8, specialization: Any = "Подача") -> [String: Any] {
    [
        "user_id": one, "full_name": "Анна Тренер", "sport": "Теннис", "specialization": specialization, "experience_years": 7,
        "description": "Люблю теннис", "avatar_file_id": none, "average_rating": rating, "review_count": reviews,
    ]
}

private func playerFields(level: Any = "amateur", position: Any = "Защитник") -> [String: Any] {
    [
        "user_id": one, "full_name": "Игорь Петров", "age": 15, "height_cm": 170, "weight_kg": 58.5, "sport": "Футбол", "position": position,
        "level": level, "goals": "Попасть в сборную", "load_restrictions": none, "avatar_file_id": none,
    ]
}

private func mediaFields(_ type: String, caption: Any) -> [String: Any] {
    ["id": one, "user_id": one, "file_id": one, "media_type": type, "caption": caption, "sort_order": 0, "created_at": "2026-11-05T10:00:00Z"]
}

struct PublicProfilesTests {
    private func make(_ handler: @escaping MockServer.Handler) -> PublicProfilesService {
        PublicProfilesService(client: APIClient(baseURL: base, session: MockServer.session(handler)))
    }

    @Test func aCoachPageIsReadWithItsRatingAndSubtitle() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return body(coachFields()) }
        let coach = try await service.coach(UUID(uuidString: one)!)
        #expect(seen.all.first?.url?.path == "/api/coaches/\(one)/profile")
        #expect(coach.fullName == "Анна Тренер" && coach.experienceYears == 7)
        #expect(coach.ratingText == "4,8" && coach.subtitle == "Подача · Теннис")
    }

    @Test func aCoachWithoutReviewsShowsNoRating() async throws {
        let service = make { _ in body(coachFields(rating: none, reviews: 0, specialization: none)) }
        let coach = try await service.coach(UUID(uuidString: one)!)
        #expect(coach.ratingText == nil && coach.subtitle == "Теннис")
    }

    @Test func aPlayerPageKnowsTheLevelAndToleratesANewOne() async throws {
        let service = make { _ in body(playerFields()) }
        let player = try await service.player(UUID(uuidString: one)!)
        #expect(player.skillLevel == .amateur && player.weightKg == 58.5 && player.subtitle == "Защитник · Футбол")
        let later = make { _ in body(playerFields(level: "legend", position: none)) }
        let unknown = try await later.player(UUID(uuidString: one)!)
        #expect(unknown.skillLevel == nil && unknown.level == "legend" && unknown.subtitle == "Футбол")
    }

    @Test func aRefusedPlayerPageCarriesTheServersWords() async throws {
        let service = make { _ in json(#"{"error":{"code":"forbidden","message":"Нет доступа к профилю этого игрока."}}"#, status: 403) }
        do {
            _ = try await service.player(UUID(uuidString: one)!)
            Issue.record("a stranger read the profile")
        } catch let error as APIError {
            #expect(error.status == 403 && error.message == "Нет доступа к профилю этого игрока.")
        }
    }

    @Test func theCoachesReviewsOfAPlayerComeWithTheirAverage() async throws {
        let service = make { _ in
            let first: [String: Any] = ["id": one, "coach_name": "Анна", "rating": 5, "text": "Молодец", "created_at": "2026-11-05T10:00:00Z"]
            let second: [String: Any] = ["id": one, "coach_name": "Олег", "rating": 4, "text": none, "created_at": "2026-11-04T10:00:00Z"]
            return body(["average": 4.5, "count": 2, "reviews": [first, second]] as [String: Any])
        }
        let reviews = try await service.reviews(ofPlayer: UUID(uuidString: one)!)
        #expect(reviews.count == 2 && reviews.averageText == "4,5" && reviews.reviews[1].text == nil)
    }

    @Test func theGalleryTellsPhotosFromVideos() async throws {
        let seen = RequestLog()
        let service = make { request in
            seen.add(request)
            return body([mediaFields("photo", caption: "Кубок"), mediaFields("video", caption: none)])
        }
        let media = try await service.media(of: UUID(uuidString: one)!)
        #expect(seen.all.first?.url?.path == "/api/profile/media/\(one)")
        #expect(media.map(\.kind) == [.photo, .video] && media[0].caption == "Кубок")
    }

    @Test func aListOfACoachsListingsUsesTheCatalogueCards() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json("[]") }
        let listings = try await service.listings(ofCoach: UUID(uuidString: one)!)
        #expect(listings.isEmpty && seen.all.first?.url?.path == "/api/coaches/\(one)/listings")
    }
}
