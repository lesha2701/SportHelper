import SportArenaKit
import SwiftUI

/// «Финансы» of a coach: the balance, the requests for a payout (asking for one and taking one back) and the money history.
struct FinanceView: View {
    @Environment(AuthStore.self) private var auth

    @State private var summary = LoadState<FinanceSummary>.loading
    @State private var withdrawals = FinanceList<Withdrawal>()
    @State private var operations = FinanceList<FinanceOperation>()
    @State private var asking = false
    @State private var notice: String?
    @State private var cancelling: Withdrawal?
    @State private var actionError: String?

    var body: some View {
        Group {
            switch summary {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(let message):
                ContentUnavailableView {
                    Label("Не удалось загрузить финансы", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Повторить") { Task { await reload() } }.accessibilityIdentifier("finance.retry")
                }
            case .loaded(let value):
                content(value)
            }
        }
        .sagScreen()
        .navigationTitle("Финансы")
        .navigationBarTitleDisplayMode(.inline)
        .task { await reload() }
        .refreshable { await reload() }
        .sheet(isPresented: $asking) {
            if case .loaded(let value) = summary {
                WithdrawalFormView(summary: value) { created in
                    notice = "Заявка на \(created.amountText) создана. Выплата — после проверки."
                    Task { await reload() }
                }
            }
        }
        .confirmationDialog("Отменить заявку?", isPresented: Binding(get: { cancelling != nil }, set: { if !$0 { cancelling = nil } }), titleVisibility: .visible) {
            Button("Да, отменить", role: .destructive) { if let item = cancelling { Task { await cancel(item) } } }
            Button("Не отменять", role: .cancel) {}
        } message: {
            Text("Деньги вернутся на баланс и снова будут доступны к выводу.")
        }
    }

    private func content(_ value: FinanceSummary) -> some View {
        List {
            Section {
                StatTiles([
                    (Money.kopecks(value.availableKopecks), "Доступно к выводу"),
                    (Money.kopecks(value.pendingKopecks), "Ожидает проведения занятия"),
                    (Money.kopecks(value.reservedKopecks), "В обработке (заявки на вывод)"),
                    (Money.kopecks(value.paidOutKopecks), "Выплачено всего"),
                ])
                .accessibilityIdentifier("finance.balance")
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            if let debt = value.debtNote {
                Section { Label(debt, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.danger).accessibilityIdentifier("finance.debt") }
            }
            withdrawSection(value)
            infoSection(value)
            withdrawalsSection
            operationsSection
        }
    }

    private func withdrawSection(_ value: FinanceSummary) -> some View {
        Section {
            if let notice { AuthNotice(kind: .success, text: notice).accessibilityIdentifier("finance.notice") }
            if let actionError { AuthNotice(kind: .danger, text: actionError).accessibilityIdentifier("finance.actionError") }
            Button("Вывести средства") { notice = nil; actionError = nil; asking = true }
                .disabled(!value.canWithdraw)
                .accessibilityIdentifier("finance.withdraw")
            if let note = value.withdrawalNote { Text(note).font(.footnote).foregroundStyle(Theme.textSecondary).accessibilityIdentifier("finance.withdrawNote") }
        }
    }

    private func infoSection(_ value: FinanceSummary) -> some View {
        Section(sag: "Как это работает") {
            Text(
                "Деньги за занятие становятся доступными к выводу после того, как вы отметите занятие проведённым и платформа его подтвердит. "
                    + "Комиссия платформы — \(value.commissionPercent)% с каждой оплаты. Выплаты выполняются вручную, после проверки заявки."
            )
            .font(.footnote).foregroundStyle(Theme.textSecondary)
        } footer: {
            Text("Для заявки нужны реквизиты и пароль от аккаунта. Заявку можно отменить, пока она не передана на выплату.")
        }
    }

    private var withdrawalsSection: some View {
        Section(sag: "Заявки на вывод") {
            if withdrawals.items.isEmpty && !withdrawals.failed {
                Text("Заявок пока нет.").foregroundStyle(Theme.textSecondary).accessibilityIdentifier("finance.noWithdrawals")
            }
            ForEach(withdrawals.items) { item in
                VStack(alignment: .leading, spacing: 4) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(item.amountText).font(Theme.body(16, weight: .bold))
                            Spacer()
                            Text(item.status.title).font(.caption.weight(.semibold)).foregroundStyle(item.status == .paid ? Theme.success : Theme.textSecondary)
                        }
                        Text(item.detailsHint).font(.footnote).foregroundStyle(Theme.textSecondary)
                        Text(Self.date(item.createdAt)).font(.footnote).foregroundStyle(Theme.textTertiary)
                        if let reason = item.decidedReason { Text("Причина: \(reason)").font(.footnote).foregroundStyle(Theme.textSecondary) }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("finance.withdrawal")
                    // Outside the combined text: a button inside it would not be a button for VoiceOver or for a test.
                    if item.isCancelable {
                        Button("Отменить заявку", role: .destructive) { cancelling = item }
                            .font(.footnote).padding(.top, 2)
                            .accessibilityIdentifier("finance.cancelWithdrawal")
                    }
                }
            }
            more(withdrawals, id: "finance.moreWithdrawals") { await loadWithdrawals() }
        }
    }

    private var operationsSection: some View {
        Section(sag: "История операций") {
            if operations.items.isEmpty && !operations.failed {
                Text("Операций пока нет. Они появятся после первой оплаты занятия.").foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("finance.noOperations")
            }
            ForEach(operations.items) { item in
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(item.title).font(Theme.body(15, weight: .semibold))
                        ForEach(item.details, id: \.self) { line in Text(line).font(.footnote).foregroundStyle(Theme.textSecondary) }
                        Text(Self.date(item.createdAt)).font(.footnote).foregroundStyle(Theme.textTertiary)
                    }
                    Spacer(minLength: 8)
                    Text(item.amountText).font(Theme.body(15, weight: .bold)).multilineTextAlignment(.trailing)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("finance.operation")
            }
            more(operations, id: "finance.moreOperations") { await loadOperations() }
        }
    }

    @ViewBuilder private func more<Item>(_ list: FinanceList<Item>, id: String, load: @escaping () async -> Void) -> some View {
        if list.failed { Text("Не удалось загрузить список.").font(.footnote).foregroundStyle(Theme.danger) }
        if list.hasMore || list.failed {
            Button(list.failed ? "Повторить" : "Показать ещё") { Task { await load() } }.accessibilityIdentifier(id)
        }
    }

    private static func date(_ date: Date) -> String {
        date.formatted(.dateTime.day().month(.abbreviated).year().hour().minute().locale(Locale(identifier: "ru_RU")))
    }

    // MARK: loading

    private func reload() async {
        do {
            summary = .loaded(try await auth.finance.summary())
        } catch let error as APIError {
            summary = .failed(error.message)
            return
        } catch {
            summary = .failed(APIError.unknown.message)
            return
        }
        withdrawals = FinanceList()
        operations = FinanceList()
        async let first: Void = loadWithdrawals()
        async let second: Void = loadOperations()
        _ = await (first, second)
    }

    private func cancel(_ item: Withdrawal) async {
        cancelling = nil
        notice = nil
        actionError = nil
        do {
            _ = try await auth.finance.cancelWithdrawal(item.id)
            notice = "Заявка отменена, деньги вернулись на баланс."
        } catch let error as APIError {
            actionError = error.message
        } catch {
            actionError = APIError.unknown.message
        }
        await reload()
    }

    private func loadWithdrawals() async {
        do {
            let page = try await auth.finance.withdrawals(offset: withdrawals.items.count)
            withdrawals.add(page)
        } catch {
            withdrawals.failed = true
        }
    }

    private func loadOperations() async {
        do {
            let page = try await auth.finance.operations(offset: operations.items.count)
            operations.add(page)
        } catch {
            operations.failed = true
        }
    }
}

/// The row in the profile. It is its own view so that a screen that is already long does not grow.
struct FinanceLink: View {
    var body: some View {
        NavigationLink(value: ProfileRoute.finance) { Label("Финансы", systemImage: "wallet.bifold") }.accessibilityIdentifier("profile.finance")
    }
}

/// The pages of one list that were loaded so far.
struct FinanceList<Item: Decodable & Sendable & Identifiable & Sendable> {
    private(set) var items: [Item] = []
    private(set) var hasMore = false
    var failed = false

    mutating func add(_ page: FinancePage<Item>) {
        items += page.items.filter { new in !items.contains { $0.id == new.id } }
        hasMore = page.hasMore
        failed = false
    }
}
