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
    /// For `client_update_required` (HTTP 426): the oldest version the server still accepts, and where to get a newer one.
    public let minVersion: String?
    public let updateURL: String?

    public init(
        status: Int, code: String, message: String, field: String? = nil, retryAfter: Int? = nil, minVersion: String? = nil, updateURL: String? = nil
    ) {
        self.status = status
        self.code = code
        self.message = message
        self.field = field
        self.retryAfter = retryAfter
        self.minVersion = minVersion
        self.updateURL = updateURL
    }

    public var errorDescription: String? { message }

    public static let network = APIError(status: 0, code: "network_error", message: "Не удалось связаться с сервером")
    public static let unreadable = APIError(status: 0, code: "unreadable_response", message: "Сервер ответил непонятно. Попробуйте ещё раз.")
    public static let unknown = APIError(status: 0, code: "unknown_error", message: "Неизвестная ошибка сервера")

    public var isSessionExpired: Bool { status == 401 }
    public var isCSRFFailure: Bool { code == "csrf_failed" }
    /// The server refuses this version of the app: nothing works until it is updated (docs/mobile.md, «Минимальная версия приложения»).
    public var isUpdateRequired: Bool { status == 426 && code == "client_update_required" }
}

struct APIErrorEnvelope: Decodable {
    struct Body: Decodable {
        let code: String
        let message: String
        let field: String?
        let retryAfter: Int?
        let minVersion: String?
        let updateUrl: String?
    }
    let error: Body
}

/// A file for a multipart upload (`file` is the field name the server expects).
public struct UploadFile: Sendable {
    public let field: String
    public let filename: String
    public let mimeType: String
    public let data: Data

    public init(field: String = "file", filename: String, mimeType: String, data: Data) {
        self.field = field
        self.filename = filename
        self.mimeType = mimeType
        self.data = data
    }
}
