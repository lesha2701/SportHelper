import Foundation

/// «Пожаловаться»: a complaint goes to the moderators, the author never learns of it, and the person gets no answer but «received».
public final class ComplaintsService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    /// Sends the complaint. The server's own reasons for a refusal come back in Russian (one's own thing, an earlier complaint that is
    /// still open, too many open complaints, more than ten in an hour).
    public func report(_ target: ComplaintTarget, id: UUID, draft: ComplaintDraft) async throws {
        guard let reason = draft.reason, draft.isReady else { throw APIError(status: 0, code: "incomplete", message: "Выберите причину жалобы.") }
        try await client.sendIgnoringResponse(
            .post, "/api/complaints", body: ComplaintRequest(targetType: target, targetId: id, reason: reason, comment: draft.tidyComment)
        )
    }
}
