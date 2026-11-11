import Foundation

/// A coach's own finances (`/api/finance`): the balance, the money history, the withdrawal requests, and the two things a coach may do
/// with them: ask for a payout and take back a request that has not gone to payment yet. The server answers 503 while the section is
/// switched off and 403 to anyone but a coach.
public final class FinanceService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    public func summary() async throws -> FinanceSummary {
        try await client.send(.get, "/api/finance/summary")
    }

    /// The money history, newest first.
    public func operations(limit: Int = 20, offset: Int = 0) async throws -> FinancePage<FinanceOperation> {
        try await client.send(.get, "/api/finance/operations", query: Self.paging(limit, offset))
    }

    public func withdrawals(limit: Int = 20, offset: Int = 0) async throws -> FinancePage<Withdrawal> {
        try await client.send(.get, "/api/finance/withdrawals", query: Self.paging(limit, offset))
    }

    /// Asks for a payout. The account password is sent again (the server checks it; there is no other step-up for coaches). A second send
    /// of the same form (`clientKey`) returns the first request, so a lost answer can be retried safely.
    public func requestWithdrawal(_ form: WithdrawalForm, availableKopecks: Int, minimumKopecks: Int) async throws -> Withdrawal {
        guard let request = form.request(availableKopecks: availableKopecks, minimumKopecks: minimumKopecks) else {
            throw APIError(status: 422, code: "invalid_withdrawal_form", message: "Проверьте, что все поля заполнены верно.")
        }
        return try await client.send(.post, "/api/finance/withdrawals", body: request)
    }

    /// Takes a request back (only «Заявка создана» and «На проверке»); the money returns to the available balance.
    public func cancelWithdrawal(_ id: UUID) async throws -> Withdrawal {
        try await client.send(.post, "/api/finance/withdrawals/\(id.uuidString.lowercased())/cancel")
    }

    private static func paging(_ limit: Int, _ offset: Int) -> [URLQueryItem] {
        [URLQueryItem(name: "limit", value: String(limit)), URLQueryItem(name: "offset", value: String(offset))]
    }
}
