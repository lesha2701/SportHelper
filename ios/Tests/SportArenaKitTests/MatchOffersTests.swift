import Foundation
import Testing
@testable import SportArenaKit

private let base = URL(string: "https://sportarenaglobal.ru")!
private let requestId = "11111111-2222-4333-8444-555555555555"
private let offerId = "aaaaaaaa-2222-4333-8444-555555555555"
private let coachId = "bbbbbbbb-2222-4333-8444-555555555555"

private func offerJSON(status: String = "coach_accepted", expires: String = "\"2026-11-27T10:00:00Z\"") -> String {
    """
    {"id":"\(offerId)","status":"\(status)","expires_at":\(expires),
     "coach":{"user_id":"\(coachId)","full_name":"Иван Тренеров","is_pro":true,"photo_url":null,"sport":"Теннис","specialization":"Подача",
              "experience_years":8,"average_rating":4.9,"review_count":14},
     "listings":[{"id":"cccccccc-2222-4333-8444-555555555555","title":"Теннис для взрослых","price_per_session":2500.0,"currency":"RUB"}]}
    """
}

private func requestJSON(status: String = "in_progress", offers: String = "[]") -> String {
    """
    {"id":"\(requestId)","sport":"Теннис","goal":null,"level":null,"format":null,"city":null,"budget_min":null,"budget_max":null,"currency":"RUB",
     "weekdays":[],"day_parts":[],"schedule_note":null,"comment":null,"status":"\(status)","created_at":"2026-11-23T10:00:00Z","offers":\(offers)}
    """
}

private func coachOfferJSON(status: String = "proposed") -> String {
    """
    {"id":"\(offerId)","status":"\(status)","created_at":"2026-11-23T10:00:00Z","expires_at":"2026-11-25T10:00:00Z","first_session_percent":50.0,
     "admin_message":"Подходит по уровню",
     "request":{"sport":"Теннис","goal":"Подача","level":"amateur","format":"offline","city":"Москва","budget_min":1500.0,"budget_max":3000.0,
                "currency":"RUB","weekdays":[1,5],"day_parts":["evening"],"schedule_note":null,"comment":"[контакт скрыт]"}}
    """
}

struct MatchOfferModelTests {
    @Test func theTrainersWhoAgreedAreReadWithTheirCardsAndListings() throws {
        let request = try APIClient.decoder.decode(MatchRequest.self, from: Data(requestJSON(offers: "[\(offerJSON())]").utf8))
        let offer = try #require(request.offers.first)

        #expect(offer.isOpen && offer.status == .coachAccepted && offer.expiresAt != nil)
        #expect(offer.coach.fullName == "Иван Тренеров" && offer.coach.isPro)
        #expect(offer.coach.summary == "Теннис · Подача · стаж 8 лет · ★ 4.9 (14)")
        #expect(offer.listings.first?.text.hasPrefix("Теннис для взрослых — 2") == true)
    }

    @Test func aRequestWithoutOffersStillReads() throws {
        let json = requestJSON().replacingOccurrences(of: ",\"offers\":[]", with: "")
        let request = try APIClient.decoder.decode(MatchRequest.self, from: Data(json.utf8))
        #expect(request.offers.isEmpty)
    }

    @Test func aChosenTrainerHasNoDeadlineAndIsNotOpen() throws {
        let request = try APIClient.decoder.decode(MatchRequest.self, from: Data(requestJSON(status: "matched", offers: "[\(offerJSON(status: "athlete_accepted", expires: "null"))]").utf8))
        #expect(request.status == .matched && request.status.title == "Тренер выбран" && !request.status.isOpen)
        #expect(request.offers[0].expiresAt == nil && !request.offers[0].isOpen)
    }

    @Test func anUnknownOfferStatusDoesNotBreakTheList() throws {
        let request = try APIClient.decoder.decode(MatchRequest.self, from: Data(requestJSON(offers: "[\(offerJSON(status: "something_new"))]").utf8))
        #expect(request.offers[0].status == .other && !request.offers[0].isOpen)
    }

    @Test func theTrainerSeesTheRequestAsFacts() throws {
        let offer = try APIClient.decoder.decode(CoachOffer.self, from: Data(coachOfferJSON().utf8))
        let facts = Dictionary(uniqueKeysWithValues: offer.request.facts.map { ($0.label, $0.value) })

        #expect(offer.isWaiting && offer.statusTitle == "Ждёт вашего ответа" && offer.firstSessionPercent == 50)
        #expect(facts["Цель"] == "Подача" && facts["Уровень"] == "Любитель" && facts["Формат"] == "Очно" && facts["Город"] == "Москва")
        #expect(facts["Когда удобно"] == "Вт, Сб · вечер" && facts["Комментарий"] == "[контакт скрыт]")
        #expect(facts["Бюджет"]?.hasPrefix("от 1") == true)
        #expect(facts.keys.contains("Имя") == false)
    }

    @Test func theAnswersAreSaidFromTheTrainersSide() throws {
        func title(_ status: String) throws -> String {
            try APIClient.decoder.decode(CoachOffer.self, from: Data(coachOfferJSON(status: status).utf8)).statusTitle
        }
        #expect(try title("coach_accepted") == "Вы согласились" && title("coach_declined") == "Вы отказались")
        #expect(try title("athlete_accepted") == "Спортсмен выбрал вас" && title("withdrawn") == "Закрыто" && title("expired") == "Время вышло")
    }

    @Test func theMatchingNotificationsLeadToTheirScreens() {
        let id = UUID()
        #expect(NotificationTarget(category: .matchOffer, entityId: id) == .matchOffers)
        #expect(NotificationTarget(category: .matchOfferReply, entityId: id) == .matchRequests)
        #expect(NotificationCategory.matchOffer.rawValue == "match_offer" && NotificationCategory.matchOfferReply.rawValue == "match_offer_reply")
        // transactional: nothing to switch off
        #expect(!NotificationCategory.switchable.contains(.matchOffer) && !NotificationCategory.switchable.contains(.matchOfferReply))
    }
}

struct MatchOffersServiceTests {
    private func trainer(_ handler: @escaping MockServer.Handler) -> MatchOffersService {
        MatchOffersService(client: APIClient(baseURL: base, session: MockServer.session(handler)))
    }

    private let settingsJSON = """
    {"enabled":true,"accepted_version":"2026-11-23","current_version":"2026-11-23","terms_accepted":true,"first_session_percent":50.0,
     "terms_title":"Условия подбора клиентов","terms":["Первый абзац.","Второй абзац."]}
    """

    @Test func theSettingsAreReadAndSwitchedOnWithTheVersionRead() async throws {
        let service = trainer { request in
            if request.httpMethod == "GET" { return json(settingsJSON) }
            #expect(request.httpMethod == "PUT" && request.url?.path == "/api/match-offers/settings")
            #expect(request.bodyJSON?["enabled"] as? Bool == true && request.bodyJSON?["accept_terms_version"] as? String == "2026-11-23")
            return json(settingsJSON)
        }
        let settings = try await service.settings()
        #expect(settings.enabled && settings.terms.count == 2 && settings.firstSessionPercent == 50)
        #expect(try await service.setEnabled(true, termsVersion: settings.currentVersion).termsAccepted)
    }

    @Test func switchingOffSendsNoVersion() async throws {
        let service = trainer { request in
            #expect(request.bodyJSON?["enabled"] as? Bool == false && request.bodyJSON?["accept_terms_version"] == nil)
            return json(settingsJSON)
        }
        _ = try await service.setEnabled(false, termsVersion: "2026-11-23")
    }

    @Test func theOffersAreListedAndAnswered() async throws {
        let service = trainer { request in
            switch (request.httpMethod, request.url?.path) {
            case ("GET", "/api/match-offers/incoming"): return json("[\(coachOfferJSON())]")
            case ("POST", "/api/match-offers/\(offerId)/accept"): return json(coachOfferJSON(status: "coach_accepted"))
            case ("POST", "/api/match-offers/\(offerId)/decline"):
                #expect(request.bodyJSON?["reason"] as? String == "Нет времени")
                return json(coachOfferJSON(status: "coach_declined"))
            default: Issue.record("unexpected \(request.httpMethod ?? "") \(request.url?.path ?? "")"); return json("{}", status: 500)
            }
        }
        let id = UUID(uuidString: offerId)!
        #expect(try await service.incoming().count == 1)
        #expect(try await service.accept(id).status == .coachAccepted)
        #expect(try await service.decline(id, reason: "  Нет   времени ").status == .coachDeclined)
    }

    @Test func aDeclineWithoutAReasonSendsNone() async throws {
        let service = trainer { request in
            #expect(request.bodyJSON?["reason"] == nil || request.bodyJSON?["reason"] is NSNull)
            return json(coachOfferJSON(status: "coach_declined"))
        }
        _ = try await service.decline(UUID(uuidString: offerId)!, reason: "   ")
    }

    @Test func theAthleteChoosesOrDeclinesATrainer() async throws {
        let service = MatchRequestsService(client: APIClient(baseURL: base, session: MockServer.session { request in
            #expect(request.httpMethod == "POST")
            switch request.url?.path {
            case "/api/match-requests/offers/\(offerId)/accept": return json(requestJSON(status: "matched", offers: "[\(offerJSON(status: "athlete_accepted", expires: "null"))]"))
            case "/api/match-requests/offers/\(offerId)/decline": return json(requestJSON())
            default: Issue.record("unexpected \(request.url?.path ?? "")"); return json("{}", status: 500)
            }
        }))
        let id = UUID(uuidString: offerId)!
        #expect(try await service.accept(offer: id).status == .matched)
        #expect(try await service.decline(offer: id).offers.isEmpty)
    }
}
