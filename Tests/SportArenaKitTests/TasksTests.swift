import Foundation
import Testing
@testable import SportArenaKit

private let host = URL(string: "https://sportarenaglobal.ru")!
private let taskId = UUID(uuidString: "11111111-2222-4333-8444-555555555555")!
private let teamId = UUID(uuidString: "22222222-2222-4333-8444-555555555555")!
private let playerId = UUID(uuidString: "bbbbbbbb-2222-4333-8444-555555555555")!

private func object(_ body: some Encodable) throws -> [String: Any] {
    try #require(try JSONSerialization.jsonObject(with: APIClient.encoder.encode(body)) as? [String: Any])
}

private func assignmentJSON(status: String = "assigned", photo: String = "null", extra: String = "") -> String {
    """
    {"id":"aaaaaaaa-2222-4333-8444-555555555555","task_id":"11111111-2222-4333-8444-555555555555","user_id":"bbbbbbbb-2222-4333-8444-555555555555",
    "first_name":"Иван","last_name":"Петров","photo_url":null,"position":"Нападающий","status":"\(status)","comment":null,"photo_file_id":\(photo),
    "video_file_id":null,"sets":null,"reps":null,"duration_minutes":null,"metric_value":null,"difficulty":null,"wellbeing":null,"coach_comment":null,
    "reviewed_by":null,"reviewed_at":null,"viewed_at":null,"submitted_at":null,"created_at":"2026-11-01T10:00:00Z","updated_at":"2026-11-01T10:00:00Z"\(extra)}
    """
}

private func taskJSON(flags: [String: Bool] = [:], assignments: [String] = [], deadline: String = "null", metric: String = #""metric_name":null,"metric_unit":null,"metric_target":null"#) -> String {
    func flag(_ name: String) -> String { "\"require_\(name)\":\(flags[name] ?? false)" }
    let needs = ["comment", "photo", "video", "sets_reps", "duration", "metric_value", "difficulty", "wellbeing"].map(flag).joined(separator: ",")
    return """
    {"id":"11111111-2222-4333-8444-555555555555","team_id":"22222222-2222-4333-8444-555555555555","created_by":"33333333-2222-4333-8444-555555555555",
    "title":"Приседания","description":"Три подхода","plan_id":null,"deadline":\(deadline),\(metric),\(needs),"target_type":"team","target_position":null,
    "target_training_id":null,"created_at":"2026-11-01T10:00:00Z","updated_at":"2026-11-01T10:00:00Z","exercises":[],"assignments":[\(assignments.joined(separator: ","))]}
    """
}

private func decodeTask(_ text: String) throws -> TeamTask { try APIClient.decoder.decode(TeamTask.self, from: Data(text.utf8)) }

private func input(
    title: String = "Приседания", description: String = "", deadline: Date? = nil, metricName: String = "", metricUnit: String = "",
    metricTarget: Double? = nil, requirements: TaskRequirements = TaskRequirements(), audience: TaskAudience = .team,
    plan: UUID? = nil, exercises: [UUID] = []
) -> TaskInput? {
    TaskInput(
        title: title, description: description, deadline: deadline, metricName: metricName, metricUnit: metricUnit, metricTarget: metricTarget,
        requirements: requirements, audience: audience, planId: plan, exerciseIds: exercises
    )
}

struct TaskModelTests {
    @Test func aTaskIsReadWithItsRequirementsInTheOrderOfTheForm() throws {
        let task = try decodeTask(taskJSON(flags: ["photo": true, "comment": true, "difficulty": true]))
        #expect(task.requirements == [.comment, .photo, .difficulty])
        #expect(task.title == "Приседания" && task.target == .team && task.deadline == nil && task.assignments.isEmpty)
    }

    @Test func theDeadlineIsAnInstantAndTheMetricReadsAsOneLine() throws {
        let task = try decodeTask(taskJSON(deadline: #""2026-11-10T18:00:00Z""#, metric: #""metric_name":"Вес","metric_unit":"кг","metric_target":80.5"#))
        #expect(task.deadline == ISO8601DateFormatter().date(from: "2026-11-10T18:00:00Z"))
        #expect(task.metricTitle == "Вес, кг" && task.metricTarget == 80.5)
    }

    @Test func progressCountsOnlyPartsThatStillBelongToSomebody() throws {
        let task = try decodeTask(taskJSON(assignments: [assignmentJSON(status: "accepted"), assignmentJSON(status: "submitted"), assignmentJSON(status: "cancelled")]))
        #expect(task.activeAssignments.count == 2 && task.acceptedCount == 1 && task.waitingForReviewCount == 1)
        #expect(task.assignment(of: playerId) != nil && task.assignment(of: UUID()) == nil)
    }

    @Test func aMissingAssignmentsListMeansNoAssignments() throws {
        let text = taskJSON().replacingOccurrences(of: #","exercises":[],"assignments":[]"#, with: "")
        #expect(try decodeTask(text).assignments.isEmpty)
    }

    @Test func myTasksPairATaskWithThePersonsOwnPart() throws {
        let text = #"[{"task":\#(taskJSON()),"assignment":\#(assignmentJSON(status: "needs_revision"))}]"#
        let mine = try APIClient.decoder.decode([MyTask].self, from: Data(text.utf8))
        #expect(mine.count == 1 && mine[0].assignment.status == .needsRevision && mine[0].task.title == "Приседания")
    }

    @Test func statusesKnowWhatThePlayerMayDoAndSpeakRussian() {
        let all: [AssignmentStatus] = [.assigned, .viewed, .inProgress, .submitted, .accepted, .needsRevision, .overdue, .missed, .cancelled]
        for status in all { #expect(status.title.range(of: "[А-Яа-я]", options: .regularExpression) != nil) }
        #expect(AssignmentStatus(raw: "in_progress") == .inProgress && AssignmentStatus(raw: "needs_revision") == .needsRevision)
        #expect(AssignmentStatus(raw: "brand_new") == .other("brand_new"))
        #expect([AssignmentStatus.assigned, .viewed].allSatisfy(\.canStart) && !AssignmentStatus.inProgress.canStart)
        #expect(AssignmentStatus.needsRevision.canSubmit && AssignmentStatus.overdue.canSubmit && !AssignmentStatus.submitted.canSubmit)
        #expect(!AssignmentStatus.accepted.canSubmit && !AssignmentStatus.cancelled.canSubmit)
        #expect(AssignmentStatus.accepted.isClosed && AssignmentStatus.cancelled.isClosed && !AssignmentStatus.overdue.isClosed)
    }
}

struct TaskInputTests {
    @Test func theTextIsTrimmedAndEmptyOptionalFieldsAreAbsent() throws {
        let value = try #require(input(title: "  Бег ", description: "  ", metricName: " ", metricUnit: "км", metricTarget: 5))
        #expect(value.title == "Бег" && value.description == nil && value.metricName == nil)
        #expect(value.metricUnit == nil && value.metricTarget == nil, "a unit and a target mean nothing without the metric")
    }

    @Test func aTitleIsRequiredAndLimited() {
        #expect(input(title: "  ") == nil)
        #expect(input(title: String(repeating: "я", count: 151)) == nil && input(title: String(repeating: "я", count: 150)) != nil)
    }

    @Test func theLimitsOfTheServerAreKept() {
        #expect(input(description: String(repeating: "я", count: 2001)) == nil && input(description: String(repeating: "я", count: 2000)) != nil)
        #expect(input(metricName: String(repeating: "я", count: 101)) == nil)
        #expect(input(metricName: "Вес", metricUnit: String(repeating: "я", count: 31)) == nil)
        #expect(input(metricName: "Вес", metricUnit: String(repeating: "я", count: 30)) != nil)
        #expect(input(metricName: "Вес", metricTarget: .infinity) == nil)
    }

    @Test func askingForAResultNeedsTheNameOfTheMetric() {
        var needs = TaskRequirements()
        needs.metricValue = true
        #expect(input(requirements: needs) == nil)
        #expect(input(metricName: "Время", requirements: needs) != nil)
    }

    @Test func theAudienceMustNameSomebody() {
        #expect(input(audience: .players([])) == nil)
        #expect(input(audience: .players([playerId])) != nil)
        #expect(input(audience: .players((0..<51).map { _ in UUID() })) == nil)
        #expect(input(audience: .position("  ")) == nil)
        #expect(input(audience: .position("Вратарь")) != nil)
    }

    @Test func aTaskFromTheServerBecomesTheFormsValuesAndKeepsThePlanAndExercisesInOrder() throws {
        let plan = UUID()
        let first = UUID(), second = UUID()
        let base = try decodeTask(taskJSON(flags: ["photo": true]))
        let exercises = """
        [{"id":"\(UUID())","task_id":"\(taskId)","exercise_id":"\(second)","exercise_name":"Б","order_index":1},
         {"id":"\(UUID())","task_id":"\(taskId)","exercise_id":"\(first)","exercise_name":"А","order_index":0}]
        """
        let text = taskJSON(flags: ["photo": true])
            .replacingOccurrences(of: #""plan_id":null"#, with: "\"plan_id\":\"\(plan)\"")
            .replacingOccurrences(of: #""exercises":[]"#, with: "\"exercises\":\(exercises)")
        let value = try #require(try decodeTask(text).asInput)
        #expect(value.title == base.title && value.requirements.photo && !value.requirements.video)
        #expect(value.planId == plan && value.exerciseIds == [first, second])
    }
}

struct TaskBodyTests {
    @Test func givingATaskForTheWholeTeamSendsNoPlayersAndSkipsEmptyFields() throws {
        var needs = TaskRequirements()
        needs.photo = true
        let body = try object(TaskCreateBody(try #require(input(requirements: needs))))
        #expect(body["title"] as? String == "Приседания" && body["target_type"] as? String == "team" && body["require_photo"] as? Bool == true)
        #expect(body["require_video"] as? Bool == false && (body["player_ids"] as? [Any])?.isEmpty == true)
        #expect(body["description"] == nil && body["deadline"] == nil && body["position"] == nil)
    }

    @Test func givingATaskToPlayersAndToAPositionNamesThem() throws {
        let players = try object(TaskCreateBody(try #require(input(audience: .players([playerId])))))
        #expect(players["target_type"] as? String == "players" && players["player_ids"] as? [String] == [playerId.uuidString])
        let position = try object(TaskCreateBody(try #require(input(audience: .position(" Вратарь ")))))
        #expect(position["target_type"] as? String == "position" && position["position"] as? String == "Вратарь")
    }

    @Test func theDeadlineGoesAsAnInstantTheServerReadsAsUTC() throws {
        let deadline = try #require(ISO8601DateFormatter().date(from: "2026-11-10T18:00:00Z"))
        let body = try object(TaskCreateBody(try #require(input(deadline: deadline))))
        #expect(body["deadline"] as? String == "2026-11-10T18:00:00Z")
    }

    @Test func changingSendsExplicitNullsAndKeepsThePlanAndExercises() throws {
        let plan = UUID(), exercise = UUID()
        let body = try object(TaskUpdateBody(input: try #require(input(plan: plan, exercises: [exercise]))))
        #expect(body["description"] is NSNull && body["deadline"] is NSNull && body["metric_name"] is NSNull && body["metric_target"] is NSNull)
        #expect(body["plan_id"] as? String == plan.uuidString && body["exercise_ids"] as? [String] == [exercise.uuidString])
        #expect(body["require_comment"] as? Bool == false, "every requirement is stated, so an unticked one is really switched off")
        #expect(body["target_type"] == nil, "the audience cannot be changed")
    }
}

struct TaskSubmissionTests {
    @Test func theRangesOfTheServerAreKept() {
        #expect(TaskSubmission(sets: 100, reps: 1000, durationMinutes: 1000, difficulty: 10, wellbeing: 5) != nil)
        #expect(TaskSubmission(sets: 101) == nil && TaskSubmission(sets: -1) == nil && TaskSubmission(reps: 1001) == nil)
        #expect(TaskSubmission(durationMinutes: 1001) == nil)
        #expect(TaskSubmission(difficulty: 0) == nil && TaskSubmission(difficulty: 11) == nil)
        #expect(TaskSubmission(wellbeing: 0) == nil && TaskSubmission(wellbeing: 6) == nil)
        #expect(TaskSubmission(metricValue: .nan) == nil)
        #expect(TaskSubmission(comment: String(repeating: "я", count: 2001)) == nil)
    }

    @Test func whatIsMissingFollowsWhatTheTaskAsksFor() throws {
        let task = try decodeTask(taskJSON(flags: ["comment": true, "sets_reps": true, "photo": true, "wellbeing": true]))
        let none = try #require(TaskSubmission())
        #expect(none.missing(for: task, assignment: nil) == [.comment, .photo, .setsReps, .wellbeing])
        let partly = try #require(TaskSubmission(comment: "Сделал", sets: 3))
        #expect(partly.missing(for: task, assignment: nil) == [.photo, .setsReps, .wellbeing], "sets without reps is not enough")
        let full = try #require(TaskSubmission(comment: "Сделал", sets: 3, reps: 10, wellbeing: 4))
        let withPhoto = try decodeTask(taskJSON(flags: ["photo": true]))
        let uploaded = try APIClient.decoder.decode(TaskAssignment.self, from: Data(assignmentJSON(photo: "\"\(UUID())\"").utf8))
        #expect(full.missing(for: task, assignment: uploaded).isEmpty)
        #expect(full.missing(for: withPhoto, assignment: nil) == [.photo])
    }

    @Test func aBlankCommentCountsAsMissing() throws {
        let task = try decodeTask(taskJSON(flags: ["comment": true]))
        #expect(try #require(TaskSubmission(comment: "   ")).missing(for: task, assignment: nil) == [.comment])
    }

    @Test func everyFieldIsSentSoAPreviousSubmissionIsReplaced() throws {
        let body = try object(TaskSubmissionBody(submission: try #require(TaskSubmission(comment: "Ок", sets: 3, reps: 10, metricValue: 12.5))))
        #expect(body["comment"] as? String == "Ок" && body["sets"] as? Int == 3 && body["reps"] as? Int == 10 && body["metric_value"] as? Double == 12.5)
        #expect(body["duration_minutes"] is NSNull && body["difficulty"] is NSNull && body["wellbeing"] is NSNull)
    }
}

struct TasksServiceTests {
    private func make(_ handler: @escaping MockServer.Handler) -> (TasksService, APIClient) {
        let api = APIClient(baseURL: host, session: MockServer.session(handler))
        return (TasksService(client: api), api)
    }

    @Test func theTeamsTasksAndMyTasksAreRead() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in
            seen.add(request)
            return json(request.url?.path == "/api/tasks/mine" ? #"[{"task":\#(taskJSON()),"assignment":\#(assignmentJSON())}]"# : "[\(taskJSON())]")
        }
        #expect(try await service.tasks(of: teamId).count == 1)
        #expect(try await service.mine().count == 1)
        #expect(seen.all.map { $0.url?.path } == ["/api/teams/\(teamId.uuidString.lowercased())/tasks", "/api/tasks/mine"])
    }

    @Test func givingATaskPostsToTheTeamWithTheToken() async throws {
        let seen = RequestLog()
        let (service, api) = make { request in seen.add(request); return json(taskJSON()) }
        await api.setCSRFToken("csrf-t")
        _ = try await service.create(try #require(input()), for: teamId)
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "POST" && request.url?.path == "/api/teams/\(teamId.uuidString.lowercased())/tasks")
        #expect(request.value(forHTTPHeaderField: "X-CSRF-Token") == "csrf-t")
    }

    @Test func theLifecycleOfOneTaskUsesItsOwnPaths() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in
            seen.add(request)
            switch request.httpMethod {
            case "DELETE": return (204, [:], Data())
            default: return json(request.url?.path.hasSuffix(taskId.uuidString.lowercased()) == true ? taskJSON() : assignmentJSON())
            }
        }
        _ = try await service.task(taskId)
        _ = try await service.update(taskId, try #require(input()))
        _ = try await service.start(taskId)
        _ = try await service.submit(taskId, try #require(TaskSubmission(comment: "Ок")))
        try await service.delete(taskId)
        let id = taskId.uuidString.lowercased()
        let calls = seen.all.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" }
        #expect(calls == ["GET /api/tasks/\(id)", "PUT /api/tasks/\(id)", "POST /api/tasks/\(id)/start", "POST /api/tasks/\(id)/submit", "DELETE /api/tasks/\(id)"])
    }

    @Test func aReviewNamesThePlayerAndSendsAClearedCommentAsNull() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in seen.add(request); return json(assignmentJSON(status: "accepted")) }
        _ = try await service.review(taskId, player: playerId, decision: .accepted, comment: "  ")
        _ = try await service.review(taskId, player: playerId, decision: .needsRevision, comment: " Ещё раз ")
        let path = "/api/tasks/\(taskId.uuidString.lowercased())/review/\(playerId.uuidString.lowercased())"
        #expect(seen.all.allSatisfy { $0.url?.path == path && $0.httpMethod == "POST" })
        #expect(seen.all[0].bodyJSON?["decision"] as? String == "accepted" && seen.all[0].bodyJSON?["coach_comment"] is NSNull)
        #expect(seen.all[1].bodyJSON?["decision"] as? String == "needs_revision" && seen.all[1].bodyJSON?["coach_comment"] as? String == "Ещё раз")
    }

    @Test func aPhotoIsUploadedAsMultipartToTheSubmitPhotoPath() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in seen.add(request); return json(assignmentJSON(photo: "\"\(UUID())\"")) }
        let assignment = try await service.attachPhoto(Data([1, 2, 3]), filename: "photo.jpg", mimeType: "image/jpeg", to: taskId)
        #expect(assignment.photoFileId != nil)
        let request = try #require(seen.all.first)
        #expect(request.url?.path == "/api/tasks/\(taskId.uuidString.lowercased())/submit/photo")
        #expect(request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data") == true)
        #expect(String(decoding: try #require(request.bodyData), as: UTF8.self).contains("name=\"file\"; filename=\"photo.jpg\""))
    }

    @Test func aTaskThatIsNotYoursIsRefusedWithItsCode() async throws {
        let (service, _) = make { _ in json(#"{"error":{"code":"forbidden","message":"this task is not assigned to you","field":null,"retry_after":null}}"#, status: 403) }
        do {
            _ = try await service.start(taskId)
            Issue.record("should have thrown")
        } catch let error as APIError {
            #expect(error.status == 403 && error.code == "forbidden")
        }
    }
}
