import Foundation
import Testing
@testable import SportArenaKit

private let base = URL(string: "https://sportarenaglobal.ru")!
private let one = "11111111-2222-4333-8444-555555555555"

struct PushTests {
    private func make(_ handler: @escaping MockServer.Handler) -> DevicesService {
        DevicesService(client: APIClient(baseURL: base, session: MockServer.session(handler)))
    }

    @Test func theTokenIsHandedToTheServerAsAnIPhoneToken() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json("", status: 204) }
        try await service.register(token: "abcdef0123456789", appVersion: "0.1.0")
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "PUT" && request.url?.path == "/api/devices")
        let body = try #require(request.bodyJSON)
        #expect(body["platform"] as? String == "ios" && body["token"] as? String == "abcdef0123456789" && body["app_version"] as? String == "0.1.0")
    }

    @Test func signingOutRemovesThatPhone() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json("", status: 204) }
        try await service.remove(token: "abcdef0123456789")
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "POST" && request.url?.path == "/api/devices/remove")
        #expect(request.bodyJSON?["token"] as? String == "abcdef0123456789")
    }

    @Test func theSystemsTokenBytesBecomeLowerCaseHex() {
        #expect(DevicesService.hex(Data([0x00, 0xAB, 0x0F, 0xFF])) == "00ab0fff")
    }

    @Test func aTappedPushLeadsWhereTheSameNotificationInTheFeedLeads() throws {
        let id = try #require(UUID(uuidString: one))
        let training = try #require(PushPayload(userInfo: ["category": "new_training", "entity_id": one, "entity_type": "training", "aps": [:]]))
        #expect(training.target == .training(id))
        #expect(PushPayload(userInfo: ["category": "chat_team", "entity_id": one])?.target == .teamChat(id))
        #expect(PushPayload(userInfo: ["category": "booking_decided", "entity_id": one])?.target == .myBookings)
    }

    @Test func aPushTheAppDoesNotUnderstandIsNotOpened() {
        #expect(PushPayload(userInfo: [:]) == nil)
        #expect(PushPayload(userInfo: ["category": "new_task"]) == nil)
        #expect(PushPayload(userInfo: ["category": "new_task", "entity_id": "not-a-uuid"]) == nil)
        #expect(PushPayload(userInfo: ["category": "brand_new_kind", "entity_id": one])?.target == NotificationTarget.none)
    }
}
