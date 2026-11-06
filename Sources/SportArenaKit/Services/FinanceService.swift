import Foundation

/// A coach's own finances (`/api/finance`). Read only: the app shows the balance, the money history and the withdrawal requests;
/// asking for a payout stays on the site. The server answers 503 while the section is switched off and 403 to anyone but a coach.
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

    private static func paging(_ limit: Int, _ offset: Int) -> [URLQueryItem] {
        [URLQueryItem(name: "limit", value: String(limit)), URLQueryItem(name: "offset", value: String(offset))]
    }
}
