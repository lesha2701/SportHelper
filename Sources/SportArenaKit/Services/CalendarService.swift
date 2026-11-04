import Foundation

public final class CalendarService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    /// The server allows at most 120 days at a time (more is refused with `range_too_large`).
    public static let maxRangeDays = 120

    public func events(from: LocalDate, to: LocalDate) async throws -> [CalendarEvent] {
        try await client.send(.get, "/api/calendar", query: [
            URLQueryItem(name: "date_from", value: from.iso), URLQueryItem(name: "date_to", value: to.iso),
        ])
    }

    public func training(id: UUID) async throws -> Training {
        try await client.send(.get, "/api/trainings/\(id.uuidString.lowercased())")
    }
}
