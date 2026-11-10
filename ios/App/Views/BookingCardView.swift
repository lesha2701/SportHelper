import SportArenaKit
import SwiftUI

/// One booking: who with, when, and where it stands - including the payment, which is the one part that needs an action.
struct BookingCardView: View {
    let booking: Booking
    /// The person looking at it: the athlete (sees the coach, may pay) or the coach (sees the athlete).
    let viewer: Viewer
    let paymentsOn: Bool
    let isChecking: Bool
    let payError: String?
    let onPay: () -> Void
    let onCheck: () -> Void
    /// Opens the chat of this session; nil where chats are not offered. `chatUnread` is the number of messages not read yet.
    var onChat: (() -> Void)?
    var chatUnread = 0
    /// The coach's own plans and what to do when one is chosen (nil takes the plan off); nil where the plan cannot be chosen.
    var plans: [Plan] = []
    var onChoosePlan: ((UUID?) -> Void)?
    /// Reviews: the athlete's of the coach, the coach's «Тренировка проведена» and of the athlete. nil where they are not offered.
    var onReview: (() -> Void)?
    var onComplete: (() -> Void)?
    var onReviewPlayer: (() -> Void)?
    /// The coach opens the athlete's page.
    var onOpenPlayer: (() -> Void)?
    var isCompleting = false

    enum Viewer { case athlete, coach }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(viewer == .athlete ? booking.coachFullName : booking.athleteFullName).font(.headline)
                    if let title = booking.listingTitle { Text(title).font(.subheadline).foregroundStyle(.secondary) }
                    Text(when)
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer()
                statusPill
            }
            if let notes = booking.athleteNotes, !notes.isEmpty, viewer == .coach {
                Text("Пожелания: \(notes)").font(.footnote).foregroundStyle(.secondary)
            }
            if viewer == .coach, let onOpenPlayer {
                Button(action: onOpenPlayer) { Label("Профиль игрока", systemImage: "person.crop.circle").frame(maxWidth: .infinity) }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("booking.playerProfile")
            }
            planRow
            payment
            BookingSessionActions(
                booking: booking, viewer: viewer, isWorking: isCompleting, onReview: onReview, onComplete: onComplete, onReviewPlayer: onReviewPlayer
            )
            if booking.hasChat, let onChat { chatButton(onChat) }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("booking.card")
    }

    /// The plan of the session: the coach chooses it among their plans, the athlete reads its name.
    @ViewBuilder private var planRow: some View {
        if viewer == .coach, booking.canChoosePlan, let onChoosePlan {
            Menu {
                Button("Без плана") { onChoosePlan(nil) }
                ForEach(plans) { plan in Button(plan.name) { onChoosePlan(plan.id) } }
            } label: {
                Label(booking.trainingPlanName.map { "План: \($0)" } ?? "Выбрать план тренировки", systemImage: "list.bullet.clipboard")
            }
            .buttonStyle(.borderless)  // in a list row a button with no style takes the tap of the whole row
            .disabled(plans.isEmpty && booking.trainingPlanId == nil)
            .accessibilityIdentifier("booking.plan")
        } else if let name = booking.trainingPlanName, !name.isEmpty {
            Label("План: \(name)", systemImage: "list.bullet.clipboard").font(.footnote).foregroundStyle(.secondary)
                .accessibilityIdentifier("booking.planName")
        }
    }

    private func chatButton(_ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            // the label is in the middle of the button, like every other one; the unread count sits at the right edge
            Label("Чат тренировки", systemImage: "bubble.left.and.bubble.right")
                .frame(maxWidth: .infinity)
                .overlay(alignment: .trailing) {
                    if chatUnread > 0 {
                        Text("\(chatUnread)").font(.caption.bold()).foregroundStyle(.white)
                            .padding(.horizontal, 7).padding(.vertical, 2).background(Theme.primary, in: Capsule())
                    }
                }
        }
        .buttonStyle(.bordered)
        .accessibilityIdentifier("booking.chat")
    }

    private var when: String {
        let day = LocalDateFormat.dayAndMonth(booking.day)
        let format = booking.bookingFormat?.title ?? booking.format
        return "\(day), \(booking.time.display) · \(booking.durationMinutes) мин · \(format)"
    }

    private var statusPill: some View {
        let status = booking.status
        let color: Color = switch status {
        case .confirmed: .green
        case .pending: .orange
        default: .secondary
        }
        return Text(status.title)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
    }

    // MARK: payment

    @ViewBuilder private var payment: some View {
        if booking.status == .pending {
            Text(viewer == .athlete ? "Ожидает подтверждения тренера: после этого можно оплатить." : "Ждёт вашего ответа.")
                .font(.footnote).foregroundStyle(.secondary)
        } else if booking.status == .confirmed {
            confirmedPayment
        }
    }

    @ViewBuilder private var confirmedPayment: some View {
        let state = booking.paymentStatus
        switch state {
        case .notRequired:
            EmptyView()
        case .paid:
            Label("Оплачено\(booking.priceText.map { " · \($0)" } ?? "")", systemImage: "checkmark.seal.fill")
                .font(.subheadline.weight(.semibold)).foregroundStyle(.green)
                .accessibilityIdentifier("booking.paid")
        case .processing:
            HStack {
                Label("Оплата обрабатывается", systemImage: "clock").font(.subheadline.weight(.semibold)).foregroundStyle(.orange)
                Spacer()
                if isChecking { ProgressView() } else { Button("Проверить", action: onCheck).font(.subheadline) }
            }
            .accessibilityIdentifier("booking.processing")
            Text("Банк ещё подтверждает платёж. Статус обновится сам; если вы закрыли страницу оплаты, нажмите «Проверить».")
                .font(.footnote).foregroundStyle(.secondary)
        case .refundPending:
            Label("Возврат обрабатывается", systemImage: "arrow.uturn.backward").font(.subheadline.weight(.semibold)).foregroundStyle(.orange)
        case .refunded:
            Label("Возвращено", systemImage: "arrow.uturn.backward").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
        case .unpaid, .canceled, .other:
            if viewer == .coach {
                Label(state == .canceled ? "Платёж отменён" : "Ждёт оплаты", systemImage: "creditcard").font(.subheadline).foregroundStyle(.secondary)
            } else {
                unpaidForAthlete(state)
            }
        }
    }

    @ViewBuilder private func unpaidForAthlete(_ state: PaymentStatus) -> some View {
        if state == .canceled {
            Label("Платёж отменён: деньги не списаны. Можно попробовать ещё раз.", systemImage: "xmark.circle").font(.footnote).foregroundStyle(.secondary)
        } else {
            Label("Ожидает оплаты\(booking.priceText.map { " · \($0)" } ?? "")", systemImage: "creditcard").font(.subheadline.weight(.semibold))
        }
        if let payError { Text(payError).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("booking.payError") }
        if paymentsOn && booking.canPay {
            Button(action: onPay) {
                if isChecking { ProgressView().frame(maxWidth: .infinity) } else { Text("Оплатить эту тренировку").bold().frame(maxWidth: .infinity) }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isChecking)
            .accessibilityIdentifier("booking.pay")
            Text("Нажимая «Оплатить», вы заключаете договор с Тренером на Типовых условиях оказания услуг тренером. "
                + "Платформа принимает оплату как агент Тренера и не является исполнителем услуги.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
}
