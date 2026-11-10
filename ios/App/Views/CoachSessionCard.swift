import SportArenaKit
import SwiftUI

/// On a personal training the coach was booked for: the session with the athlete and what the coach can do with it (the site's training
/// page shows the same): «Тренировка проведена», the review of the athlete, the plan, the athlete's page, the chat of the session.
/// Nothing is shown where no booking of the coach stands behind the training.
struct CoachSessionCard: View {
    @Environment(AuthStore.self) private var auth
    /// The booking behind the training, read by the training screen (nil: nothing is shown).
    @Binding var booking: Booking?
    /// The session changed (marked held, another plan): the training screen reads the training again, its state changed with it.
    let onChanged: () -> Void
    /// Opens the chat of the session (the screen holding this card owns the navigation).
    let onChat: (UUID) -> Void

    @State private var plans: [Plan] = []
    @State private var completing = false
    @State private var reviewing: Booking?
    @State private var viewing: PlayerRef?
    @State private var message: String?
    @State private var cancelling: Booking?

    private var store: BookingsStore { auth.bookings }

    var body: some View {
        Group {
            if let booking {
                Section(sag: "Занятие с игроком") { card(booking) }
            }
        }
    }

    private func card(_ booking: Booking) -> some View {
        BookingCardView(
            booking: booking, viewer: .coach, paymentsOn: false, isChecking: false, payError: nil, onPay: {}, onCheck: {},
            onChat: { onChat(booking.id) }, chatUnread: auth.chatUnread.unread.forBooking(booking.id), plans: plans,
            onChoosePlan: { plan in Task { await choosePlan(plan, of: booking) } },
            onComplete: { Task { await complete(booking) } },
            onReviewPlayer: { reviewing = booking },
            onOpenPlayer: { viewing = PlayerRef(id: booking.athleteUserId) },
            isCompleting: completing,
            onCancel: { cancelling = booking }
        )
        .task {
            if booking.canChoosePlan, case .success(let list) = await auth.library.plans() { plans = list }
        }
        .playerProfileSheet(item: $viewing)
        .cancelBookingSheet(item: $cancelling, side: .coach, store: store) { updated in
            self.booking = updated
            onChanged()  // the session behind the booking is cancelled: the training screen reads it again
        }
        .sheet(item: $reviewing) { booking in
            ReviewSheet(
                title: "Отзыв: \(booking.athleteFullName)",
                hint: "Отзыв увидят другие тренеры, когда этот игрок запишется к ним. Пишите по делу и по фактам.", skipLabel: "Позже"
            ) { draft in
                let outcome = await store.review(booking.id, draft: draft, ofPlayer: true)
                if outcome == nil { await reload(booking) }
                return outcome
            }
        }
        .alert("Не получилось", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
            Button("Понятно", role: .cancel) {}
        } message: {
            Text(message ?? "")
        }
    }

    /// «Тренировка проведена», and right away the offer to review the athlete (the coach can also do it later).
    private func complete(_ booking: Booking) async {
        completing = true
        defer { completing = false }
        switch await store.markConducted(booking.id) {
        case .success(let updated):
            self.booking = updated
            onChanged()
            if !updated.hasPlayerReview { reviewing = updated }
        case .failure(let error):
            message = error.message
        }
    }

    private func choosePlan(_ plan: UUID?, of booking: Booking) async {
        if let failure = await store.setPlan(plan, of: booking.id) {
            message = failure
        } else {
            await reload(booking)
            onChanged()  // the plan shown under the training is the one just chosen
        }
    }

    /// Reads the booking again (the server's view of it after a review or another plan).
    private func reload(_ stale: Booking) async {
        guard let trainingId = stale.trainingId, let fresh = await store.coachBooking(forTraining: trainingId) else { return }
        booking = fresh
    }
}
