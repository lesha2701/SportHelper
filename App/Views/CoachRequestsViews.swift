import SportArenaKit
import SwiftUI

/// The coach's inbox: requests waiting for an answer.
struct IncomingRequestsView: View {
    @Environment(AuthStore.self) private var auth
    @State private var busy: Set<UUID> = []
    @State private var message: String?
    @State private var isError = false

    private var store: BookingsStore { auth.bookings }

    var body: some View {
        Group {
            switch store.pending {
            case .loading:
                ProgressView("Загрузка заявок…")
            case .failed(let text):
                ContentUnavailableView {
                    Label("Не удалось загрузить заявки", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(text)
                } actions: {
                    Button("Повторить") { Task { await store.reloadPending() } }
                }
            case .loaded(let requests):
                list(requests)
            }
        }
        .navigationTitle("Входящие заявки")
        .task { await store.reloadPending() }
    }

    private func list(_ requests: [PendingBooking]) -> some View {
        List {
            if let message {
                Section {
                    Label(message, systemImage: isError ? "exclamationmark.triangle" : "checkmark.circle")
                        .foregroundStyle(isError ? .red : .green)
                        .accessibilityIdentifier("requests.message")
                }
            }
            if requests.isEmpty {
                ContentUnavailableView("Нет заявок", systemImage: "tray", description: Text("Когда игроки запишутся на ваши объявления, заявки появятся здесь."))
                    .listRowBackground(Color.clear)
            }
            ForEach(requests) { request in
                requestCard(request).accessibilityElement(children: .contain).accessibilityIdentifier("requests.card")
            }
        }
        .refreshable { await store.reloadPending() }
    }

    private func requestCard(_ request: PendingBooking) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(request.athleteFullName).font(.headline)
            if let average = request.athleteRatingAverage, (request.athleteReviewCount ?? 0) > 0 {
                Label(String(format: "%.1f", average).replacingOccurrences(of: ".", with: ","), systemImage: "star.fill")
                    .font(.footnote).foregroundStyle(.orange)
            }
            if let title = request.listingTitle { Text(title).font(.subheadline).foregroundStyle(.secondary) }
            Text("\(LocalDateFormat.dayAndMonth(request.day)), \(request.time.display) · \(request.durationMinutes) мин · \(request.bookingFormat?.title ?? request.format)")
                .font(.subheadline).foregroundStyle(.secondary)
            if let price = request.priceText { Text(price).font(.subheadline.weight(.semibold)) }
            if let notes = request.athleteNotes, !notes.isEmpty { Text("Пожелания: \(notes)").font(.footnote).foregroundStyle(.secondary) }
            HStack(spacing: 12) {
                Button { Task { await answer(request, confirm: true) } } label: { Text("Подтвердить").frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("requests.confirm")
                Button(role: .destructive) { Task { await answer(request, confirm: false) } } label: { Text("Отклонить").frame(maxWidth: .infinity) }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("requests.decline")
            }
            .disabled(busy.contains(request.id))
        }
        .padding(.vertical, 4)
    }

    private func answer(_ request: PendingBooking, confirm: Bool) async {
        busy.insert(request.id)
        defer { busy.remove(request.id) }
        let error = confirm ? await store.confirm(request.id) : await store.decline(request.id)
        isError = error != nil
        message = error ?? (confirm
            ? "Заявка от \(request.athleteFullName) подтверждена. Игрок сможет её оплатить."
            : "Заявка от \(request.athleteFullName) отклонена.")
    }
}

/// The coach's own list of sessions: who is booked, and whether they have paid.
struct CoachBookingsView: View {
    @Environment(AuthStore.self) private var auth

    private var store: BookingsStore { auth.bookings }

    var body: some View {
        Group {
            switch store.coachBookings {
            case .loading:
                ProgressView("Загрузка…")
            case .failed(let text):
                ContentUnavailableView {
                    Label("Не удалось загрузить записи", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(text)
                } actions: {
                    Button("Повторить") { Task { await store.reloadCoachBookings() } }
                }
            case .loaded(let bookings):
                list(bookings)
            }
        }
        .navigationTitle("Записи")
        .task { await store.reloadCoachBookings() }
    }

    private func list(_ bookings: [Booking]) -> some View {
        let upcoming = bookings.filter { $0.status == .confirmed && !$0.isCompleted }.sorted { $0.startsAt < $1.startsAt }
        let past = bookings.filter { $0.status == .confirmed && $0.isCompleted }.sorted { $0.startsAt > $1.startsAt }
        let closed = bookings.filter { ![.pending, .confirmed].contains($0.status) }.sorted { $0.startsAt > $1.startsAt }
        return List {
            if bookings.isEmpty {
                ContentUnavailableView("Записей пока нет", systemImage: "calendar", description: Text("Подтверждённые заявки появятся здесь."))
                    .listRowBackground(Color.clear)
            }
            section("Предстоящие", upcoming)
            section("Прошедшие", past)
            section("Отклонённые и закрытые", closed)
        }
        .refreshable { await store.reloadCoachBookings() }
        .accessibilityIdentifier("coachBookings.list")
    }

    @ViewBuilder private func section(_ title: String, _ items: [Booking]) -> some View {
        if !items.isEmpty {
            Section(title) {
                ForEach(items) {
                    BookingCardView(booking: $0, viewer: .coach, paymentsOn: false, isChecking: false, payError: nil, onPay: {}, onCheck: {})
                }
            }
        }
    }
}
