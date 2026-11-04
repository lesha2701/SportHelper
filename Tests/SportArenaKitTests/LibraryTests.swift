import Foundation
import Testing
@testable import SportArenaKit

private let host = URL(string: "https://sportarenaglobal.ru")!
private let exerciseId = UUID(uuidString: "11111111-2222-4333-8444-555555555555")!
private let planId = UUID(uuidString: "22222222-2222-4333-8444-555555555555")!
private let teamId = UUID(uuidString: "33333333-2222-4333-8444-555555555555")!
private let itemId = UUID(uuidString: "44444444-2222-4333-8444-555555555555")!

private func object(_ body: some Encodable) throws -> [String: Any] {
    try #require(try JSONSerialization.jsonObject(with: APIClient.encoder.encode(body)) as? [String: Any])
}

private func exerciseJSON(extra: String = "", shared: String = "[]") -> String {
    """
    {"id":"11111111-2222-4333-8444-555555555555","owner_id":"99999999-2222-4333-8444-555555555555","sport":"Большой теннис","name":"Подача",
    "description":null,"goal":"Сила","photo_file_id":null,"video_file_id":null,"sets":3,"reps":10,"duration_seconds":null,"rest_seconds":90,
    "equipment":null,"difficulty":"amateur","technique":null,"common_mistakes":null,"warnings":null,"coach_comment":null,
    "created_at":"2026-11-01T10:00:00Z","updated_at":"2026-11-01T10:00:00Z","shared_team_ids":\(shared)\(extra)}
    """
}

private func planExerciseJSON(section: String = "main", order: Int = 0, name: String = "Подача") -> String {
    """
    {"id":"44444444-2222-4333-8444-555555555555","plan_id":"22222222-2222-4333-8444-555555555555","exercise_id":"11111111-2222-4333-8444-555555555555",
    "exercise_name":"\(name)","section":"\(section)","order_index":\(order),"sets":2,"reps":null,"duration_seconds":120,"rest_seconds":null,"notes":"Медленно"}
    """
}

private func planJSON(exercises: String? = nil) -> String {
    """
    {"id":"22222222-2222-4333-8444-555555555555","owner_id":"99999999-2222-4333-8444-555555555555","sport":"Большой теннис","name":"Силовая",
    "description":null,"duration_minutes":60,"equipment":null,"comment":null,"created_at":"2026-11-01T10:00:00Z","updated_at":"2026-11-01T10:00:00Z",
    "shared_team_ids":[]\(exercises.map { ",\"exercises\":\($0)" } ?? "")}
    """
}

private let templateJSON = """
{"id":"55555555-2222-4333-8444-555555555555","owner_id":"99999999-2222-4333-8444-555555555555","title":"Бег","description":"5 км","plan_id":null,
"metric_name":"Время","metric_unit":"мин","metric_target":30,"require_comment":true,"require_photo":false,"require_video":false,"require_sets_reps":false,
"require_duration":true,"require_metric_value":true,"require_difficulty":false,"require_wellbeing":false,"created_at":"2026-11-01T10:00:00Z",
"updated_at":"2026-11-01T10:00:00Z","exercises":[{"id":"66666666-2222-4333-8444-555555555555","template_id":"55555555-2222-4333-8444-555555555555",
"exercise_id":"11111111-2222-4333-8444-555555555555","exercise_name":"Подача","order_index":0}]}
"""

private func filled() -> ExerciseInput {
    var input = ExerciseInput()
    input.sport = "Футбол"
    input.name = "Удар по воротам"
    return input
}

struct ExerciseModelTests {
    @Test func anExerciseIsReadWithItsPrescriptionAndLevel() throws {
        let exercise = try APIClient.decoder.decode(Exercise.self, from: Data(exerciseJSON().utf8))
        #expect(exercise.name == "Подача" && exercise.difficulty == .amateur && exercise.sharedTeamIds.isEmpty)
        #expect(exercise.prescription == "3 × 10 · отдых 1 мин 30 с")
    }

    @Test func theTeamsAnExerciseIsOpenToAreRead() throws {
        let exercise = try APIClient.decoder.decode(Exercise.self, from: Data(exerciseJSON(shared: "[\"\(teamId)\"]").utf8))
        #expect(exercise.sharedTeamIds == [teamId])
    }

    @Test func aMissingListOfTeamsMeansNone() throws {
        let text = exerciseJSON().replacingOccurrences(of: #","shared_team_ids":[]"#, with: "")
        #expect(try APIClient.decoder.decode(Exercise.self, from: Data(text.utf8)).sharedTeamIds.isEmpty)
    }

    @Test func anExerciseBecomesTheFormsValuesAgain() throws {
        let exercise = try APIClient.decoder.decode(Exercise.self, from: Data(exerciseJSON().utf8))
        let input = exercise.asInput
        #expect(input.sport == "Большой теннис" && input.name == "Подача" && input.goal == "Сила" && input.sets == 3 && input.reps == 10)
        #expect(input.restSeconds == 90 && input.difficulty == .amateur && input.description.isEmpty && input.isValid)
    }

    @Test func durationsAndPrescriptionsReadAsAPersonWouldSayThem() {
        #expect(LibraryFormat.duration(seconds: 45) == "45 с" && LibraryFormat.duration(seconds: 60) == "1 мин")
        #expect(LibraryFormat.duration(seconds: 90) == "1 мин 30 с" && LibraryFormat.duration(seconds: 3600) == "1 ч")
        #expect(LibraryFormat.duration(seconds: 3750) == "1 ч 2 мин 30 с")
        #expect(LibraryFormat.prescription(sets: nil, reps: nil, durationSeconds: nil, restSeconds: nil) == nil)
        #expect(LibraryFormat.prescription(sets: 4, reps: nil, durationSeconds: nil, restSeconds: nil) == "4 подх.")
        #expect(LibraryFormat.prescription(sets: nil, reps: 12, durationSeconds: 30, restSeconds: nil) == "12 повт. · 30 с")
    }
}

struct ExerciseInputTests {
    @Test func aSportAndANameAreRequired() {
        #expect(ExerciseInput().problem == "Выберите вид спорта.")
        var input = ExerciseInput()
        input.sport = "Футбол"
        #expect(input.problem == "Назовите упражнение.")
        input.name = "   "
        #expect(input.problem == "Назовите упражнение.")
        input.name = "Передачи"
        #expect(input.isValid)
    }

    @Test func theLimitsOfTheServerAreKept() {
        var input = filled()
        input.name = String(repeating: "я", count: 151)
        #expect(!input.isValid)
        input.name = String(repeating: "я", count: 150)
        #expect(input.isValid)
        input.sport = String(repeating: "я", count: 51)
        #expect(!input.isValid)
        input = filled()
        input.description = String(repeating: "я", count: 2001)
        #expect(!input.isValid)
        input = filled()
        input.goal = String(repeating: "я", count: 501)
        #expect(!input.isValid)
        input = filled()
        input.warnings = String(repeating: "я", count: 1001)
        #expect(!input.isValid)
        input = filled()
        input.coachComment = String(repeating: "я", count: 1001)
        #expect(!input.isValid)
    }

    @Test func theNumbersStayInTheirRanges() {
        var input = filled()
        input.sets = 100
        input.reps = 1000
        input.durationSeconds = 36_000
        input.restSeconds = 0
        #expect(input.isValid)
        input.sets = 101
        #expect(!input.isValid)
        input.sets = -1
        #expect(!input.isValid)
        input.sets = nil
        input.reps = 1001
        #expect(!input.isValid)
        input.reps = nil
        input.durationSeconds = 36_001
        #expect(!input.isValid)
        input.durationSeconds = nil
        input.restSeconds = 36_001
        #expect(!input.isValid)
    }

    @Test func theBodyTrimsAndSendsClearedFieldsAsNulls() throws {
        var input = filled()
        input.name = "  Удар  "
        input.description = "   "
        input.difficulty = .advanced
        input.sets = 3
        let body = try object(ExerciseBody(input: input))
        #expect(body["name"] as? String == "Удар" && body["sport"] as? String == "Футбол" && body["difficulty"] as? String == "advanced")
        #expect(body["description"] is NSNull && body["goal"] is NSNull && body["reps"] is NSNull && body["sets"] as? Int == 3)
        #expect(body["rest_seconds"] is NSNull && body["coach_comment"] is NSNull)
    }
}

struct PlanModelTests {
    @Test func aListedPlanComesWithoutExercisesAndAnOpenedOneWithThem() throws {
        let listed = try APIClient.decoder.decode(Plan.self, from: Data(planJSON().utf8))
        #expect(listed.exercises.isEmpty && listed.durationMinutes == 60)
        let items = "[\(planExerciseJSON(section: "cooldown", order: 0)),\(planExerciseJSON(section: "main", order: 2, name: "Б")),\(planExerciseJSON(section: "main", order: 1, name: "А"))]"
        let opened = try APIClient.decoder.decode(Plan.self, from: Data(planJSON(exercises: items).utf8))
        #expect(opened.exercises(in: .main).map(\.exerciseName) == ["А", "Б"], "in the order of the plan")
        #expect(opened.exercises(in: .cooldown).count == 1 && opened.exercises(in: .warmup).isEmpty)
    }

    @Test func aPlanExerciseSaysHowItIsDoneThere() throws {
        let item = try APIClient.decoder.decode(PlanExercise.self, from: Data(planExerciseJSON().utf8))
        #expect(item.section == .main && item.prescription == "2 подх. · 2 мин" && item.notes == "Медленно")
        #expect(item.asInput.notes == "Медленно" && item.asInput.section == .main && item.asInput.exerciseId == exerciseId)
    }

    @Test func everySectionHasRussianWording() {
        #expect(PlanSection.allCases.map(\.title) == ["Разминка", "Основная часть", "Игровая часть", "Заминка"])
        #expect(PlanSection.allCases.map(\.rawValue) == ["warmup", "main", "game", "cooldown"])
    }

    @Test func aPlanNeedsASportAndANameAndKeepsItsLimits() {
        var input = PlanInput()
        #expect(input.problem == "Выберите вид спорта.")
        input.sport = "Футбол"
        #expect(input.problem == "Назовите план.")
        input.name = "Силовая"
        #expect(input.isValid)
        input.durationMinutes = 600
        #expect(input.isValid)
        input.durationMinutes = 601
        #expect(!input.isValid)
        input.durationMinutes = nil
        input.comment = String(repeating: "я", count: 1001)
        #expect(!input.isValid)
        input.comment = ""
        input.description = String(repeating: "я", count: 2001)
        #expect(!input.isValid)
    }

    @Test func aPlanItemKeepsItsRanges() {
        var input = PlanExerciseInput(exerciseId: exerciseId)
        #expect(input.isValid && input.section == .main)
        input.orderIndex = 1001
        #expect(!input.isValid)
        input.orderIndex = 0
        input.notes = String(repeating: "я", count: 501)
        #expect(!input.isValid)
        input.notes = ""
        input.sets = 101
        #expect(!input.isValid)
    }

    @Test func thePlanBodiesSendExplicitNullsAndTheSectionName() throws {
        var plan = PlanInput()
        plan.sport = "Футбол"
        plan.name = "Силовая"
        let planBody = try object(PlanBody(input: plan))
        #expect(planBody["duration_minutes"] is NSNull && planBody["description"] is NSNull && planBody["name"] as? String == "Силовая")
        var item = PlanExerciseInput(exerciseId: exerciseId, section: .cooldown, orderIndex: 3)
        item.reps = 12
        let itemBody = try object(PlanExerciseBody(input: item))
        #expect(itemBody["section"] as? String == "cooldown" && itemBody["order_index"] as? Int == 3 && itemBody["reps"] as? Int == 12)
        #expect(itemBody["sets"] is NSNull && itemBody["notes"] is NSNull && itemBody["exercise_id"] as? String == exerciseId.uuidString)
    }
}

struct TemplateModelTests {
    @Test func aTemplateIsReadAndBecomesATaskForm() throws {
        let template = try APIClient.decoder.decode(TaskTemplate.self, from: Data(templateJSON.utf8))
        #expect(template.title == "Бег" && template.requirements == [.comment, .duration, .metricValue])
        let input = try #require(template.asTaskInput)
        #expect(input.title == "Бег" && input.description == "5 км" && input.metricName == "Время" && input.metricUnit == "мин" && input.metricTarget == 30)
        #expect(input.requirements.duration && input.requirements.metricValue && !input.requirements.photo)
        #expect(input.exerciseIds == [exerciseId] && input.deadline == nil)
    }

    @Test func aTemplateBodyHasNoDeadlineNoPeopleAndExplicitNulls() throws {
        var needs = TaskRequirements()
        needs.photo = true
        let input = try #require(TaskInput(title: "Бег", requirements: needs, audience: .players([UUID()])))
        let body = try object(TaskTemplateBody(input: input))
        #expect(body["title"] as? String == "Бег" && body["require_photo"] as? Bool == true && body["require_video"] as? Bool == false)
        #expect(body["description"] is NSNull && body["plan_id"] is NSNull && body["metric_name"] is NSNull)
        #expect(body["deadline"] == nil && body["player_ids"] == nil && body["target_type"] == nil)
    }
}

struct LibraryServiceTests {
    private func make(_ handler: @escaping MockServer.Handler) -> (LibraryService, APIClient) {
        let api = APIClient(baseURL: host, session: MockServer.session(handler))
        return (LibraryService(client: api), api)
    }

    private func calls(_ seen: RequestLog) -> [String] { seen.all.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" } }

    @Test func exercisesAreListedFromTheCoachAndFromATeam() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in seen.add(request); return json("[\(exerciseJSON())]") }
        #expect(try await service.exercises().count == 1)
        #expect(try await service.teamExercises(teamId).count == 1)
        #expect(calls(seen) == ["GET /api/exercises/mine", "GET /api/teams/\(teamId.uuidString.lowercased())/exercises"])
    }

    @Test func addingAnExercisePostsItWithTheToken() async throws {
        let seen = RequestLog()
        let (service, api) = make { request in seen.add(request); return json(exerciseJSON()) }
        await api.setCSRFToken("csrf-l")
        _ = try await service.createExercise(filled())
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "POST" && request.url?.path == "/api/exercises" && request.value(forHTTPHeaderField: "X-CSRF-Token") == "csrf-l")
    }

    @Test func theLifecycleOfAnExerciseUsesItsOwnPaths() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in
            seen.add(request)
            return request.httpMethod == "DELETE" && !(request.url?.path.contains("/share/") ?? false) ? (204, [:], Data()) : json(exerciseJSON())
        }
        let id = exerciseId.uuidString.lowercased(), team = teamId.uuidString.lowercased()
        _ = try await service.exercise(exerciseId)
        _ = try await service.updateExercise(exerciseId, filled())
        _ = try await service.shareExercise(exerciseId, with: teamId)
        _ = try await service.unshareExercise(exerciseId, from: teamId)
        try await service.deleteExercise(exerciseId)
        #expect(calls(seen) == [
            "GET /api/exercises/\(id)", "PUT /api/exercises/\(id)", "POST /api/exercises/\(id)/share", "DELETE /api/exercises/\(id)/share/\(team)",
            "DELETE /api/exercises/\(id)",
        ])
        #expect(seen.all[2].bodyJSON?["team_id"] as? String == teamId.uuidString.lowercased() || seen.all[2].bodyJSON?["team_id"] as? String == teamId.uuidString)
    }

    @Test func aPhotoOfAnExerciseIsUploadedAsMultipart() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in seen.add(request); return json(exerciseJSON()) }
        _ = try await service.attachPhoto(Data([1, 2, 3]), filename: "photo.jpg", mimeType: "image/jpeg", to: exerciseId)
        let request = try #require(seen.all.first)
        #expect(request.url?.path == "/api/exercises/\(exerciseId.uuidString.lowercased())/photo")
        #expect(request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data") == true)
    }

    @Test func thePlanCallsUseTheirOwnPaths() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in
            seen.add(request)
            let path = request.url?.path ?? ""
            if path.hasSuffix("/exercises") || path.contains("/exercises/") {
                return request.httpMethod == "DELETE" ? (204, [:], Data()) : json(planExerciseJSON())
            }
            if request.httpMethod == "DELETE", !path.contains("/share/") { return (204, [:], Data()) }
            return json(request.httpMethod == "GET" && path == "/api/plans/mine" ? "[\(planJSON())]" : planJSON())
        }
        var plan = PlanInput()
        plan.sport = "Футбол"
        plan.name = "Силовая"
        let id = planId.uuidString.lowercased(), item = itemId.uuidString.lowercased()
        #expect(try await service.plans().count == 1)
        _ = try await service.plan(planId)
        _ = try await service.createPlan(plan)
        _ = try await service.updatePlan(planId, plan)
        _ = try await service.duplicatePlan(planId)
        _ = try await service.addExercise(PlanExerciseInput(exerciseId: exerciseId), to: planId)
        _ = try await service.updateExercise(itemId, in: planId, PlanExerciseInput(exerciseId: exerciseId))
        try await service.removeExercise(itemId, from: planId)
        _ = try await service.sharePlan(planId, with: teamId)
        _ = try await service.unsharePlan(planId, from: teamId)
        try await service.deletePlan(planId)
        #expect(calls(seen) == [
            "GET /api/plans/mine", "GET /api/plans/\(id)", "POST /api/plans", "PUT /api/plans/\(id)", "POST /api/plans/\(id)/duplicate",
            "POST /api/plans/\(id)/exercises", "PUT /api/plans/\(id)/exercises/\(item)", "DELETE /api/plans/\(id)/exercises/\(item)",
            "POST /api/plans/\(id)/share", "DELETE /api/plans/\(id)/share/\(teamId.uuidString.lowercased())", "DELETE /api/plans/\(id)",
        ])
    }

    @Test func theTemplateCallsUseTheirOwnPaths() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in
            seen.add(request)
            if request.httpMethod == "DELETE" { return (204, [:], Data()) }
            return json(request.url?.path == "/api/task-templates/mine" ? "[\(templateJSON)]" : templateJSON)
        }
        let input = try #require(TaskInput(title: "Бег"))
        let id = "55555555-2222-4333-8444-555555555555"
        let templateId = try #require(UUID(uuidString: id))
        #expect(try await service.templates().count == 1)
        _ = try await service.template(templateId)
        _ = try await service.createTemplate(input)
        _ = try await service.updateTemplate(templateId, input)
        try await service.deleteTemplate(templateId)
        #expect(calls(seen) == [
            "GET /api/task-templates/mine", "GET /api/task-templates/\(id)", "POST /api/task-templates", "PUT /api/task-templates/\(id)",
            "DELETE /api/task-templates/\(id)",
        ])
    }

    @Test func aMissingCoachProfileKeepsItsCode() async throws {
        let (service, _) = make { _ in
            json(#"{"error":{"code":"coach_profile_required","message":"create a coach profile","field":null,"retry_after":null}}"#, status: 409)
        }
        do {
            _ = try await service.createExercise(filled())
            Issue.record("should have thrown")
        } catch let error as APIError {
            #expect(error.status == 409 && error.code == "coach_profile_required")
        }
    }
}
