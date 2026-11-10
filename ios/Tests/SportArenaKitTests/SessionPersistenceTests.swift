import Foundation
import Testing
@testable import SportArenaKit

private let base = URL(string: "https://sportarenaglobal.ru")!

private final class MemoryStore: SecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var data: Data?
    func read() -> Data? { lock.lock(); defer { lock.unlock() }; return data }
    func write(_ value: Data) throws { lock.lock(); data = value; lock.unlock() }
    func delete() { lock.lock(); data = nil; lock.unlock() }
}

private func storage() -> HTTPCookieStorage { URLSessionConfiguration.ephemeral.httpCookieStorage ?? HTTPCookieStorage() }

private func cookie(_ name: String = "__Host-sag_session", value: String = "token-123", expires: Date? = Date().addingTimeInterval(86_400)) -> HTTPCookie {
    var properties: [HTTPCookiePropertyKey: Any] = [
        .name: name, .value: value, .domain: "sportarenaglobal.ru", .path: "/", .secure: "TRUE", HTTPCookiePropertyKey("HttpOnly"): "TRUE",
    ]
    if let expires { properties[.expires] = expires }
    return HTTPCookie(properties: properties)!
}

struct SessionPersistenceTests {
    @Test func theSessionCookieSurvivesALostCookieStorage() throws {
        let store = MemoryStore()
        let before = storage()
        before.setCookie(cookie())
        SessionPersistence(store: store, cookies: before, baseURL: base).save()

        let after = storage()  // a new launch: the system's cookie file never got written
        #expect(after.cookies(for: base)?.isEmpty ?? true)
        SessionPersistence(store: store, cookies: after, baseURL: base).restore()

        let restored = try #require(after.cookies(for: base)?.first)
        #expect(restored.name == "__Host-sag_session" && restored.value == "token-123")
        #expect(restored.isSecure && restored.isHTTPOnly && restored.path == "/")
        #expect(restored.expiresDate != nil)
    }

    @Test func onlyTheSessionCookieIsKept() {
        let store = MemoryStore()
        let cookies = storage()
        cookies.setCookie(cookie("tracking", value: "other"))
        SessionPersistence(store: store, cookies: cookies, baseURL: base).save()
        #expect(store.read() == nil)  // nothing that is not the session is ever stored
    }

    @Test func anExpiredSessionIsNotRestoredAndIsDropped() {
        let store = MemoryStore()
        let cookies = storage()
        cookies.setCookie(cookie(expires: Date().addingTimeInterval(3_600)))
        let persistence = SessionPersistence(store: store, cookies: cookies, baseURL: base)
        persistence.save()

        let fresh = storage()
        SessionPersistence(store: store, cookies: fresh, baseURL: base).restore(now: Date().addingTimeInterval(7_200))

        #expect(fresh.cookies(for: base)?.isEmpty ?? true)
        #expect(store.read() == nil)
    }

    @Test func unreadableDataIsDroppedWithoutHarm() {
        let store = MemoryStore()
        try? store.write(Data("not json".utf8))
        let cookies = storage()
        SessionPersistence(store: store, cookies: cookies, baseURL: base).restore()
        #expect(cookies.cookies(for: base)?.isEmpty ?? true)
        #expect(store.read() == nil)
    }

    @Test func nothingIsRestoredWhenNothingWasSaved() {
        let cookies = storage()
        SessionPersistence(store: MemoryStore(), cookies: cookies, baseURL: base).restore()
        #expect(cookies.cookies(for: base)?.isEmpty ?? true)
    }

    @Test func signingOutForgetsTheSessionEverywhere() {
        let store = MemoryStore()
        let cookies = storage()
        cookies.setCookie(cookie())
        let persistence = SessionPersistence(store: store, cookies: cookies, baseURL: base)
        persistence.save()
        #expect(store.read() != nil)

        persistence.clear()

        #expect(store.read() == nil)
        #expect(cookies.cookies(for: base)?.isEmpty ?? true)
    }

    @Test func aSessionWithoutAnExpiryIsRestoredToo() throws {
        let store = MemoryStore()
        let before = storage()
        before.setCookie(cookie(expires: nil))
        SessionPersistence(store: store, cookies: before, baseURL: base).save()
        let after = storage()
        SessionPersistence(store: store, cookies: after, baseURL: base).restore()
        #expect(after.cookies(for: base)?.first?.value == "token-123")
    }
}
