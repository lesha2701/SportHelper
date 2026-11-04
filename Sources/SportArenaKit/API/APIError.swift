import Foundation

/// A failed call to the server, in the one shape the server always uses:
/// `{"error": {"code": "...", "message": "...", "field": "...", "retry_after": 30}}`.
/// `message` is ready Russian text for the person; logic is built on `code`.
public struct APIError: Error, Equatable, Sendable, LocalizedError {
    public let status: Int
    public let code: String
    public let message: String
    /// The form field the message belongs to, when the server says so.
    public let field: String?
    /// Seconds to wait before retrying a rate-limited request (HTTP 429).
    public let retryAfter: Int?

    public init(status: Int, code: String, message: String, field: String? = nil, retryAfter: Int? = nil) {
        self.status = status
        self.code = code
        self.message = message
        self.field = field
        self.retryAfter = retryAfter
    }

    public var errorDescription: String? { message }

    public static let network = APIError(status: 0, code: "network_error", message: "Не удалось связаться с сервером")
    public static let unreadable = APIError(status: 0, code: "unreadable_response", message: "Сервер ответил непонятно. Попробуйте ещё раз.")
    public static let unknown = APIError(status: 0, code: "unknown_error", message: "Неизвестная ошибка сервера")

    public var isSessionExpired: Bool { status == 401 }
    public var isCSRFFailure: Bool { code == "csrf_failed" }
}

struct APIErrorEnvelope: Decodable {
    struct Body: Decodable {
        let code: String
        let message: String
        let field: String?
        let retryAfter: Int?
    }
    let error: Body
}
