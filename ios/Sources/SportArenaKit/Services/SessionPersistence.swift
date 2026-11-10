import Foundation

/// A place that keeps one small secret across launches (the app uses the Keychain; tests use memory).
public protocol SecretStore: Sendable {
    func read() -> Data?
    func write(_ data: Data) throws
    func delete()
}

/// Keeps the server's session cookie across launches.
///
/// URLSession holds the cookie in `HTTPCookieStorage`, but the system writes that to disk lazily: an app that is killed right
/// after signing in comes back signed out. So the session cookie is also copied into a secret store (the Keychain), and put
/// back into the cookie storage when the app starts. Only the session cookie is kept, nothing else the server may set.
public final class SessionPersistence: Sendable {
    private struct Saved: Codable {
        let name: String
        let value: String
        let domain: String
        let path: String
        let expires: Date?
        let secure: Bool
        let httpOnly: Bool
    }

    private let store: SecretStore
    private let cookies: HTTPCookieStorage
    private let baseURL: URL

    public init(store: SecretStore, cookies: HTTPCookieStorage = .shared, baseURL: URL) {
        self.store = store
        self.cookies = cookies
        self.baseURL = baseURL
    }

    private static func isSession(_ cookie: HTTPCookie) -> Bool { cookie.name.hasSuffix("sag_session") }

    /// Puts the remembered session back into the cookie storage (call before the first request). An expired or unreadable
    /// record is dropped instead.
    public func restore(now: Date = Date()) {
        guard let data = store.read() else { return }
        guard let saved = try? JSONDecoder().decode(Saved.self, from: data), saved.expires.map({ $0 > now }) ?? true else {
            store.delete()
            return
        }
        var properties: [HTTPCookiePropertyKey: Any] = [
            .name: saved.name, .value: saved.value, .domain: saved.domain, .path: saved.path,
        ]
        if let expires = saved.expires { properties[.expires] = expires }
        if saved.secure { properties[.secure] = "TRUE" }
        if saved.httpOnly { properties[HTTPCookiePropertyKey("HttpOnly")] = "TRUE" }
        if let cookie = HTTPCookie(properties: properties) { cookies.setCookie(cookie) }
    }

    /// Remembers the current session cookie (call after signing in and after a successful `me`).
    public func save() {
        guard let cookie = cookies.cookies(for: baseURL)?.first(where: Self.isSession) else { return }
        let saved = Saved(
            name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path,
            expires: cookie.expiresDate, secure: cookie.isSecure, httpOnly: cookie.isHTTPOnly
        )
        guard let data = try? JSONEncoder().encode(saved) else { return }
        try? store.write(data)
    }

    /// Forgets the session everywhere (sign-out, or the server ended it).
    public func clear() {
        store.delete()
        for cookie in cookies.cookies(for: baseURL) ?? [] where Self.isSession(cookie) { cookies.deleteCookie(cookie) }
    }
}
