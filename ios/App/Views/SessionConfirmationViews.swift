import SportArenaKit
import SwiftUI

/// Whether the session took place (docs/session-confirmation.md), in the card of a confirmed booking: the line for this side and only
/// the buttons the server allows now — «Подтвердить тренировку», «Показать код тренеру» (athlete), «Ввести код игрока» (coach),
/// «Сообщить о проблеме» (both).
struct SessionConfirmationSection: View {
    @Environment(AuthStore.self) private var auth
    let booking: Booking
    let side: CancelSide

    @State private var working = false
    @State private var error: String?
    @State private var code: SessionCode?
    @State private var enteringCode = false
    @State private var reporting = false

    private var store: BookingsStore { auth.bookings }

    var body: some View {
        if let c = booking.sessionConfirmation, c.line(side: side) != nil || c.hasActions {
            VStack(alignment: .leading, spacing: 8) {
                if let line = c.line(side: side) {
                    Text(line)
                        .font(c.state == .disputed ? .subheadline.weight(.semibold) : .footnote)
                        .foregroundStyle(c.state == .disputed ? Color.primary : Color.secondary)
                        .accessibilityIdentifier("session.line")
                }
                if c.state == .disputed, let text = c.disputeText, !text.isEmpty {
                    Text("«\(text)»").font(.footnote).foregroundStyle(.secondary)
                }
                if let error { Text(error).font(.footnote).foregroundStyle(Theme.danger).accessibilityIdentifier("session.error") }
                if c.canConfirm {
                    Button { Task { await confirm() } } label: {
                        if working { ProgressView().frame(maxWidth: .infinity) } else { Text("Подтвердить тренировку").bold().frame(maxWidth: .infinity) }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(working)
                    .accessibilityIdentifier("session.confirm")
                }
                if c.canGetCode {
                    Button { Task { await showCode() } } label: { Label("Показать код тренеру", systemImage: "number").frame(maxWidth: .infinity) }
                        .buttonStyle(.bordered)
                        .disabled(working)
                        .accessibilityIdentifier("session.showCode")
                }
                if c.canEnterCode {
                    Button { enteringCode = true } label: { Label("Ввести код игрока", systemImage: "number").frame(maxWidth: .infinity) }
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("session.enterCode")
                }
                if c.canReportProblem {
                    Button { reporting = true } label: { Label("Сообщить о проблеме", systemImage: "exclamationmark.bubble").frame(maxWidth: .infinity) }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("session.problem")
                }
            }
            .padding(.top, 4)
            .sheet(item: $code) { SessionCodeSheet(code: $0) }
            .sheet(isPresented: $enteringCode) {
                EnterSessionCodeSheet(booking: booking) { await store.verifySessionCode(booking.id, code: $0) }
            }
            .sheet(isPresented: $reporting) {
                SessionProblemSheet(booking: booking, side: side) { await store.reportProblem(booking.id, kind: $0, text: $1) }
            }
        }
    }

    private func confirm() async {
        working = true
        error = nil
        defer { working = false }
        if case .failure(let failure) = await store.confirmSession(booking.id) { error = failure.message }
    }

    private func showCode() async {
        working = true
        error = nil
        defer { working = false }
        switch await store.sessionCode(booking.id) {
        case .success(let issued): code = issued
        case .failure(let failure): error = failure.message
        }
    }
}

extension SessionCode: Identifiable {
    public var id: String { code + expiresAt.description }
}

/// The athlete shows the code; the coach types it on their side.
struct SessionCodeSheet: View {
    @Environment(\.dismiss) private var dismiss
    let code: SessionCode

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Text(code.display)
                    .font(.system(size: 48, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .tracking(4)
                    .accessibilityLabel("Код \(code.code.map(String.init).joined(separator: " "))")
                    .accessibilityIdentifier("session.code")
                Text("Покажите код тренеру — он введёт его у себя, и тренировка будет подтверждена. "
                    + "Код действует до \(code.expiresAt.formatted(date: .omitted, time: .shortened)). Не сообщайте его, если тренировки не было.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                Spacer()
            }
            .padding(24)
            .navigationTitle("Код для тренера")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Закрыть") { dismiss() }.accessibilityIdentifier("session.codeClose") } }
        }
        .presentationDetents([.medium])
    }
}

/// The coach types the athlete's six digits; a refusal keeps the window open with the server's words (attempts left, expired…).
struct EnterSessionCodeSheet: View {
    @Environment(\.dismiss) private var dismiss
    let booking: Booking
    let verify: (String) async -> Result<Booking, APIError>

    @State private var typed = ""
    @State private var sending = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section(footer: Text("Попросите игрока открыть запись и нажать «Показать код тренеру».")) {
                    TextField("Шесть цифр", text: $typed)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .font(.title2.monospacedDigit())
                        .focused($focused)
                        .accessibilityIdentifier("session.codeField")
                }
                if let error { Section { Text(error).foregroundStyle(Theme.danger).accessibilityIdentifier("session.codeError") } }
                Section {
                    Button { Task { await send() } } label: {
                        if sending { ProgressView().frame(maxWidth: .infinity) } else { Text("Подтвердить").bold().frame(maxWidth: .infinity) }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(sending || typed.trimmingCharacters(in: .whitespaces).isEmpty)
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                    .accessibilityIdentifier("session.codeSend")
                }
            }
            .sagScreen()
            .navigationTitle("Код игрока")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() }.disabled(sending) } }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(sending)
    }

    private func send() async {
        sending = true
        error = nil
        defer { sending = false }
        switch await verify(typed) {
        case .success: dismiss()
        case .failure(let failure): error = failure.message
        }
    }
}

/// «Сообщить о проблеме»: the side chooses what happened (only its own kinds), «Другое» needs words. The coach's money is frozen until an
/// administrator decides.
struct SessionProblemSheet: View {
    @Environment(\.dismiss) private var dismiss
    let booking: Booking
    let side: CancelSide
    let report: (SessionProblemKind, String?) async -> Result<Booking, APIError>

    @State private var kind: SessionProblemKind
    @State private var text = ""
    @State private var sending = false
    @State private var error: String?

    init(booking: Booking, side: CancelSide, report: @escaping (SessionProblemKind, String?) async -> Result<Booking, APIError>) {
        self.booking = booking
        self.side = side
        self.report = report
        _kind = State(initialValue: SessionProblemKind.offered(to: side).first ?? .other)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(footer: Text(side == .coach
                    ? "Оплата за занятие будет заморожена, решение примет администратор."
                    : "Оплата тренеру будет заморожена, решение примет администратор. Если подтвердится, что занятия не было, деньги вернутся вам.")) {
                    Picker("Что случилось", selection: $kind) {
                        ForEach(SessionProblemKind.offered(to: side)) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                    .accessibilityIdentifier("session.problemKind")
                }
                Section(sag: kind == .other ? "Описание (обязательно)" : "Подробности (необязательно)") {
                    TextField("Что произошло", text: $text, axis: .vertical)
                        .lineLimit(2...6)
                        .onChange(of: text) { _, value in if value.count > 1000 { text = String(value.prefix(1000)) } }
                        .accessibilityIdentifier("session.problemText")
                }
                if let error { Section { Text(error).foregroundStyle(Theme.danger).accessibilityIdentifier("session.problemError") } }
                Section {
                    Button(role: .destructive) { Task { await send() } } label: {
                        if sending { ProgressView().frame(maxWidth: .infinity) } else { Text("Отправить").bold().frame(maxWidth: .infinity) }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.danger)
                    .disabled(sending)
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                    .accessibilityIdentifier("session.problemSend")
                }
            }
            .sagScreen()
            .navigationTitle("Сообщить о проблеме")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() }.disabled(sending) } }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(sending)
    }

    private func send() async {
        if kind.needsText(text) {
            error = "Опишите, что случилось."
            return
        }
        sending = true
        error = nil
        defer { sending = false }
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        switch await report(kind, words.isEmpty ? nil : words) {
        case .success: dismiss()
        case .failure(let failure): error = failure.message
        }
    }
}
