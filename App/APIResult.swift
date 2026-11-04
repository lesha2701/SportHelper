import SportArenaKit

/// Runs a request and turns every failure into an `APIError` the screen can show (`translate` puts the server's English texts into Russian).
func apiResult<Value: Sendable>(
    translate: (APIError) -> APIError = { $0 }, _ work: @escaping @Sendable () async throws -> Value
) async -> Result<Value, APIError> {
    do {
        return .success(try await work())
    } catch let error as APIError {
        return .failure(translate(error))
    } catch {
        return .failure(.unknown)
    }
}

extension APIError {
    /// The same error with the app's own text.
    func saying(_ text: String) -> APIError { APIError(status: status, code: code, message: text, field: field, retryAfter: retryAfter) }
}

/// What a screen that loads one thing from the server shows.
enum LoadState<Value> {
    case loading
    case loaded(Value)
    case failed(String)

    var value: Value? { if case .loaded(let value) = self { value } else { nil } }
}
