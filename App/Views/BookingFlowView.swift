import SportArenaKit
import SwiftUI

/// Booking a lesson: pick a free hour, the format, add a wish, send. The price is not part of the request: the server takes it from the
/// offer, and payment comes only after the trainer confirms.
struct BookingFlowView: View {
    let profile: CoachListingProfile
    let store: CoachesStore

    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss

    private enum SlotsLoad {
        case loading
        case loaded([DaySlots])
        case failed(String)
    }

    /// The free hours of one day.
    private struct DaySlots: Identifiable {
        let day: LocalDate
        let slots: [OpenSlot]
        var id: LocalDate { day }
    }

    private static let daysAhead = 14

    @State private var slotsLoad = SlotsLoad.loading
    @State private var selectedDay: LocalDate?
    @State private var selectedSlot: OpenSlot?
    @State private var format: BookingFormat
    @State private var notes = ""
    @State private var isSending = false
    @State private var errorMessage: String?
    @State private var sent: Booking?

    init(profile: CoachListingProfile, store: CoachesStore) {
        self.profile = profile
        self.store = store
        _format = State(initialValue: profile.formats.first ?? .online)
    }

    var body: some View {
        NavigationStack {
            Group {
                if let sent { successView(sent) } else { form }
            }
            .navigationTitle("Запись на тренировку")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if sent == nil { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } } }
            }
            .task { await loadSlots() }
        }
    }

    // MARK: the form

    private var form: some View {
        Form {
            Section {
                Text(profile.title).font(.headline)
                Text(profile.coachFullName).foregroundStyle(.secondary)
            }
            switch slotsLoad {
            case .loading:
                Section { ProgressView("Ищем свободное время…") }
            case .failed(let message):
                Section {
                    Text(message).foregroundStyle(.red)
                    Button("Повторить") { Task { await loadSlots() } }
                }
            case .loaded(let days):
                if days.isEmpty {
                    Section { Text("В ближайшие \(Self.daysAhead) дней нет свободного времени. Загляните позже.").foregroundStyle(.secondary) }
                } else {
                    daySection(days)
                    timeSection(days)
                }
            }
            if selectedSlot != nil { detailsSections }
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) { if selectedSlot != nil { submitBar } }
    }

    private func daySection(_ days: [DaySlots]) -> some View {
        Section("Дата") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(days) { entry in
                        Button {
                            selectedDay = entry.day
                            selectedSlot = nil
                        } label: {
                            VStack(spacing: 2) {
                                Text(LocalDateFormat.weekday(entry.day)).font(.caption)
                                Text("\(entry.day.day)").font(.title3.bold())
                            }
                            .frame(width: 52, height: 56)
                        }
                        .buttonStyle(.bordered)
                        .tint(selectedDay == entry.day ? Theme.primary : .secondary)
                        .background(selectedDay == entry.day ? Theme.primary.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 10))
                        .accessibilityIdentifier("booking.day")
                    }
                }
                .padding(.vertical, 4)
            }
            .listRowInsets(EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12))
        }
    }

    @ViewBuilder private func timeSection(_ days: [DaySlots]) -> some View {
        if let day = selectedDay, let entry = days.first(where: { $0.day == day }) {
            Section("Время · \(LocalDateFormat.dayAndMonth(day))") {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 76), spacing: 8)], spacing: 8) {
                    ForEach(entry.slots) { slot in
                        Button { selectedSlot = slot } label: { Text(slot.time.display).frame(maxWidth: .infinity) }
                            .buttonStyle(.bordered)
                            .tint(selectedSlot == slot ? Theme.primary : .secondary)
                            .background(selectedSlot == slot ? Theme.primary.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 10))
                            .accessibilityIdentifier("booking.slot")
                    }
                }
                .padding(.vertical, 4)
            }
        } else {
            Section { Text("Выберите дату").foregroundStyle(.secondary) }
        }
    }

    @ViewBuilder private var detailsSections: some View {
        if profile.formats.count > 1 {
            Section("Формат") {
                Picker("Формат", selection: $format) {
                    ForEach(profile.formats) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
            }
        }
        Section("Пожелания тренеру") {
            TextField("Необязательно", text: $notes, axis: .vertical).lineLimit(2...5).accessibilityIdentifier("booking.notes")
            if notes.count > BookingRequest.maxNotesLength {
                Text("Не длиннее \(BookingRequest.maxNotesLength) символов.").font(.footnote).foregroundStyle(.red)
            }
        }
        Section {
            if let price = profile.priceText {
                LabeledContent("Стоимость", value: price)
                Text("Платить сейчас не нужно: оплатить можно после того, как тренер подтвердит запись.").font(.footnote).foregroundStyle(.secondary)
            }
            if let errorMessage { Text(errorMessage).foregroundStyle(.red).accessibilityIdentifier("booking.error") }
        }
    }

    /// Pinned under the form once a time is chosen, so it never hides below the notes.
    private var submitBar: some View {
        Button { Task { await send() } } label: {
            if isSending { ProgressView().frame(maxWidth: .infinity) } else { Text("Отправить заявку").bold().frame(maxWidth: .infinity) }
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(isSending || notes.count > BookingRequest.maxNotesLength)
        .accessibilityIdentifier("booking.submit")
        .padding(.horizontal).padding(.vertical, 8)
        .background(.bar)
    }

    // MARK: the result

    private func successView(_ booking: Booking) -> some View {
        VStack(spacing: 16) {
            ContentUnavailableView {
                Label("Заявка отправлена", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
            } description: {
                Text("Тренер ответит на заявку. После подтверждения её можно будет оплатить в разделе «Мои брони». "
                     + "Если тренер не ответит в течение суток, заявка закроется сама.")
            }
            .accessibilityIdentifier("booking.sent")
            Button("Мои брони") {
                auth.router.open(.myBookings)
                dismiss()
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("booking.openMine")
            Button("Закрыть") { dismiss() }
            Spacer()
        }
        .padding()
    }

    // MARK: actions

    private func loadSlots() async {
        slotsLoad = .loading
        let today = Date().serverDay
        do {
            let slots = try await store.slots(listingId: profile.id, from: today, to: today.adding(days: Self.daysAhead))
            let days = Dictionary(grouping: slots, by: \.day)
                .map { DaySlots(day: $0.key, slots: $0.value.sorted { $0.startsAt < $1.startsAt }) }
                .sorted { $0.day < $1.day }
            slotsLoad = .loaded(days)
            if selectedDay == nil || !days.contains(where: { $0.day == selectedDay }) { selectedDay = days.first?.day }
        } catch let error as APIError {
            slotsLoad = .failed(error.message)
        } catch {
            slotsLoad = .failed(APIError.unknown.message)
        }
    }

    private func send() async {
        guard let slot = selectedSlot, !isSending else { return }
        isSending = true
        errorMessage = nil
        defer { isSending = false }
        let request = BookingRequest(listingId: profile.id, startsAt: slot.startsAt, format: format, athleteNotes: notes)
        switch await auth.bookings.request(request) {
        case .success(let booking):
            sent = booking
        case .failure(let error):
            errorMessage = error.message
            // The hour may have just been taken by someone else: show the free hours as they are now.
            if error.status == 409 { selectedSlot = nil; await loadSlots() }
        }
    }
}
