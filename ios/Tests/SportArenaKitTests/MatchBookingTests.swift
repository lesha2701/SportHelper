import Foundation
import Testing
@testable import SportArenaKit

private func bookingJSON(extra: String = "", payment: String = "unpaid", name: String = "Игорь Петров") -> String {
    """
    {"id":"11111111-2222-4333-8444-555555555555","coach_user_id":"99999999-2222-4333-8444-555555555555","coach_full_name":"Анна Тренер","listing_id":null,
     "listing_title":"Теннис","athlete_user_id":"77777777-2222-4333-8444-555555555555","athlete_full_name":"\(name)","athlete_notes":null,
     "starts_at":"2026-11-05T10:00:00Z","duration_minutes":60,"format":"online","price_per_session":2500,"currency":"RUB","status":"confirmed",
     "payment_status":"\(payment)","is_completed":false,"training_id":null,"training_plan_id":null,"training_plan_name":null,"training_status":null,
     "has_review":false,"has_player_review":false,"paid_at":null\(extra)}
    """
}

private func pendingJSON(extra: String = "") -> String {
    """
    {"id":"11111111-2222-4333-8444-555555555555","listing_title":"Теннис","athlete_user_id":"77777777-2222-4333-8444-555555555555",
     "athlete_full_name":"Спортсмен из подбора","athlete_notes":null,"starts_at":"2026-11-05T10:00:00Z","duration_minutes":60,"format":"online",
     "price_per_session":2500,"currency":"RUB","created_at":"2026-11-01T10:00:00Z","athlete_rating_average":null,"athlete_review_count":0\(extra)}
    """
}

struct MatchBookingTests {
    @Test func anOrdinaryBookingFromAnOlderServerHasNothingOfTheMatching() throws {
        let booking = try APIClient.decoder.decode(Booking.self, from: Data(bookingJSON().utf8))
        #expect(!booking.fromMatch && !booking.athleteHidden && booking.matchPercent == nil)
        #expect(booking.matchNote(viewerIsCoach: true) == nil && booking.matchNote(viewerIsCoach: false) == nil)
    }

    @Test func theTrainerIsToldWhoIsHiddenAndWhatThePlatformKeeps() throws {
        let booking = try APIClient.decoder.decode(
            Booking.self, from: Data(bookingJSON(extra: ",\"from_match\":true,\"match_percent\":50,\"athlete_hidden\":true", name: "Спортсмен из подбора").utf8))
        #expect(booking.fromMatch && booking.athleteHidden && booking.matchPercent == 50)
        let note = try #require(booking.matchNote(viewerIsCoach: true))
        #expect(note.contains("имя и контакты откроются после оплаты") && note.contains("50%"))
    }

    @Test func theAthleteIsToldTheFirstSessionIsPaidInTheAppUntilItIs() throws {
        let unpaid = try APIClient.decoder.decode(Booking.self, from: Data(bookingJSON(extra: ",\"from_match\":true").utf8))
        #expect(unpaid.matchNote(viewerIsCoach: false)?.contains("оплачивается в приложении") == true)
        let paid = try APIClient.decoder.decode(Booking.self, from: Data(bookingJSON(extra: ",\"from_match\":true", payment: "paid").utf8))
        #expect(paid.matchNote(viewerIsCoach: false) == nil)
        #expect(paid.matchNote(viewerIsCoach: true)?.hasPrefix("Клиент из подбора.") == true)
    }

    @Test func aRequestOfAClientFromTheMatchingOffersNoProfile() throws {
        let hidden = try APIClient.decoder.decode(PendingBooking.self, from: Data(pendingJSON(extra: ",\"from_match\":true,\"match_percent\":37.5,\"athlete_hidden\":true").utf8))
        #expect(hidden.athleteHidden && hidden.fromMatch && hidden.matchPercent == Decimal(string: "37.5"))
        #expect(hidden.matchNote?.contains("37.5%") == true)
        let plain = try APIClient.decoder.decode(PendingBooking.self, from: Data(pendingJSON().utf8))
        #expect(!plain.athleteHidden && plain.matchNote == nil && plain.athleteFullName == "Спортсмен из подбора")
    }
}
