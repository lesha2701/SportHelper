import Foundation
import Testing
@testable import SportArenaKit

private let base = URL(string: "https://sportarenaglobal.ru")!

struct ComplaintsTests {
    @Test func aReasonIsNeededAndOtherNeedsWords() {
        #expect(!ComplaintDraft().isReady)
        #expect(ComplaintDraft(reason: .spam).isReady)
        #expect(!ComplaintDraft(reason: .other).isReady)
        #expect(!ComplaintDraft(reason: .other, comment: "  а  ").isReady)
        #expect(ComplaintDraft(reason: .other, comment: "не то").isReady)
        #expect(ComplaintDraft(reason: .other).needsComment && !ComplaintDraft(reason: .fraud).needsComment)
    }

    @Test func theCommentIsTidiedLikeTheServerDoes() {
        #expect(ComplaintDraft(reason: .spam, comment: "  много \n  пробелов  ").tidyComment == "много пробелов")
        #expect(ComplaintDraft(reason: .spam, comment: " \n ").tidyComment == nil)
        #expect(ComplaintDraft(reason: .spam, comment: String(repeating: "я", count: 1500)).tidyComment?.count == 1000)
    }

    @Test func theReasonsAreTheSitesFiveInItsOrder() {
        #expect(ComplaintReason.allCases.map(\.rawValue) == ["inappropriate", "fraud", "spam", "false_info", "other"])
        #expect(ComplaintReason.allCases.map(\.title) == ["Недопустимый контент", "Мошенничество", "Спам", "Ложная информация", "Другая причина"])
    }

    @Test func aComplaintIsSentWithItsTargetReasonAndComment() async throws {
        let seen = RequestLog()
        let api = APIClient(baseURL: base, session: MockServer.session { request in
            seen.add(request)
            return json(#"{"id":"11111111-2222-4333-8444-555555555555","status":"new"}"#, status: 201)
        })
        let target = UUID(uuidString: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")!

        try await ComplaintsService(client: api).report(.user, id: target, draft: ComplaintDraft(reason: .falseInfo, comment: " пишет  неправду "))

        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "POST" && request.url?.path == "/api/complaints")
        let body = try #require(request.bodyJSON)
        #expect(body["target_type"] as? String == "user" && body["reason"] as? String == "false_info")
        #expect(body["target_id"] as? String == target.uuidString.lowercased() || body["target_id"] as? String == target.uuidString)
        #expect(body["comment"] as? String == "пишет неправду")
    }

    @Test func noCommentIsLeftOut() async throws {
        let seen = RequestLog()
        let api = APIClient(baseURL: base, session: MockServer.session { request in
            seen.add(request)
            return json(#"{"id":"11111111-2222-4333-8444-555555555555","status":"new"}"#, status: 201)
        })

        try await ComplaintsService(client: api).report(.listing, id: UUID(), draft: ComplaintDraft(reason: .spam))

        let body = try #require(seen.all.first?.bodyJSON)
        #expect(body["target_type"] as? String == "listing")
        #expect(body["comment"] == nil)
    }

    @Test func anIncompleteDraftIsNeverSent() async {
        let seen = RequestLog()
        let api = APIClient(baseURL: base, session: MockServer.session { request in seen.add(request); return json("{}") })

        await #expect(throws: APIError.self) { try await ComplaintsService(client: api).report(.user, id: UUID(), draft: ComplaintDraft(reason: .other)) }
        #expect(seen.all.isEmpty)
    }

    @Test func theServersRefusalsReachTheCaller() async throws {
        let api = APIClient(baseURL: base, session: MockServer.session { _ in
            json(#"{"error":{"code":"already_reported","message":"Вы уже отправили жалобу на это — мы её рассматриваем."}}"#, status: 409)
        })

        do {
            try await ComplaintsService(client: api).report(.media, id: UUID(), draft: ComplaintDraft(reason: .spam))
            Issue.record("should have thrown")
        } catch let error as APIError {
            #expect(error.code == "already_reported" && error.message.hasPrefix("Вы уже отправили"))
        }
    }
}
