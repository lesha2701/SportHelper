import Foundation
import Testing
@testable import SportArenaKit

private let base = URL(string: "https://sportarenaglobal.ru")!
private let one = "11111111-2222-4333-8444-555555555555"

private func reportJSON(status: String = "pending", comment: String? = nil) -> String {
    let commentField = comment.map { "\"\($0)\"" } ?? "null"
    return """
    {"training_id":"\(one)","submitted_by":"\(one)","text_report":"Все были","photo_file_id":null,"video_file_id":null,"status":"\(status)",
     "coach_comment":\(commentField),"reviewed_by":null,"reviewed_at":null,"created_at":"2026-11-05T10:00:00Z","updated_at":"2026-11-05T10:00:00Z"}
    """
}

struct ReportModelTests {
    @Test func theStatusesAreSaidInTheSitesWords() throws {
        func title(_ raw: String) throws -> String {
            try APIClient.decoder.decode(TrainingReport.self, from: Data(reportJSON(status: raw).utf8)).status.title
        }
        #expect(try title("pending") == "На проверке")
        #expect(try title("accepted") == "Принят")
        #expect(try title("needs_revision") == "Нужно доработать")
        #expect(try title("something_new") == "something_new")
    }

    @Test func aReportNeedsWordsAndIsCutAtTheLimit() {
        #expect(!ReportDraft().isReady && !ReportDraft(text: " \n ").isReady)
        #expect(ReportDraft(text: "  Все были \n").tidyText == "Все были")
        #expect(ReportDraft(text: String(repeating: "я", count: 2500)).tidyText.count == 2000)
    }

    @Test func aCommentIsTidiedAndAnEmptyOneIsNone() {
        #expect(ReportReview.tidyComment("  ") == nil)
        #expect(ReportReview.tidyComment(" молодцы ") == "молодцы")
        #expect(ReportReview.tidyComment(String(repeating: "я", count: 1500))?.count == 1000)
    }

    @Test func aTrainingHasHappenedWhenHeldOrItsDayHasPassed() throws {
        func training(_ status: String, _ date: String) throws -> Training {
            let json = """
            {"id":"\(one)","team_id":"\(one)","created_by":"\(one)","type":"independent","plan_id":null,"training_date":"\(date)","start_time":"18:00:00",
             "duration_minutes":60,"location":null,"description":null,"status":"\(status)","reminder_minutes_before":null,"recurrence_group_id":null,
             "responsible_user_id":"\(one)"}
            """
            return try APIClient.decoder.decode(Training.self, from: Data(json.utf8))
        }
        let today = LocalDate(year: 2026, month: 11, day: 5)
        #expect(try training("completed", "2026-11-20").hasHappened(today: today))
        #expect(try training("scheduled", "2026-11-04").hasHappened(today: today))
        #expect(try !training("scheduled", "2026-11-05").hasHappened(today: today))
        #expect(try !training("cancelled", "2026-11-01").hasHappened(today: today))
    }
}

struct ReportsServiceTests {
    private func make(_ handler: @escaping MockServer.Handler) -> ReportsService {
        ReportsService(client: APIClient(baseURL: base, session: MockServer.session(handler)))
    }
    private let training = UUID(uuidString: one)!

    @Test func noReportYetIsNilNotAnError() async throws {
        let service = make { _ in json(#"{"error":{"code":"not_found","message":"Отчёт ещё не отправлен."}}"#, status: 404) }
        #expect(try await service.report(of: training) == nil)
    }

    @Test func aRefusedReadStaysAnError() async {
        let service = make { _ in json(#"{"error":{"code":"forbidden","message":"Нет доступа."}}"#, status: 403) }
        do {
            _ = try await service.report(of: training)
            Issue.record("a stranger read the report")
        } catch let error as APIError {
            #expect(error.status == 403)
        } catch {
            Issue.record("unexpected \(error)")
        }
    }

    @Test func theTextGoesToTheTrainingsReport() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json(reportJSON()) }
        let report = try await service.submit(ReportDraft(text: "  Все были "), for: training)
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "POST" && request.url?.path == "/api/trainings/\(one)/report")
        #expect(request.bodyJSON?["text_report"] as? String == "Все были" && report.status == .pending)
    }

    @Test func aDecisionCarriesTheCommentOrAnExplicitNull() async throws {
        let seen = RequestLog()
        let service = make { request in seen.add(request); return json(reportJSON(status: "needs_revision", comment: "Мало подробностей")) }
        let report = try await service.review(training, decision: .needsRevision, comment: " Мало подробностей ")
        #expect(seen.all.first?.url?.path == "/api/trainings/\(one)/report/review")
        #expect(seen.all.first?.bodyJSON?["decision"] as? String == "needs_revision")
        #expect(seen.all.first?.bodyJSON?["coach_comment"] as? String == "Мало подробностей" && report.coachComment == "Мало подробностей")

        _ = try await service.review(training, decision: .accepted, comment: "  ")
        let second = try #require(seen.all.last?.bodyJSON)
        #expect(second["decision"] as? String == "accepted" && second["coach_comment"] is NSNull)
    }

    @Test func aPhotoBeforeTheTextIsRefusedWithTheServersCode() async {
        let service = make { _ in json(#"{"error":{"code":"report_required","message":"Сначала отправьте текст."}}"#, status: 409) }
        do {
            _ = try await service.attachPhoto(Data([1]), to: training)
            Issue.record("a photo went through with no report")
        } catch let error as APIError {
            #expect(error.code == "report_required")
        } catch {
            Issue.record("unexpected \(error)")
        }
    }
}
