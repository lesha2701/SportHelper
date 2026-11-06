import Foundation

/// The report of an independent training (one the team holds without its coach): the responsible player writes it, the coaching staff
/// accepts it or sends it back.
public final class ReportsService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    private func path(_ training: UUID, _ tail: String = "") -> String { "/api/trainings/\(training.uuidString.lowercased())/report\(tail)" }

    /// nil while nothing was written (the server's `not_found`).
    public func report(of training: UUID) async throws -> TrainingReport? {
        do {
            return try await client.send(.get, path(training))
        } catch let error as APIError where error.code == "not_found" || error.status == 404 {
            return nil
        }
    }

    /// Writes the report, or writes it again: the staff's earlier answer is cleared and the report is «на проверке» once more.
    public func submit(_ draft: ReportDraft, for training: UUID) async throws -> TrainingReport {
        try await client.send(.post, path(training), body: ReportSubmitBody(textReport: draft.tidyText))
    }

    public func review(_ training: UUID, decision: ReportDecision, comment: String) async throws -> TrainingReport {
        try await client.send(
            .post, path(training, "/review"), body: ReportReviewBody(decision: decision.rawValue, coachComment: ReportReview.tidyComment(comment))
        )
    }

    /// The server takes a photo or video only after the text report exists (`report_required`).
    public func attachPhoto(_ photo: Data, to training: UUID) async throws -> TrainingReport {
        try await client.upload(path(training, "/photo"), file: UploadFile(filename: "report.jpg", mimeType: "image/jpeg", data: photo))
    }

    public func attachVideo(_ video: Data, to training: UUID) async throws -> TrainingReport {
        try await client.upload(
            path(training, "/video"), file: UploadFile(filename: "report.mp4", mimeType: VideoRules.mimeType, data: video), timeout: 180
        )
    }
}
