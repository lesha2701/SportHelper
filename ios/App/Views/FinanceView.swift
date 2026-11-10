import SportArenaKit
import SwiftUI

/// «Финансы» of a coach: the balance, the requests for a payout and the money history. Only reading: asking for a payout (it needs
/// the account password and the bank details) stays on the site.
struct FinanceView: View {
    @Environment(AuthStore.self) private var auth

    @State private var summary = LoadState<FinanceSummary>.loading
    @State private var withdrawals = FinanceList<Withdrawal>()
    @State private var operations = FinanceList<FinanceOperation>()

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
            infoSection(value)
            withdrawalsSection
            operationsSection
        }
    }

    private func infoSection(_ value: FinanceSummary) -> some View {
        Section(sag: "Как это работает") {
            if let note = value.withdrawalNote { Text(note).foregroundStyle(Theme.textSecondary) }
            Text(
                "Деньги за занятие становятся доступными к выводу после того, как вы отметите занятие проведённым и платформа его подтвердит. "
                    + "Комиссия платформы — \(value.commissionPercent)% с каждой оплаты. Выплаты выполняются вручную, после проверки заявки."
            )
            .font(.footnote).foregroundStyle(Theme.textSecondary)
        } footer: {
            Text("Заявку на вывод средств можно создать на сайте: для неё нужен пароль от аккаунта и реквизиты.")
        }
    }

    private var withdrawalsSection: some View {
        Section(sag: "Заявки на вывод") {
            if withdrawals.items.isEmpty && !withdrawals.failed {
                Text("Заявок пока нет.").foregroundStyle(Theme.textSecondary).accessibilityIdentifier("finance.noWithdrawals")
            }
            ForEach(withdrawals.items) { item in
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
