import SportArenaKit
import SwiftUI

/// «Мои брони»: the athlete's requests and sessions, and the way to pay for the confirmed ones.
struct MyBookingsView: View {
    @Environment(AuthStore.self) private var auth
    @State private var page: PageToOpen?
    @State private var payErrors: [UUID: String] = [:]
    @State private var starting: Set<UUID> = []

    private var store: BookingsStore { auth.bookings }

    var body: some View {
        Group {
            switch store.mine {
            case .loading:
                ProgressView("Загрузка броней…")
            case .failed(let message):
                ContentUnavailableView {
                    Label("Не удалось загрузить брони", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Повторить") { Task { await store.reloadMine() } }
                }
            case .loaded(let bookings):
                list(bookings)
            }
        }
        .sagScreen()
        .navigationTitle("Мои брони")
        .task { await store.reloadMine() }
        .sheet(item: $page, onDismiss: afterPayment) { SafariView(url: $0.url).ignoresSafeArea() }
    }

    private func list(_ bookings: [Booking]) -> some View {
        let waiting = bookings.filter { $0.status == .pending }.sorted { $0.startsAt < $1.startsAt }
        let upcoming = bookings.filter { $0.status == .confirmed && !$0.isCompleted }.sorted { $0.startsAt < $1.startsAt }
        let past = bookings.filter { $0.status == .confirmed && $0.isCompleted }.sorted { $0.startsAt > $1.startsAt }
        let closed = bookings.filter { ![.pending, .confirmed].contains($0.status) }.sorted { $0.startsAt > $1.startsAt }
        return List {
            if bookings.isEmpty {
                ContentUnavailableView {
                    Label("Броней пока нет", systemImage: "calendar.badge.clock")
                } description: {
                    Text("Выберите тренера во вкладке «Тренеры» и отправьте заявку на тренировку.")
                } actions: {
                    Button("Найти тренера") { auth.router.tab = .coaches }
                }
                .listRowBackground(Color.clear)
            }
            section("Ждут ответа тренера", waiting)
            section("Предстоящие", upcoming)
            section("Прошедшие", past)
            section("Отклонённые и закрытые", closed)
        }
        .refreshable { await store.reloadMine() }
        .accessibilityIdentifier("bookings.list")
    }

    @ViewBuilder private func section(_ title: String, _ items: [Booking]) -> some View {
        if !items.isEmpty {
            Section(sag: title) {
                ForEach(items) { booking in
                    BookingCardView(
                        booking: booking, viewer: .athlete, paymentsOn: auth.features.payments,
                        isChecking: store.checking.contains(booking.id) || starting.contains(booking.id),
                        payError: payErrors[booking.id], onPay: { Task { await pay(booking) } },
                        onCheck: { Task { await store.settlePayment(booking.id) } },
                        onChat: { auth.router.profilePath.append(.bookingChat(booking.id)) },
                        chatUnread: auth.chatUnread.unread.forBooking(booking.id)
                    )
                }
            }
        }
    }

    // MARK: paying

    /// Asks the server for the payment page and opens it. The amount is never sent from here.
    private func pay(_ booking: Booking) async {
        payErrors[booking.id] = nil
        starting.insert(booking.id)
        defer { starting.remove(booking.id) }
        switch await store.startPayment(booking.id) {
        case .success(let url):
            lastPaymentId = booking.id
            page = PageToOpen(url: url, bookingId: booking.id)
        case .failure(let error):
            payErrors[booking.id] = error.message
            await store.reloadMine()  // the booking may have been paid, closed or cancelled meanwhile
        }
    }

    /// The payment page was closed (paid, cancelled or just dismissed): the server is the only one that knows which.
    private func afterPayment() {
        guard let id = lastPaymentId else { return }
        Task { await store.settlePayment(id) }
    }

    @State private var lastPaymentId: UUID?
}
