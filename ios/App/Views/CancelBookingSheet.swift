import SportArenaKit
import SwiftUI

/// «Отменить запись»: asks the server what the cancellation means for the money, tells it BEFORE the button, then cancels.
/// The coach has to give a reason (the athlete may). The server's own words are shown when it refuses.
struct CancelBookingSheet: View {
    @Environment(\.dismiss) private var dismiss
    let booking: Booking
    let side: CancelSide
    let preview: (UUID) async -> Result<CancelPreview, APIError>
    let cancel: (UUID, String?) async -> Result<Booking, APIError>
    let onCancelled: (Booking) -> Void

    @State private var loaded: Result<CancelPreview, APIError>?
    @State private var reason = ""
    @State private var sending = false
    @State private var error: String?

    private var who: String { side == .coach ? booking.athleteFullName : booking.coachFullName }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("\(booking.listingTitle.map { "\($0) · " } ?? "")\(LocalDateFormat.dayAndMonth(booking.day)), \(booking.time.display) · \(who)")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                Section(sag: "Что будет с деньгами") {
                    switch loaded {
                    case nil:
                        ProgressView("Считаем условия отмены…")
                    case .success(let value):
                        Text(value.explanation(side: side)).accessibilityIdentifier("cancel.explanation")
                    case .failure(let failure):
                        Text(failure.message).foregroundStyle(Theme.danger).accessibilityIdentifier("cancel.loadError")
                    }
                }
                if case .success = loaded {
                    Section(sag: side == .coach ? "Причина (обязательно)" : "Причина (необязательно)") {
                        TextField("Что случилось", text: $reason, axis: .vertical)
                            .lineLimit(2...6)
                            .onChange(of: reason) { _, text in
                                if text.count > CancelReason.maxLength { reason = String(text.prefix(CancelReason.maxLength)) }
                            }
                            .accessibilityIdentifier("cancel.reason")
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(Theme.danger).accessibilityIdentifier("cancel.error") }
                }
                Section {
                    Button(role: .destructive) {
                        Task { await send() }
                    } label: {
                        if sending { ProgressView().frame(maxWidth: .infinity) } else { Text("Отменить запись").bold().frame(maxWidth: .infinity) }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.danger)
                    .disabled(sending || !canSend)
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                    .accessibilityIdentifier("cancel.confirm")
                }
            }
            .sagScreen()
            .navigationTitle("Отменить запись?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Не отменять") { dismiss() }.disabled(sending).accessibilityIdentifier("cancel.dismiss")
                }
            }
            .task { loaded = await preview(booking.id) }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(sending)
    }

    private var canSend: Bool {
        if case .success = loaded { return true }
        return false
    }

    private func send() async {
        if let problem = CancelReason.problem(reason, side: side) {
            error = problem
            return
        }
        sending = true
        error = nil
        defer { sending = false }
        switch await cancel(booking.id, CancelReason.tidy(reason)) {
        case .success(let updated):
            onCancelled(updated)
            dismiss()
        case .failure(let failure):
            error = failure.message
        }
    }
}

extension View {
    /// Presents the cancel window for the chosen booking; `onCancelled` gets the booking as the server left it.
    func cancelBookingSheet(item: Binding<Booking?>, side: CancelSide, store: BookingsStore, onCancelled: @escaping (Booking) -> Void = { _ in }) -> some View {
        sheet(item: item) { booking in
            CancelBookingSheet(
                booking: booking, side: side, preview: { await store.cancelPreview($0) }, cancel: { await store.cancel($0, reason: $1) },
                onCancelled: onCancelled
            )
        }
    }
}

/// Who cancelled and when, why, and where the money is: in the card of a cancelled booking.
struct CancellationNote: View {
    let cancellation: Cancellation
    let side: CancelSide

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(cancellation.headline(side: side)).font(.subheadline.weight(.semibold))
            if let reason = cancellation.reason, !reason.isEmpty { Text("Причина: \(reason)").font(.footnote).foregroundStyle(.secondary) }
            if let line = cancellation.refundLine(side: side) {
                Text(line).font(.footnote).foregroundStyle(cancellation.refundStatus == .failed ? Theme.danger : Color.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("booking.cancellation")
    }
}
