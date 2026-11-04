import Foundation

/// A pretend server for tests: every request of a session built with `MockServer.session(handler)` is answered by that handler.
/// Each session has its own handler (found by an id header), so tests can run in parallel.
final class MockServer: URLProtocol, @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest) throws -> (status: Int, headers: [String: String], body: Data)

    nonisolated(unsafe) private static var handlers: [String: Handler] = [:]
    private static let lock = NSLock()
    private static let idHeader = "X-Mock-Session"

    static func session(_ handler: @escaping Handler) -> URLSession {
        let id = UUID().uuidString
        lock.lock(); handlers[id] = handler; lock.unlock()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockServer.self]
        configuration.httpAdditionalHeaders = [idHeader: id]
        return URLSession(configuration: configuration)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        let handler = request.value(forHTTPHeaderField: Self.idHeader).flatMap { Self.handlers[$0] }
        Self.lock.unlock()
        guard let handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        do {
            let (status, headers, body) = try handler(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

extension URLRequest {
    /// The body of a request as the server would see it (URLSession hands bodies over as a stream).
    var bodyData: Data? {
        if let httpBody { return httpBody }
        guard let stream = httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: buffer.count)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }

    var bodyJSON: [String: Any]? {
        guard let data = bodyData else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
}

func json(_ text: String, status: Int = 200) -> (status: Int, headers: [String: String], body: Data) {
    (status, ["Content-Type": "application/json"], Data(text.utf8))
}

let userJSON = """
{"id":"11111111-2222-4333-8444-555555555555","email":"anna@example.com","email_verified":true,"first_name":"Анна","last_name":"Тренер",
 "photo_url":null,"avatar_file_id":null,"language_code":"ru","active_mode":"coach","preferred_role":"coach",
 "created_at":"2026-11-04T14:32:47.353513Z","last_login_at":null,"telegram_linked":false,"has_password":true,"is_admin":false,
 "deletion_requested_at":null,"completed_onboarding_version":1,"current_onboarding_version":1,"csrf_token":"csrf-abc"}
"""
