import Foundation

public enum HTTPMethod: String, Sendable {
    case get = "GET", post = "POST", put = "PUT", patch = "PATCH", delete = "DELETE"

    /// Everything but a read must carry the CSRF token.
    var isChange: Bool { self != .get }
}

/// Holds the CSRF token the server hands out with `login` and `GET /api/auth/me`. Memory only, never stored on disk:
/// it is bound to the session and is simply fetched again when the app starts.
public actor CSRFTokenStore {
    private var token: String?
    public init(token: String? = nil) { self.token = token }
    public func set(_ value: String?) { token = value }
    public func current() -> String? { token }
}

/// Talks to the SportArenaGlobal server (`https://sportarenaglobal.ru`).
///
/// Sessions: the server sets an HttpOnly session cookie on login. `URLSession` keeps and sends it by itself (the shared
/// `HTTPCookieStorage`); this client adds the `X-CSRF-Token` header to every request that changes something.
public final class APIClient: Sendable {
    public let baseURL: URL
    private let session: URLSession
    private let csrf: CSRFTokenStore
    private let onSessionExpired: (@Sendable () -> Void)?

    /// Paths where a 401 means "wrong credentials / not signed in yet", not "your session ended".
    private static let openPaths: Set<String> = ["/api/auth/login", "/api/auth/register", "/api/auth/me", "/api/features"]

    public init(
        baseURL: URL,
        session: URLSession = APIClient.makeSession(),
        csrf: CSRFTokenStore = CSRFTokenStore(),
        onSessionExpired: (@Sendable () -> Void)? = nil
    ) {
        self.baseURL = baseURL
        self.session = session
        self.csrf = csrf
        self.onSessionExpired = onSessionExpired
    }

    /// A session that keeps the server's cookies between launches.
    public static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = HTTPCookieStorage.shared
        configuration.httpCookieAcceptPolicy = .always
        configuration.httpShouldSetCookies = true
        configuration.timeoutIntervalForRequest = 30
        return URLSession(configuration: configuration)
    }

    public func setCSRFToken(_ token: String?) async { await csrf.set(token) }
    public func csrfToken() async -> String? { await csrf.current() }

    // MARK: - Requests

    /// A request with a JSON answer.
    public func send<Response: Decodable & Sendable>(
        _ method: HTTPMethod,
        _ path: String,
        query: [URLQueryItem] = [],
        body: (any Encodable & Sendable)? = nil,
        as type: Response.Type = Response.self
    ) async throws -> Response {
        let data = try await perform(method, path, query: query, body: body)
        do {
            return try Self.decoder.decode(Response.self, from: data)
        } catch {
            throw APIError.unreadable
        }
    }

    /// A request whose answer does not matter (a 204, or a message nobody reads).
    public func sendIgnoringResponse(
        _ method: HTTPMethod,
        _ path: String,
        query: [URLQueryItem] = [],
        body: (any Encodable & Sendable)? = nil
    ) async throws {
        _ = try await perform(method, path, query: query, body: body)
    }

    private func perform(_ method: HTTPMethod, _ path: String, query: [URLQueryItem], body: (any Encodable & Sendable)?) async throws -> Data {
        let request = try await makeRequest(method, path, query: query, body: body)
        return try await execute(request, path: path)
    }

    /// Sends a prepared request and turns every failure into an `APIError`.
    private func execute(_ request: URLRequest, path: String) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.network
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.unknown }
        guard (200..<300).contains(http.statusCode) else {
            let error = Self.parseError(status: http.statusCode, data: data)
            if error.isSessionExpired, !Self.openPaths.contains(path) { onSessionExpired?() }
            throw error
        }
        return data
    }

    /// A GET whose answer is not JSON (a photo, a video): the bytes as they are.
    public func data(_ path: String, query: [URLQueryItem] = []) async throws -> Data {
        var request = try await makeRequest(.get, path, query: query, body: nil)
        request.setValue("*/*", forHTTPHeaderField: "Accept")
        return try await execute(request, path: path)
    }

    /// A multipart upload (one file and any number of text fields), answered with JSON.
    public func upload<Response: Decodable & Sendable>(
        _ path: String,
        file: UploadFile,
        fields: [String: String] = [:],
        as type: Response.Type = Response.self
    ) async throws -> Response {
        let boundary = "Boundary-\(UUID().uuidString)"
        var request = try await makeRequest(.post, path, query: [], body: nil)
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = Self.multipartBody(boundary: boundary, file: file, fields: fields)
        let data = try await execute(request, path: path)
        do {
            return try Self.decoder.decode(Response.self, from: data)
        } catch {
            throw APIError.unreadable
        }
    }

    static func multipartBody(boundary: String, file: UploadFile, fields: [String: String]) -> Data {
        var body = Data()
        func append(_ text: String) { body.append(Data(text.utf8)) }
        for (name, value) in fields.sorted(by: { $0.key < $1.key }) {
            append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n")
        }
        let safeName = file.filename.replacingOccurrences(of: "\"", with: "_").replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(file.field)\"; filename=\"\(safeName)\"\r\n")
        append("Content-Type: \(file.mimeType)\r\n\r\n")
        body.append(file.data)
        append("\r\n--\(boundary)--\r\n")
        return body
    }

    func makeRequest(_ method: HTTPMethod, _ path: String, query: [URLQueryItem], body: (any Encodable & Sendable)?) async throws -> URLRequest {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else { throw APIError.unknown }
        components.path = path
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw APIError.unknown }
        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if method.isChange, let token = await csrf.current() {
            request.setValue(token, forHTTPHeaderField: "X-CSRF-Token")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try Self.encoder.encode(body)
        }
        return request
    }

    static func parseError(status: Int, data: Data) -> APIError {
        guard let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data) else {
            return APIError(status: status, code: "unknown_error", message: APIError.unknown.message)
        }
        let e = envelope.error
        return APIError(status: status, code: e.code, message: e.message, field: e.field, retryAfter: e.retryAfter)
    }

    // MARK: - JSON

    /// The server speaks snake_case and ISO 8601 dates (with or without fractional seconds).
    static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            let withFraction = ISO8601DateFormatter()
            withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = withFraction.date(from: text) { return date }
            let plain = ISO8601DateFormatter()
            plain.formatOptions = [.withInternetDateTime]
            if let date = plain.date(from: text) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Not an ISO 8601 date: \(text)"))
        }
        return decoder
    }

    static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        // "2026-11-05T10:00:00Z": an instant the server reads as UTC.
        encoder.dateEncodingStrategy = .custom { date, encoder in
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]
            var container = encoder.singleValueContainer()
            try container.encode(formatter.string(from: date))
        }
        return encoder
    }
}
