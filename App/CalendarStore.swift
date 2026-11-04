import Foundation
import Observation
import SportArenaKit

/// The calendar's data. Two views of the same events: a list (a couple of weeks back, two months ahead) and one week at a time.
@MainActor
@Observable
final class CalendarStore {
    enum Mode: String, CaseIterable, Identifiable {
        case list = "Список"
        case week = "Неделя"
        var id: String { rawValue }
    }

    enum Load: Equatable {
        case loading
        case loaded([CalendarEvent])
        case failed(String)
    }

    var mode: Mode = .list
    /// Any day of the week being shown.
    var weekAnchor: LocalDate = .today()
    private(set) var load: Load = .loading
    private let service: CalendarService

    /// How far the list looks back and ahead (the server allows 120 days at once).
    static let listDaysBack = 14
    static let listDaysAhead = 60

    init(client: APIClient) {
        service = CalendarService(client: client)
    }

    var today: LocalDate { .today() }

    var range: (from: LocalDate, to: LocalDate) {
        switch mode {
        case .list: (today.adding(days: -Self.listDaysBack), today.adding(days: Self.listDaysAhead))
        case .week: (weekAnchor.startOfWeek, weekAnchor.startOfWeek.adding(days: 6))
        }
    }

    /// Changes whenever the screen needs different data.
    var requestKey: String { "\(mode.rawValue)|\(range.from.iso)|\(range.to.iso)" }

    func reload() async {
        let wanted = range
        if case .loaded = load {} else { load = .loading }
        do {
            let events = try await service.events(from: wanted.from, to: wanted.to)
            // The person may have moved to another week while this was loading: only the latest request counts.
            guard wanted.from == range.from, wanted.to == range.to else { return }
            load = .loaded(events)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            if wanted.from == range.from { load = .failed(error.message) }
        } catch {
            load = .failed(APIError.unknown.message)
        }
    }

    func shiftWeek(by weeks: Int) {
        weekAnchor = weekAnchor.adding(days: 7 * weeks)
        load = .loading
    }

    func goToThisWeek() {
        weekAnchor = today
        load = .loading
    }

    func training(id: UUID) async throws -> Training {
        try await service.training(id: id)
    }

    func reset() {
        load = .loading
        mode = .list
        weekAnchor = .today()
    }
}
