import SportArenaKit
import SwiftUI

/// «Вывести средства»: the amount, where to send it and the account password. The server checks everything again (the balance, the
/// minimum, the password, the details) and its word is shown under the field it is about. The form keeps one key, so sending it again
/// after a lost answer cannot create a second request.
struct WithdrawalFormView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth

    let summary: FinanceSummary
    /// Called with the new request when the server has accepted it.
    var onCreated: (Withdrawal) -> Void

    @State private var form = WithdrawalForm()
    @State private var serverErrors: [WithdrawalForm.Field: String] = [:]
    @State private var triedToSend = false
    @State private var isWorking = false
    @State private var formError: String?
    @FocusState private var focus: WithdrawalForm.Field?

    private var problems: [WithdrawalForm.Field: String] {
        guard triedToSend else { return serverErrors }
        return form.problems(availableKopecks: summary.availableKopecks, minimumKopecks: summary.minimumWithdrawalKopecks)
            .merging(serverErrors) { _, server in server }
    }

    var body: some View {
        NavigationStack {
            Form {
                amountSection
                methodSection
                detailsSection
                passwordSection
                Section {
                    if let formError { Text(formError).font(.footnote).foregroundStyle(Theme.danger).accessibilityIdentifier("withdraw.error") }
                    Button { Task { await submit() } } label: {
                        HStack { Text("Отправить заявку"); if isWorking { ProgressView() } }
                    }
                    .disabled(isWorking)
                    .accessibilityIdentifier("withdraw.submit")
                } footer: {
                    Text("Сумма сразу резервируется под заявку. Выплата выполняется вручную после проверки; до передачи на выплату заявку можно отменить, и деньги вернутся на баланс. Номер банковской карты указывать нельзя.")
                }
            }
            .sagScreen()
            .navigationTitle("Вывод средств")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } } }
            .interactiveDismissDisabled(isWorking)
        }
    }

    // MARK: sections

    private var amountSection: some View {
        Section(sag: "Сумма") {
            FormField(
                title: "Сколько вывести, ₽",
                hint: "Доступно \(Money.kopecks(summary.availableKopecks)). Минимум — \(Money.kopecks(summary.minimumWithdrawalKopecks))."
            ) {
                TextField("Например, 15000", text: $form.amountText)
                    .keyboardType(.decimalPad)
                    .focused($focus, equals: .amount)
                    .accessibilityIdentifier("withdraw.amount")
                    .onChange(of: form.amountText) { _, _ in serverErrors[.amount] = nil }
            }
            error(.amount)
            Button("Вывести всё доступное") { form.amountText = Self.rubles(summary.availableKopecks) }
                .font(.footnote)
                .accessibilityIdentifier("withdraw.all")
        }
    }

    private var methodSection: some View {
        Section(sag: "Куда отправить") {
            Picker("Способ", selection: $form.method) {
                ForEach(PayoutMethod.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.inline)
            .labelsHidden()
            .accessibilityIdentifier("withdraw.method")
        }
    }

    @ViewBuilder private var detailsSection: some View {
        Section(sag: "Реквизиты") {
            field("Получатель", hint: "ФИО или название организации", text: $form.recipient, field: .recipient, content: .name)
            field("Банк", hint: nil, text: $form.bank, field: .bank, content: .organizationName)
            switch form.method {
            case .sbp:
                field("Телефон в СБП", hint: "Российский мобильный: +7 9XX XXX-XX-XX", text: $form.phone, field: .phone, content: .telephoneNumber, keyboard: .phonePad)
            case .bankTransfer:
                field("БИК", hint: "9 цифр", text: $form.bik, field: .bik, keyboard: .numberPad)
                field("Расчётный счёт", hint: "20 цифр", text: $form.account, field: .account, keyboard: .numberPad)
                field("ИНН (необязательно)", hint: "10 или 12 цифр", text: $form.inn, field: .inn, keyboard: .numberPad)
            }
        }
    }

    private var passwordSection: some View {
        Section(sag: "Подтверждение") {
            FormField(title: "Пароль от аккаунта", hint: "Пароль спрашивается ещё раз, чтобы чужой человек с вашего телефона не вывел деньги.") {
                SecureField("Пароль", text: $form.password)
                    .textContentType(.password)
                    .focused($focus, equals: .password)
                    .accessibilityIdentifier("withdraw.password")
                    .onChange(of: form.password) { _, _ in serverErrors[.password] = nil }
            }
            error(.password)
        }
    }

    private func field(
        _ title: String, hint: String?, text: Binding<String>, field: WithdrawalForm.Field,
        content: UITextContentType? = nil, keyboard: UIKeyboardType = .default
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            FormField(title: title, hint: hint) {
                TextField(title, text: text)
                    .textContentType(content)
                    .keyboardType(keyboard)
                    .autocorrectionDisabled()
                    .focused($focus, equals: field)
                    .accessibilityIdentifier("withdraw.\(field.rawValue)")
                    .onChange(of: text.wrappedValue) { _, _ in serverErrors[field] = nil }
            }
            error(field)
        }
    }

    @ViewBuilder private func error(_ field: WithdrawalForm.Field) -> some View {
        if let message = problems[field] {
            Text(message).font(.footnote).foregroundStyle(Theme.danger).accessibilityIdentifier("withdraw.error.\(field.rawValue)")
        }
    }

    // MARK: sending

    private func submit() async {
        triedToSend = true
        formError = nil
        serverErrors = [:]
        guard form.problems(availableKopecks: summary.availableKopecks, minimumKopecks: summary.minimumWithdrawalKopecks).isEmpty else {
            focus = nil
            return
        }
        isWorking = true
        defer { isWorking = false }
        do {
            let created = try await auth.finance.requestWithdrawal(
                form, availableKopecks: summary.availableKopecks, minimumKopecks: summary.minimumWithdrawalKopecks
            )
            form.password = ""
            onCreated(created)
            dismiss()
        } catch let error as APIError {
            if let field = error.field.flatMap(WithdrawalForm.Field.init(rawValue:)) {
                serverErrors[field] = error.message
            } else {
                formError = error.message
            }
        } catch {
            formError = APIError.unknown.message
        }
    }

    /// «15000» or «15000,50»: what the person would type for this many kopecks.
    private static func rubles(_ kopecks: Int) -> String {
        kopecks % 100 == 0 ? String(kopecks / 100) : String(format: "%d,%02d", kopecks / 100, kopecks % 100)
    }
}
