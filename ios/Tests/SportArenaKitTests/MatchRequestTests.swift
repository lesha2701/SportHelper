import Foundation
import Testing
@testable import SportArenaKit

private let base = URL(string: "https://sportarenaglobal.ru")!
private let one = "11111111-2222-4333-8444-555555555555"

private func requestJSON(status: String = "new", extra: String = "") -> String {
    """
    {"id":"\(one)","sport":"Теннис","goal":"Подача","level":"amateur","format":"offline","city":"Москва","budget_min":1500.0,"budget_max":3000.0,
     "currency":"RUB","weekdays":[5,1],"day_parts":["evening"],"schedule_note":"после 19:00","comment":null,"status":"\(status)",
     "created_at":"2026-11-23T10:00:00Z"\(extra)}
    """
}

struct MatchRequestDraftTests {
    @Test func onlyTheSportIsRequired() {
        var draft = MatchRequestDraft()
        #expect(!draft.isReady)
        draft.sport = "  "
        #expect(!draft.isReady)
        draft.sport = "Я"
        #expect(!draft.isReady)
        draft.sport = "  Плавание "
        #expect(draft.isReady)
        #expect(draft.tidySport == "Плавание")
    }

    @Test func emptyFieldsAreLeftOutOfTheRequest() throws {
        var draft = MatchRequestDraft()
        draft.sport = "Плавание"
        let body = try #require(JSONSerialization.jsonObject(with: APIClient.encoder.encode(draft.body)) as? [String: Any])
        #expect(body["sport"] as? String == "Плавание")
        for key in ["goal", "level", "format", "city", "budget_min", "budget_max", "schedule_note", "comment"] { #expect(body[key] == nil, "\(key)") }
        #expect(body["weekdays"] as? [Int] == [])
    }

    @Test func everythingFilledIsSentTidy() throws {
        var draft = MatchRequestDraft()
        draft.sport = "Теннис"
        draft.goal = "  Подача  \n\n"
        draft.level = .amateur
        draft.format = .offline
        draft.city = "  Санкт-  Петербург "
        draft.budgetMin = "1 500"
        draft.budgetMax = "3000,50"
        draft.weekdays = [5, 1]
        draft.dayParts = [.evening, .morning]
        draft.scheduleNote = " после 19:00 "
        let body = try #require(JSONSerialization.jsonObject(with: APIClient.encoder.encode(draft.body)) as? [String: Any])
        #expect(body["goal"] as? String == "Подача")
        #expect(body["level"] as? String == "amateur")
        #expect(body["city"] as? String == "Санкт- Петербург")
        #expect(body["weekdays"] as? [Int] == [1, 5])
        #expect(body["day_parts"] as? [String] == ["morning", "evening"])
        #expect(body["schedule_note"] as? String == "после 19:00")
        #expect((body["budget_min"] as? NSNumber)?.doubleValue == 1500)
        #expect((body["budget_max"] as? NSNumber)?.doubleValue == 3000.5)
    }

    @Test func aBadBudgetBlocksSending() {
        var draft = MatchRequestDraft()
        draft.sport = "Теннис"
        draft.budgetMin = "много"
        #expect(draft.budgetProblem == "Бюджет: только цифры." && !draft.isReady)
        draft.budgetMin = "5000"
        draft.budgetMax = "1000"
        #expect(draft.budgetProblem != nil && !draft.isReady)
        draft.budgetMax = "5000"
        #expect(draft.budgetProblem == nil && draft.isReady)
        draft.budgetMin = ""
        #expect(draft.budgetProblem == nil)
    }
}

struct MatchRequestModelTests {
    @Test func theRequestIsReadAndDescribedInTheSitesWords() throws {
        let request = try APIClient.decoder.decode(MatchRequest.self, from: Data(requestJSON().utf8))
        #expect(request.status == .new && request.status.isOpen)
        #expect(request.whenText == "Вт, Сб · вечер · после 19:00")
        #expect(request.budgetText?.hasPrefix("от 1") == true && request.budgetText?.contains("до 3") == true)
        #expect(request.level?.title == "Любитель" && request.format?.title == "Очно")
    }

    @Test func theStatusesAreSaidSoftlyAndOnlyOpenOnesCanBeWithdrawn() throws {
        func status(_ raw: String) throws -> MatchRequestStatus {
            try APIClient.decoder.decode(MatchRequest.self, from: Data(requestJSON(status: raw).utf8)).status
        }
        #expect(try status("in_progress").title == "Подбираем тренера")
        #expect(try status("in_progress").isOpen)
        #expect(try !status("closed").isOpen && !status("canceled").isOpen)
        #expect(try status("closed").title == "Обработана")
    }

    @Test func noBudgetNoTimeMeansNoText() throws {
        let json = """
        {"id":"\(one)","sport":"Бокс","goal":null,"level":null,"format":null,"city":null,"budget_min":null,"budget_max":null,"currency":"RUB",
         "weekdays":[],"day_parts":[],"schedule_note":null,"comment":null,"status":"new","created_at":"2026-11-23T10:00:00Z"}
        """
        let request = try APIClient.decoder.decode(MatchRequest.self, from: Data(json.utf8))
        #expect(request.budgetText == nil && request.whenText == nil)
    }
}

struct MatchRequestsServiceTests {
    private func make(_ handler: @escaping MockServer.Handler) -> MatchRequestsService {
        MatchRequestsService(client: APIClient(baseURL: base, session: MockServer.session(handler)))
    }

    @Test func sendingPostsTheTidyForm() async throws {
        let service = make { request in
            #expect(request.httpMethod == "POST" && request.url?.path == "/api/match-requests")
            #expect(request.bodyJSON?["sport"] as? String == "Теннис")
            return json(requestJSON(), status: 201)
        }
        var draft = MatchRequestDraft()
        draft.sport = " Теннис "
        #expect(try await service.create(draft).sport == "Теннис")
    }

    @Test func theListAndTheWithdrawalUseTheirOwnPaths() async throws {
        let service = make { request in
            if request.httpMethod == "GET" {
                #expect(request.url?.path == "/api/match-requests/mine")
                return json("[\(requestJSON())]")
            }
            #expect(request.httpMethod == "POST" && request.url?.path == "/api/match-requests/\(one)/cancel")
            return json(requestJSON(status: "canceled"))
        }
        #expect(try await service.mine().count == 1)
        #expect(try await service.cancel(UUID(uuidString: one)!).status == .canceled)
    }

    @Test func aRefusalCarriesTheServersWords() async {
        let service = make { _ in json(#"{"error":{"code":"too_many_open","message":"У вас уже есть заявки на подбор."}}"#, status: 409) }
        var draft = MatchRequestDraft()
        draft.sport = "Теннис"
        do {
            _ = try await service.create(draft)
            Issue.record("expected an error")
        } catch let error as APIError {
            #expect(error.code == "too_many_open")
        } catch {
            Issue.record("unexpected \(error)")
        }
    }
}
