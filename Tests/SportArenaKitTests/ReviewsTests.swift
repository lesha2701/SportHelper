import Foundation
import Testing
@testable import SportArenaKit

private let base = URL(string: "https://sportarenaglobal.ru")!
private let bookingId = "11111111-2222-4333-8444-555555555555"

private func booking(
    status: String = "confirmed", completed: Bool = true, training: String? = "scheduled", starts: String = "2026-11-05T10:00:00Z",
    reviewed: Bool = false, playerReviewed: Bool? = false
) -> String {
    let trainingField = training.map { "\"\($0)\"" } ?? "null"
    let playerField = playerReviewed.map { "\"has_player_review\":\($0)," } ?? ""
    return """
    {"id":"\(bookingId)","coach_user_id":"99999999-2222-4333-8444-555555555555","coach_full_name":"Анна Тренер","listing_id":null,
     "listing_title":"Теннис","athlete_user_id":"77777777-2222-4333-8444-555555555555","athlete_full_name":"Игорь Петров","athlete_notes":null,
     "starts_at":"\(starts)","duration_minutes":60,"format":"online","price_per_session":2500,"currency":"RUB","status":"\(status)",
     "is_completed":\(completed),"training_id":"22222222-2222-4333-8444-555555555555","training_plan_id":null,"training_plan_name":null,
     "training_status":\(trainingField),"has_review":\(reviewed),\(playerField)"paid_at":null}
    """
}

private func decode(_ text: String) throws -> Booking { try APIClient.decoder.decode(Booking.self, from: Data(text.utf8)) }
private let after = ISO8601DateFormatter().date(from: "2026-11-05T12:00:00Z")!
private let before = ISO8601DateFormatter().date(from: "2026-11-05T09:00:00Z")!

struct ReviewDraftTests {
    @Test func fiveStarsAreChosenInAdvanceAndOnlyOneToFiveCount() {
        #expect(ReviewDraft().rating == 5 && ReviewDraft().isReady)
        #expect(ReviewDraft(rating: 1).isReady)
        #expect(!ReviewDraft(rating: 0).isReady && !ReviewDraft(rating: 6).isReady)
    }

    @Test func theCommentIsTrimmedEmptyMeansNoneAndItIsCutAtTheServersLimit() {
        #expect(ReviewDraft(text: "  отлично \n").tidyText == "отлично")
        #expect(ReviewDraft(text: " \n ").tidyText == nil)
        #expect(ReviewDraft(text: String(repeating: "я", count: 2500)).tidyText?.count == 2000)
    }
}

struct ReviewRulesTests {
    @Test func theAthleteReviewsOnceAfterTheSessionWasHeld() throws {
        #expect(try decode(booking()).athleteCanReview)
        #expect(!(try decode(booking(completed: false)).athleteCanReview))
        #expect(!(try decode(booking(reviewed: true)).athleteCanReview))
        #expect(!(try decode(booking(status: "pending")).athleteCanReview))
        #expect(!(try decode(booking(completed: false, training: "cancelled")).athleteCanReview))
    }

    @Test func theConductedButtonAppearsOnlyOnceTheSessionHasBegun() throws {
        let scheduled = try decode(booking(completed: false))
        #expect(!scheduled.coachCanMarkConducted(now: before))
        #expect(scheduled.coachCanMarkConducted(now: after))
        #expect(!(try decode(booking(training: "completed")).coachCanMarkConducted(now: after)))
        #expect(!(try decode(booking(completed: false, training: "cancelled")).coachCanMarkConducted(now: after)))
        #expect(!(try decode(booking(completed: false, training: nil)).coachCanMarkConducted(now: after)))
    }

    @Test func theCoachReviewsThePlayerOnlyAfterTheSessionIsMarkedConducted() throws {
        // time has passed but «проведена» is not pressed yet: that button is the way in, so no review button yet
        #expect(!(try decode(booking(completed: true, training: "scheduled")).coachCanReviewPlayer(now: after)))
        #expect(try decode(booking(training: "completed")).coachCanReviewPlayer(now: after))
        #expect(!(try decode(booking(training: "completed", playerReviewed: true)).coachCanReviewPlayer(now: after)))
        #expect(try decode(booking(training: nil)).coachCanReviewPlayer(now: after))
    }

    @Test func anOlderServerThatDoesNotSayIfThePlayerWasReviewedMeansNo() throws {
        #expect(!(try decode(booking(playerReviewed: nil)).hasPlayerReview))
    }
}

struct ReviewServiceTests {
    private func make(_ handler: @escaping MockServer.Handler) -> BookingsService {
        BookingsService(client: APIClient(baseURL: base, session: MockServer.session(handler)))
    }

    @Test func aReviewGoesToTheBookingWithItsStarsAndComment() async throws {
        let seen = RequestLog()
        let service = make { request in
            seen.add(request)
            return json(#"{"id":"\#(bookingId)","booking_id":"\#(bookingId)","rating":4,"text":"хорошо"}"#)
        }
        try await service.review(UUID(uuidString: bookingId)!, draft: ReviewDraft(rating: 4, text: " хорошо "))
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "POST" && request.url?.path == "/api/bookings/\(bookingId)/reviews")
        let body = try #require(request.bodyJSON)
        #expect(body["rating"] as? Int == 4 && body["text"] as? String == "хорошо")
    }

    @Test func aReviewWithoutWordsSendsNoText() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json(#"{"id":"\#(bookingId)","booking_id":"\#(bookingId)","rating":5,"text":null}"#) }
        try await service.reviewPlayer(UUID(uuidString: bookingId)!, draft: ReviewDraft())
        let request = try #require(seen.all.first)
        #expect(request.url?.path == "/api/bookings/\(bookingId)/player-review")
        #expect(request.bodyJSON?["text"] == nil && request.bodyJSON?["rating"] as? Int == 5)
    }

    @Test func aSecondReviewIsRefusedWithTheServersWords() async throws {
        let service = make { _ in json(#"{"error":{"code":"already_reviewed","message":"Отзыв уже оставлен."}}"#, status: 409) }
        do {
            try await service.review(UUID(uuidString: bookingId)!, draft: ReviewDraft())
            Issue.record("a second review went through")
        } catch let error as APIError {
            #expect(error.code == "already_reviewed" && error.message == "Отзыв уже оставлен.")
        }
    }

    @Test func markingTheSessionConductedReturnsTheUpdatedBooking() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json(booking(training: "completed")) }
        let updated = try await service.complete(UUID(uuidString: bookingId)!)
        #expect(seen.all.first?.url?.path == "/api/bookings/\(bookingId)/complete" && seen.all.first?.httpMethod == "POST")
        #expect(updated.trainingStatus == "completed")
    }

    @Test func aCoachsReviewsAreFetchedByTheCoachsId() async throws {
        let seen = RequestLog()
        let api = APIClient(baseURL: base, session: MockServer.session { request in
            seen.add(request)
            return json(#"[{"id":"\#(bookingId)","athlete_first_name":"Игорь","rating":5,"text":null,"created_at":"2026-11-05T10:00:00Z"}]"#)
        })
        let reviews = try await CoachesService(client: api).reviews(ofCoach: UUID(uuidString: bookingId)!)
        #expect(seen.all.first?.url?.path == "/api/coaches/\(bookingId)/reviews")
        #expect(reviews.first?.athleteFirstName == "Игорь" && reviews.first?.text == nil)
    }
}
