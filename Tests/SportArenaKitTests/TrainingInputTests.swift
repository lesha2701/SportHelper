import Foundation
import Testing
@testable import SportArenaKit

private let host = URL(string: "https://sportarenaglobal.ru")!
private let day = LocalDate(year: 2026, month: 11, day: 9)  // a Monday
private let evening = LocalTime(hour: 18, minute: 30)!

private func input(
    duration: Int = 60, location: String = "", description: String = "", reminder: Int? = nil, until: LocalDate? = nil,
    independent: Bool = false, responsible: UUID? = nil, plan: UUID? = nil
) -> TrainingInput? {
    TrainingInput(
        date: day, time: evening, durationMinutes: duration, location: location, description: description, reminderMinutesBefore: reminder,
        repeatWeeklyUntil: until, isIndependent: independent, responsibleUserId: responsible, planId: plan
    )
}

private func object(_ body: some Encodable) throws -> [String: Any] {
    try #require(try JSONSerialization.jsonObject(with: APIClient.encoder.encode(body)) as? [String: Any])
}

struct TrainingInputTests {
    @Test func theTextIsTrimmedAndEmptyOptionalFieldsAreAbsent() throws {
        let value = try #require(input(location: "  Корт 3 ", description: "   "))
        #expect(value.location == "Корт 3" && value.description == nil)
    }

    @Test(arguments: [0, -5, 601])
    func anImpossibleDurationIsRefused(minutes: Int) {
        #expect(input(duration: minutes) == nil)
    }

    @Test func theLimitsOfTheServerAreKept() {
        #expect(input(duration: 600) != nil && input(duration: 1) != nil)
        #expect(input(location: String(repeating: "я", count: 201)) == nil && input(location: String(repeating: "я", count: 200)) != nil)
        #expect(input(description: String(repeating: "я", count: 2001)) == nil)
        #expect(input(reminder: 10_081) == nil && input(reminder: -1) == nil && input(reminder: 10_080) != nil)
    }

    @Test func aWeeklySeriesRunsOnTheSameWeekdayAndIncludesBothEnds() throws {
        let value = try #require(input(until: LocalDate(year: 2026, month: 11, day: 30)))
        #expect(value.seriesCount == 4)  // 9, 16, 23, 30 November
        let dates = TrainingInput.weeklyDates(from: day, until: LocalDate(year: 2026, month: 11, day: 29))
        #expect(dates.map(\.iso) == ["2026-11-09", "2026-11-16", "2026-11-23"])
    }

    @Test func aSeriesCannotEndBeforeItStartsOrRunWild() {
        #expect(input(until: LocalDate(year: 2026, month: 11, day: 8)) == nil)
        #expect(input(until: LocalDate(year: 2026, month: 11, day: 9)) != nil)  // a "series" of one day
        #expect(input(until: LocalDate(year: 2030, month: 1, day: 1)) == nil)
        #expect(TrainingInput.problem(date: day, durationMinutes: 60, location: "", description: "", reminder: nil, repeatUntil: LocalDate(year: 2030, month: 1, day: 1)) != nil)
    }

    @Test func aResponsiblePlayerOnlyMattersForAnIndependentTraining() throws {
        let player = UUID()
        #expect(try #require(input(independent: false, responsible: player)).responsibleUserId == nil)
        #expect(try #require(input(independent: true, responsible: player)).responsibleUserId == player)
    }

    @Test func everyReminderOptionHasRussianWording() {
        for option in TrainingReminder.options { #expect(TrainingReminder.title(option).range(of: "[А-Яа-я]", options: .regularExpression) != nil) }
        #expect(TrainingReminder.title(60) == "За 1 час" && TrainingReminder.title(120) == "За 2 ч" && TrainingReminder.title(15) == "За 15 мин")
        #expect(TrainingReminder.title(2880) == "За 2 дн." && TrainingReminder.title(nil) == "Без напоминания")
    }
}

struct TrainingBodyTests {
    @Test func schedulingSendsTheDateAndTheTimeTheServerReads() throws {
        let body = try object(TrainingCreateBody(try #require(input(location: "Корт", reminder: 60, until: LocalDate(year: 2026, month: 12, day: 7)))))
        #expect(body["training_date"] as? String == "2026-11-09" && body["start_time"] as? String == "18:30:00")
        #expect(body["duration_minutes"] as? Int == 60 && body["location"] as? String == "Корт" && body["reminder_minutes_before"] as? Int == 60)
        #expect(body["repeat_weekly_until"] as? String == "2026-12-07" && body["is_independent"] as? Bool == false)
        #expect(body["description"] == nil, "an empty field is simply not sent when scheduling")
    }

    @Test func changingSendsExplicitNullsSoClearedFieldsAreReallyCleared() throws {
        let plan = UUID()
        let body = try object(TrainingUpdateBody(input: try #require(input(plan: plan)), status: "cancelled"))
        #expect(body["location"] is NSNull && body["description"] is NSNull && body["reminder_minutes_before"] is NSNull)
        #expect(body["responsible_user_id"] is NSNull)
        #expect(body["plan_id"] as? String == plan.uuidString, "the plan stays attached")
        #expect(body["status"] as? String == "cancelled" && body["start_time"] as? String == "18:30:00")
    }

    @Test func aTrainingFromTheServerBecomesTheFormsValuesAgain() throws {
        let text = """
        {"id":"11111111-2222-4333-8444-555555555555","team_id":"22222222-2222-4333-8444-555555555555","created_by":"33333333-2222-4333-8444-555555555555",
        "type":"independent","plan_id":null,"training_date":"2026-11-09","start_time":"18:30:00","duration_minutes":90,"location":"Зал","description":null,
        "status":"scheduled","reminder_minutes_before":30,"recurrence_group_id":null,"responsible_user_id":"44444444-2222-4333-8444-555555555555",
        "created_at":"2026-11-01T10:00:00Z","updated_at":"2026-11-01T10:00:00Z"}
        """
        let training = try APIClient.decoder.decode(Training.self, from: Data(text.utf8))
        let value = try #require(training.asInput)
        #expect(value.date == day && value.time == evening && value.durationMinutes == 90 && value.location == "Зал")
        #expect(value.isIndependent && value.responsibleUserId?.uuidString.lowercased() == "44444444-2222-4333-8444-555555555555")
        #expect(value.repeatWeeklyUntil == nil, "editing never creates a series")
    }
}

struct TrainingsServiceTests {
    private func make(_ handler: @escaping MockServer.Handler) -> (TrainingsService, APIClient) {
        let api = APIClient(baseURL: host, session: MockServer.session(handler))
        return (TrainingsService(client: api), api)
    }
    private let team = UUID(uuidString: "22222222-2222-4333-8444-555555555555")!
    private let training = UUID(uuidString: "11111111-2222-4333-8444-555555555555")!
    private let trainingJSON = """
    {"id":"11111111-2222-4333-8444-555555555555","team_id":"22222222-2222-4333-8444-555555555555","created_by":"33333333-2222-4333-8444-555555555555",
    "type":"team","plan_id":null,"training_date":"2026-11-09","start_time":"18:30:00","duration_minutes":60,"location":null,"description":null,
    "status":"scheduled","reminder_minutes_before":null,"recurrence_group_id":null,"responsible_user_id":null,
    "created_at":"2026-11-01T10:00:00Z","updated_at":"2026-11-01T10:00:00Z"}
    """

    @Test func schedulingPostsToTheTeamAndReturnsTheSeries() async throws {
        let seen = RequestLog()
        let (service, api) = make { request in seen.add(request); return json("[\(self.trainingJSON),\(self.trainingJSON)]") }
        await api.setCSRFToken("csrf-3")
        let created = try await service.schedule(try #require(input(until: LocalDate(year: 2026, month: 11, day: 16))), for: team)
        #expect(created.count == 2)
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "POST" && request.url?.path == "/api/teams/\(team.uuidString.lowercased())/trainings")
        #expect(request.value(forHTTPHeaderField: "X-CSRF-Token") == "csrf-3")
    }

    @Test func updatingPutsToTheTrainingWithItsStatus() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in seen.add(request); return json(self.trainingJSON) }
        _ = try await service.update(training, try #require(input()), status: .completed)
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "PUT" && request.url?.path == "/api/trainings/\(training.uuidString.lowercased())")
        #expect(String(decoding: try #require(request.bodyData), as: UTF8.self).contains("\"status\":\"completed\""))
    }

    @Test func deletingAndCancellingASeriesUseTheirOwnPaths() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in seen.add(request); return (204, [:], Data()) }
        try await service.delete(training)
        try await service.cancelSeries(of: training)
        let calls = seen.all.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" }
        #expect(calls == ["DELETE /api/trainings/\(training.uuidString.lowercased())", "POST /api/trainings/\(training.uuidString.lowercased())/cancel-series"])
    }

    @Test func aTeamWithoutACaptainSaysSoInTheServersTerms() async {
        let (service, _) = make { _ in json(#"{"error":{"code":"responsible_player_required","message":"Выберите ответственного игрока."}}"#, status: 409) }
        do {
            _ = try await service.schedule(try #require(input(independent: true)), for: team)
            Issue.record("expected an error")
        } catch let error as APIError {
            #expect(error.code == "responsible_player_required")
        } catch { Issue.record("wrong error") }
    }
}
