import Foundation

/// Booking a personal training, answering requests, and paying.
public final class BookingsService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    private func path(_ id: UUID, _ tail: String = "") -> String { "/api/bookings/\(id.uuidString.lowercased())\(tail)" }

    // MARK: the athlete

    public func request(_ booking: BookingRequest) async throws -> Booking {
        try await client.send(.post, "/api/bookings", body: booking)
    }

    public func mine() async throws -> [Booking] {
        try await client.send(.get, "/api/bookings/me")
    }

    // MARK: the coach

    /// Requests waiting for an answer.
    public func pending() async throws -> [PendingBooking] {
        try await client.send(.get, "/api/bookings/coach/pending")
    }

    /// The coach's confirmed, past and declined sessions.
    public func coachBookings() async throws -> [Booking] {
        try await client.send(.get, "/api/bookings/coach")
    }

    /// The booking behind a personal training the coach was booked for (404 where the training is not one of theirs).
    public func coachBooking(forTraining trainingId: UUID) async throws -> Booking {
        try await client.send(.get, "/api/bookings/coach/by-training/\(trainingId.uuidString.lowercased())")
    }

    public func confirm(_ id: UUID) async throws -> Booking {
        try await client.send(.post, path(id, "/confirm"))
    }

    public func decline(_ id: UUID) async throws -> Booking {
        try await client.send(.post, path(id, "/decline"))
    }

    /// The coach picks which of their own plans the confirmed session uses (nil takes the plan off).
    public func setPlan(_ plan: UUID?, of id: UUID) async throws -> Booking {
        try await client.send(.patch, path(id, "/plan"), body: BookingPlanBody(planId: plan))
    }

    // MARK: cancelling

    /// What cancelling right now would mean for the money (the athlete and the coach of the booking). Changes nothing.
    public func cancelPreview(_ id: UUID) async throws -> CancelPreview {
        try await client.send(.get, path(id, "/cancel-preview"))
    }

    /// Cancels a confirmed booking by the server's rule; the money goes back by itself. Repeating it is harmless. The coach gives a reason.
    public func cancel(_ id: UUID, reason: String?) async throws -> Booking {
        try await client.send(.post, path(id, "/cancel"), body: CancelBody(reason: reason))
    }

    // MARK: reviews

    /// The athlete's review of the coach after a held session. The server refuses a second one («already_reviewed»).
    public func review(_ id: UUID, draft: ReviewDraft) async throws {
        try await client.sendIgnoringResponse(.post, path(id, "/reviews"), body: ReviewRequest(rating: draft.rating, text: draft.tidyText))
    }

    /// «Тренировка проведена»: the training becomes completed, the athlete is asked to review the coach. Repeating it is harmless.
    public func complete(_ id: UUID) async throws -> Booking {
        try await client.send(.post, path(id, "/complete"))
    }

    /// The coach's review of the athlete (other coaches see it when the athlete books with them).
    public func reviewPlayer(_ id: UUID, draft: ReviewDraft) async throws {
        try await client.sendIgnoringResponse(.post, path(id, "/player-review"), body: ReviewRequest(rating: draft.rating, text: draft.tidyText))
    }

    // MARK: payment

    /// Asks the server for a payment page. The amount is never sent: the server takes it from the booking.
    public func startPayment(_ id: UUID) async throws -> URL {
        let start: PaymentStart = try await client.send(.post, path(id, "/pay"))
        guard let url = start.url else { throw APIError(status: 0, code: "unsafe_payment_url", message: "Не удалось открыть страницу оплаты.") }
        return url
    }

    /// Asks the server how the payment ended. The ONLY thing that says a booking is paid: never the address the person came back by.
    public func syncPayment(_ id: UUID) async throws -> Booking {
        try await client.send(.post, path(id, "/payment/sync"))
    }
}

/// After the person comes back from the payment page, the bank may still be confirming: ask again a few times, then give up
/// (the status stays visible in the list and can be refreshed). Bounded on purpose.
public struct PaymentPolling: Sendable {
    public var maxTries: Int
    public var interval: Duration

    public init(maxTries: Int = 10, interval: Duration = .seconds(3)) {
        self.maxTries = maxTries
        self.interval = interval
    }

    /// Returns the booking as the server last reported it. The first failure is thrown (nothing is known yet); a failure after the
    /// server has already answered ends the waiting and returns what is known.
    public func settle(
        sync: @Sendable () async throws -> Booking,
        sleep: @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    ) async throws -> Booking {
        var latest = try await sync()
        var tries = 1
        while latest.paymentStatus == .processing, tries < maxTries {
            try await sleep(interval)
            guard let next = try? await sync() else { return latest }
            latest = next
            tries += 1
        }
        return latest
    }
}

/// The body of "choose the plan": a plan taken off goes as an explicit null.
struct BookingPlanBody: Encodable, Sendable {
    let planId: UUID?

    private enum CodingKeys: String, CodingKey { case planId }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(planId, forKey: .planId)
    }
}
