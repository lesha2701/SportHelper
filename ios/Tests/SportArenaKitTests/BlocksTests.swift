import Foundation
import Testing
@testable import SportArenaKit

private let base = URL(string: "https://sportarenaglobal.ru")!
private let one = "11111111-2222-4333-8444-555555555555"

struct BlocksServiceTests {
    private func make(_ handler: @escaping MockServer.Handler) -> BlocksService {
        BlocksService(client: APIClient(baseURL: base, session: MockServer.session(handler)))
    }

    @Test func theListIsReadFromTheServer() async throws {
        let service = make { request in
            #expect(request.httpMethod == "GET")
            #expect(request.url?.path == "/api/blocks")
            return json(#"[{"user_id":"\#(one)","full_name":"Иван Петров","blocked_at":"2026-11-20T10:00:00Z"}]"#)
        }
        let list = try await service.blocked()
        #expect(list.count == 1)
        #expect(list[0].userId == UUID(uuidString: one))
        #expect(list[0].fullName == "Иван Петров")
    }

    @Test func blockingIsAPutOnThePerson() async throws {
        let service = make { request in
            #expect(request.httpMethod == "PUT")
            #expect(request.url?.path == "/api/blocks/\(one)")
            return (204, [:], Data())
        }
        try await service.block(UUID(uuidString: one)!)
    }

    @Test func unblockingIsADeleteOnThePerson() async throws {
        let service = make { request in
            #expect(request.httpMethod == "DELETE")
            #expect(request.url?.path == "/api/blocks/\(one)")
            return (204, [:], Data())
        }
        try await service.unblock(UUID(uuidString: one)!)
    }

    @Test func blockingOneselfIsRefusedWithTheServersWords() async {
        let service = make { _ in json(#"{"error":{"code":"cannot_block_self","message":"Нельзя заблокировать себя."}}"#, status: 422) }
        do {
            try await service.block(UUID(uuidString: one)!)
            Issue.record("expected an error")
        } catch let error as APIError {
            #expect(error.code == "cannot_block_self")
        } catch {
            Issue.record("unexpected \(error)")
        }
    }
}

struct BlockedAuthorTests {
    private func message(_ id: Int, from sender: String) -> ChatMessage {
        ChatMessage(id: id, senderId: UUID(uuidString: sender)!, senderName: "x", body: "hi", createdAt: Date(timeIntervalSince1970: 0))
    }

    @Test func aBlockedAuthorsMessagesLeaveTheThreadAndOthersStay() {
        let other = "99999999-2222-4333-8444-555555555555"
        var thread = ChatThread()
        thread.merge([message(1, from: one), message(2, from: other), message(3, from: one)])
        thread.remove(senderId: UUID(uuidString: one)!)
        #expect(thread.messages.map(\.id) == [2])
    }
}
