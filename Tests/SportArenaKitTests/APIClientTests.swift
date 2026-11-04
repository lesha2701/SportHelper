import Foundation
import Testing
@testable import SportArenaKit

private let base = URL(string: "https://sportarenaglobal.ru")!

struct APIClientTests {
    private func client(onExpired: (@Sendable () -> Void)? = nil, _ handler: @escaping MockServer.Handler) -> APIClient {
        APIClient(baseURL: base, session: MockServer.session(handler), onSessionExpired: onExpired)
    }

    // MARK: errors

    @Test func theServersErrorShapeBecomesAnAPIError() async {
        let api = client { _ in json(#"{"error":{"code":"invalid_password","message":"Неверный пароль.","field":"password"}}"#, status: 403) }
        do {
            let _: MessageResponse = try await api.send(.post, "/api/x")
            Issue.record("expected an error")
        } catch let error as APIError {
            #expect(error == APIError(status: 403, code: "invalid_password", message: "Неверный пароль.", field: "password"))
            #expect(error.localizedDescription == "Неверный пароль.")
        } catch { Issue.record("wrong error \(error)") }
    }

    @Test func aRateLimitCarriesHowLongToWait() async {
        let api = client { _ in json(#"{"error":{"code":"rate_limited","message":"Слишком много попыток.","retry_after":42}}"#, status: 429) }
        do {
            let _: MessageResponse = try await api.send(.post, "/api/x")
            Issue.record("expected an error")
        } catch let error as APIError {
            #expect(error.status == 429 && error.retryAfter == 42 && error.code == "rate_limited")
        } catch { Issue.record("wrong error \(error)") }
    }

    @Test func anAnswerThatIsNotOurErrorShapeIsStillAnError() async {
        let api = client { _ in (502, [:], Data("<html>Bad gateway</html>".utf8)) }
        do {
            let _: MessageResponse = try await api.send(.get, "/api/x")
            Issue.record("expected an error")
        } catch let error as APIError {
            #expect(error.status == 502 && error.code == "unknown_error" && !error.message.isEmpty)
        } catch { Issue.record("wrong error \(error)") }
    }

    @Test func aDeadNetworkIsANetworkError() async {
        let api = client { _ in throw URLError(.notConnectedToInternet) }
        do {
            let _: MessageResponse = try await api.send(.get, "/api/x")
            Issue.record("expected an error")
        } catch let error as APIError {
            #expect(error == .network)
        } catch { Issue.record("wrong error \(error)") }
    }

    @Test func aSuccessfulAnswerThatCannotBeReadIsReportedNotCrashed() async {
        let api = client { _ in json(#"{"unexpected": true}"#) }
        do {
            let _: AuthUser = try await api.send(.get, "/api/auth/me")
            Issue.record("expected an error")
        } catch let error as APIError {
            #expect(error == .unreadable)
        } catch { Issue.record("wrong error \(error)") }
    }

    // MARK: sessions

    private final class Flag: @unchecked Sendable {
        private let lock = NSLock()
        private var value = false
        func raise() { lock.lock(); value = true; lock.unlock() }
        var raised: Bool { lock.lock(); defer { lock.unlock() }; return value }
    }

    @Test func aDeadSessionIsAnnouncedExceptWhereA401JustMeansWrongCredentials() async {
        let expired = Flag()
        let api = client(onExpired: { expired.raise() }) { _ in json(#"{"error":{"code":"unauthorized","message":"Войдите снова."}}"#, status: 401) }

        let _: AuthUser? = try? await api.send(.post, "/api/auth/login", body: ["email": "a@b.c", "password": "x"])
        let _: AuthUser? = try? await api.send(.get, "/api/auth/me")
        #expect(expired.raised == false)  // not signed in yet is not "your session ended"

        let _: MessageResponse? = try? await api.send(.get, "/api/bookings/me")
        #expect(expired.raised == true)
    }

    // MARK: CSRF

    @Test func theCSRFTokenGoesOnEveryChangeAndOnNoRead() async throws {
        let seen = RequestLog()
        let api = client { request in
            seen.add(request)
            return json(#"{"message":"ok"}"#)
        }
        await api.setCSRFToken("csrf-xyz")

        let _: MessageResponse = try await api.send(.get, "/api/notifications")
        let _: MessageResponse = try await api.send(.post, "/api/notifications/read-all")
        let _: MessageResponse = try await api.send(.delete, "/api/chats/1/messages/2")

        let requests = seen.all
        #expect(requests[0].value(forHTTPHeaderField: "X-CSRF-Token") == nil)
        #expect(requests[1].value(forHTTPHeaderField: "X-CSRF-Token") == "csrf-xyz")
        #expect(requests[2].value(forHTTPHeaderField: "X-CSRF-Token") == "csrf-xyz")
    }

    @Test func theRequestIsBuiltFromTheBaseAddressPathAndQuery() async throws {
        let seen = RequestLog()
        let api = client { request in seen.add(request); return json(#"{"message":"ok"}"#) }

        let _: MessageResponse = try await api.send(.get, "/api/chats/abc/messages", query: [URLQueryItem(name: "after_id", value: "5"), URLQueryItem(name: "limit", value: "30")])

        let url = try #require(seen.all.first?.url)
        #expect(url.absoluteString == "https://sportarenaglobal.ru/api/chats/abc/messages?after_id=5&limit=30")
    }

    // MARK: dates

    @Test(arguments: [
        "2026-11-04T14:32:47.353513Z",   // what the server sends (microseconds)
        "2026-11-04T14:32:47Z",          // no fraction
        "2026-11-04T17:32:47.353+03:00", // with an offset
    ])
    func theServersDatesAreUnderstood(text: String) throws {
        struct Wrapper: Decodable { let at: Date }
        let decoded = try APIClient.decoder.decode(Wrapper.self, from: Data(#"{"at":"\#(text)"}"#.utf8))
        let expected = Date(timeIntervalSince1970: 1_793_802_767)  // 2026-11-04T14:32:47Z
        #expect(abs(decoded.at.timeIntervalSince(expected)) < 1)
    }

    @Test func aMalformedDateIsADecodingErrorNotACrash() {
        struct Wrapper: Decodable { let at: Date }
        #expect(throws: DecodingError.self) { try APIClient.decoder.decode(Wrapper.self, from: Data(#"{"at":"yesterday"}"#.utf8)) }
    }
}

final class RequestLog: @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [URLRequest] = []
    func add(_ request: URLRequest) { lock.lock(); requests.append(request); lock.unlock() }
    var all: [URLRequest] { lock.lock(); defer { lock.unlock() }; return requests }
}
