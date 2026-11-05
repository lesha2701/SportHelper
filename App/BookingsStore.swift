import Foundation
import Observation
import SportArenaKit

/// Bookings, requests to a coach and payment.
@MainActor
@Observable
final class BookingsStore {
    enum Load<Value: Equatable>: Equatable {
        case loading
        case loaded(Value)
        case failed(String)
    }

    private(set) var mine: Load<[Booking]> = .loading
    private(set) var coachBookings: Load<[Booking]> = .loading
    private(set) var pending: Load<[PendingBooking]> = .loading
    /// Bookings whose payment is being checked with the server right now.
    private(set) var checking: Set<UUID> = []
    /// How many requests wait for the coach (a badge on the profile).
    var pendingCount: Int { if case .loaded(let list) = pending { list.count } else { 0 } }

    private let service: BookingsService
    private let polling: PaymentPolling

    init(client: APIClient, polling: PaymentPolling = PaymentPolling()) {
        service = BookingsService(client: client)
        self.polling = polling
    }

    // MARK: loading

    func reloadMine() async {
        if case .loaded = mine {} else { mine = .loading }
        mine = await fetch { try await self.service.mine() }
        await syncProcessing()
    }

    func reloadCoachBookings() async {
        if case .loaded = coachBookings {} else { coachBookings = .loading }
        coachBookings = await fetch { try await self.service.coachBookings() }
    }

    func reloadPending() async {
        if case .loaded = pending {} else { pending = .loading }
        pending = await fetch { try await self.service.pending() }
    }

    private func fetch<Value: Equatable>(_ work: () async throws -> Value) async -> Load<Value> {
        do {
            return .loaded(try await work())
        } catch let error as APIError {
            return .failed(error.message)
        } catch {
            return .failed(APIError.unknown.message)
        }
    }

    // MARK: booking

    /// Sends a booking request. Returns the new booking, or the server's own error text.
    func request(_ request: BookingRequest) async -> Result<Booking, APIError> {
        do {
            let booking = try await service.request(request)
            replace(booking)
            return .success(booking)
        } catch let error as APIError {
            return .failure(error)
        } catch {
            return .failure(.unknown)
        }
    }

    // MARK: the coach's answers

    func confirm(_ id: UUID) async -> String? { await answer(id) { try await self.service.confirm(id) } }
    func decline(_ id: UUID) async -> String? { await answer(id) { try await self.service.decline(id) } }

    private func answer(_ id: UUID, _ work: () async throws -> Booking) async -> String? {
        do {
            let booking = try await work()
            if case .loaded(let list) = pending { pending = .loaded(list.filter { $0.id != id }) }
            replace(booking)
            return nil
        } catch let error as APIError {
            await reloadPending()  // the request may already have been answered or expired: show the real state
            return error.message
        } catch {
            return APIError.unknown.message
        }
    }

    /// The coach picks the plan of a confirmed session (nil takes it off). Returns the server's text when it did not work.
    func setPlan(_ plan: UUID?, of id: UUID) async -> String? {
        do {
            let updated = try await service.setPlan(plan, of: id)
            replace(updated)
            // The server may answer without the change (the session of the booking is gone): say so instead of showing nothing.
            return updated.trainingPlanId == plan ? nil : "План не сохранился: тренировка этой записи недоступна."
        } catch let error as APIError {
            return error.message
        } catch {
            return APIError.unknown.message
        }
    }

    // MARK: payment

    /// The payment page to open, or the server's error text.
    func startPayment(_ id: UUID) async -> Result<URL, APIError> {
        do {
            return .success(try await service.startPayment(id))
        } catch let error as APIError {
            return .failure(error)
        } catch {
            return .failure(.unknown)
        }
    }

    /// The person is back from the payment page (or closed it): ask the server how it ended, a few times while it is still being
    /// confirmed. Nothing the page showed is trusted; only what the server says.
    func settlePayment(_ id: UUID) async {
        checking.insert(id)
        defer { checking.remove(id) }
        if let booking = try? await polling.settle(sync: { try await self.service.syncPayment(id) }) { replace(booking) }
    }

    /// Bookings that were left "processing" (the app was closed on the payment page): ask about them again.
    private func syncProcessing() async {
        guard case .loaded(let list) = mine else { return }
        for booking in list where booking.paymentStatus == .processing && !checking.contains(booking.id) {
            await settlePayment(booking.id)
        }
    }

    private func replace(_ booking: Booking) {
        if case .loaded(let list) = mine {
            mine = .loaded(list.contains { $0.id == booking.id } ? list.map { $0.id == booking.id ? booking : $0 } : [booking] + list)
        }
        if case .loaded(let list) = coachBookings, list.contains(where: { $0.id == booking.id }) {
            coachBookings = .loaded(list.map { $0.id == booking.id ? booking : $0 })
        }
    }

    func reset() {
        mine = .loading
        coachBookings = .loading
        pending = .loading
        checking = []
    }
}
