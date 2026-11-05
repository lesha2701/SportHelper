import Foundation
import Observation
import SportArenaKit

/// The notification feed and the settings of its categories. The unread number is asked for every so often while the app is on
/// screen (no push yet), and every opened or read notification updates it at once.
@MainActor
@Observable
final class NotificationsStore {
    enum Load: Equatable {
        case loading
        case loaded([NotificationItem])
        case failed(String)
    }

    private(set) var load: Load = .loading
    private(set) var preferences: [NotificationPreference]?
    /// The category whose switch is being saved.
    private(set) var savingCategory: NotificationCategory?
    var settingsError: String?
    private let service: NotificationsService

    init(client: APIClient) { service = NotificationsService(client: client) }

    var items: [NotificationItem] {
        if case .loaded(let items) = load { return items }
        return []
    }

    var unread: Int { items.filter(\.isUnread).count }

    func reset() {
        load = .loading
        preferences = nil
        savingCategory = nil
        settingsError = nil
    }

    func refresh() async {
        do {
            load = .loaded(try await service.list())
        } catch let error as APIError {
            if case .loaded = load { return }  // keep what is shown; the next round tries again
            load = .failed(error.message)
        } catch {
            if case .loaded = load { return }
            load = .failed(APIError.unknown.message)
        }
    }

    func keepFresh() async {
        while !Task.isCancelled {
            await refresh()
            try? await Task.sleep(for: .seconds(45))
        }
    }

    /// Marks it read on screen first; if the server refuses, the next refresh brings the truth back.
    func markRead(_ item: NotificationItem) async {
        guard item.isUnread, case .loaded(let all) = load else { return }
        load = .loaded(all.map { $0.id == item.id ? $0.read(at: Date()) : $0 })
        try? await service.markRead(item.id)
    }

    func markAllRead() async {
        guard case .loaded(let all) = load else { return }
        load = .loaded(all.map { $0.read(at: Date()) })
        do { try await service.markAllRead() } catch { await refresh() }
    }

    // MARK: settings

    func loadPreferences() async {
        do {
            preferences = try await service.preferences().filter { $0.category != .other }
            settingsError = nil
        } catch let error as APIError {
            if preferences == nil { settingsError = error.message }
        } catch {
            if preferences == nil { settingsError = APIError.unknown.message }
        }
    }

    func set(_ category: NotificationCategory, enabled: Bool) async {
        savingCategory = category
        settingsError = nil
        defer { savingCategory = nil }
        do {
            preferences = try await service.set(category, enabled: enabled).filter { $0.category != .other }
        } catch let error as APIError {
            settingsError = error.message
        } catch {
            settingsError = APIError.unknown.message
        }
    }
}
