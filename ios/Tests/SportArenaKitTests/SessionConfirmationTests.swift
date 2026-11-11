import Foundation
import Testing
@testable import SportArenaKit

/// Confirming that a booked session took place (docs/session-confirmation.md): reading the server's answer and wording it for each side.
private func bookingJSON(confirmation: String) -> String {
    """
    {"id":"11111111-2222-4333-8444-555555555555","coach_user_id":"99999999-2222-4333-8444-555555555555","coach_full_name":"Анна Тренер","listing_id":null,
     "listing_title":"Теннис","athlete_user_id":"77777777-2222-4333-8444-555555555555","athlete_full_name":"Игорь","athlete_notes":null,
     "starts_at":"2026-11-20T10:00:00Z","duration_minutes":60,"format":"offline","price_per_session":2500,"currency":"RUB","status":"confirmed",
     "payment_status":"paid","is_completed":true,"training_id":"33333333-2222-4333-8444-555555555555","training_plan_id":null,"training_plan_name":null,
     "training_status":"scheduled","has_review":false,"has_player_review":false,"paid_at":null,"can_cancel":false,"cancellation":null,
     "session_confirmation":\(confirmation)}
    """
}

private func confirmationJSON(state: String = "awaiting", method: String? = nil, by: String? = nil, kind: String? = nil, text: String? = nil,
                              confirm: Bool = false, problem: Bool = false, getCode: Bool = false, enterCode: Bool = false) -> String {
    func q(_ v: String?) -> String { v.map { "\"\($0)\"" } ?? "null" }
    return """
    {"state":"\(state)","window_closes_at":"2026-11-22T11:00:00Z","coach_marked_at":null,"confirmed_at":null,"confirmed_method":\(q(method)),
     "disputed_by_role":\(q(by)),"dispute_kind":\(q(kind)),"dispute_text":\(q(text)),"resolved_at":null,
     "can_confirm":\(confirm),"can_report_problem":\(problem),"can_get_code":\(getCode),"can_enter_code":\(enterCode)}
    """
}

private func confirmation(_ json: String) throws -> SessionConfirmation {
    let booking = try APIClient.decoder.decode(Booking.self, from: Data(bookingJSON(confirmation: json).utf8))
    return try #require(booking.sessionConfirmation)
}

struct SessionConfirmationTests {
    @Test func theServersAnswerIsReadWithWhatThisSideMayDo() throws {
        let c = try confirmation(confirmationJSON(confirm: true, problem: true, getCode: true))
        #expect(c.state == .awaiting && c.canConfirm && c.canReportProblem && c.canGetCode && !c.canEnterCode && c.hasActions)
    }

    @Test func aBookingWithoutAConfirmationAndAnOlderServerMeanNothingToDo() throws {
        let none = try APIClient.decoder.decode(Booking.self, from: Data(bookingJSON(confirmation: "null").utf8))
        #expect(none.sessionConfirmation == nil)
        let older = bookingJSON(confirmation: "null").replacingOccurrences(of: ",\n     \"session_confirmation\":null", with: "")
        #expect(try APIClient.decoder.decode(Booking.self, from: Data(older.utf8)).sessionConfirmation == nil)
    }

    @Test func aStateThisVersionDoesNotKnowIsWaitingNotAnError() throws {
        #expect(try confirmation(confirmationJSON(state: "something_new")).state == .awaiting)
    }

    @Test func eachSideReadsItsOwnLine() throws {
        let waiting = try confirmation(confirmationJSON())
        #expect(waiting.line(side: .athlete)?.hasPrefix("Тренировка прошла? Подтвердите её или сообщите о проблеме.") == true)
        #expect(waiting.line(side: .athlete)?.contains("автоматически 22 ноября, 11:00") == true)
        #expect(waiting.line(side: .coach)?.hasPrefix("Ждём подтверждения игрока.") == true)
        #expect(try confirmation(confirmationJSON(state: "scheduled")).line(side: .athlete) == nil)
        #expect(try confirmation(confirmationJSON(state: "confirmed", method: "athlete")).line(side: .coach) == "Игрок подтвердил тренировку.")
        #expect(try confirmation(confirmationJSON(state: "confirmed", method: "code")).line(side: .athlete) == "Тренировка подтверждена кодом игрока.")
        #expect(try confirmation(confirmationJSON(state: "auto_confirmed", method: "auto")).line(side: .coach) == "Тренировка подтверждена автоматически.")
        #expect(try confirmation(confirmationJSON(state: "resolved_refunded")).line(side: .athlete) == "Спор решён: деньги возвращаются вам.")
        #expect(try confirmation(confirmationJSON(state: "resolved_released")).line(side: .coach) == "Спор решён: оплата за занятие ваша.")
    }

    @Test func aDisputeSaysWhoReportedWhat() throws {
        let byCoach = try confirmation(confirmationJSON(state: "disputed", by: "coach", kind: "athlete_no_show", text: "Ждал 30 минут"))
        #expect(byCoach.disputeKind == .athleteNoShow && byCoach.disputeText == "Ждал 30 минут")
        #expect(byCoach.line(side: .coach) == "Вы сообщили: игрок не пришёл. Решение примет администратор.")
        #expect(byCoach.line(side: .athlete)?.hasPrefix("Тренер сообщил: игрок не пришёл. Решение примет администратор") == true)
        let byAthlete = try confirmation(confirmationJSON(state: "disputed", by: "athlete", kind: "coach_no_show"))
        #expect(byAthlete.line(side: .coach) == "Игрок сообщил: тренер не пришёл. Оплата заморожена до решения администратора.")
    }

    @Test func eachSideIsOfferedOnlyItsOwnProblemsAndOtherNeedsWords() {
        #expect(SessionProblemKind.offered(to: .athlete) == [.coachNoShow, .notConducted, .other])
        #expect(SessionProblemKind.offered(to: .coach) == [.athleteNoShow, .other])
        #expect(SessionProblemKind.other.needsText("  ") && !SessionProblemKind.other.needsText("Корт закрыт"))
        #expect(!SessionProblemKind.coachNoShow.needsText(""))
    }

    @Test func theCodeIsReadInTwoHalves() throws {
        let code = try APIClient.decoder.decode(SessionCode.self, from: Data(#"{"code":"482913","expires_at":"2026-11-20T10:45:00Z"}"#.utf8))
        #expect(code.display == "482 913")
    }

    @Test func theBodiesAreWhatTheServerExpects() throws {
        let problem = try JSONSerialization.jsonObject(with: try APIClient.encoder.encode(SessionProblemBody(kind: "other", text: "Корт закрыт"))) as? [String: Any]
        #expect(problem?["kind"] as? String == "other" && problem?["text"] as? String == "Корт закрыт")
        let code = try JSONSerialization.jsonObject(with: try APIClient.encoder.encode(SessionCodeBody(code: "482 913"))) as? [String: Any]
        #expect(code?["code"] as? String == "482 913")
    }
}
