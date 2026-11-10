import Foundation
import Testing
@testable import SportArenaKit

private let host = URL(string: "https://sportarenaglobal.ru")!
private let day = LocalDate(year: 2026, month: 11, day: 5)
private let me = UUID(uuidString: "11111111-2222-4333-8444-555555555555")!
private let coach = UUID(uuidString: "22222222-2222-4333-8444-555555555555")!
private let metricId = UUID(uuidString: "33333333-2222-4333-8444-555555555555")!

private func metricJSON(by author: UUID = coach, unit: String = #""см""#, value: String = "12.5") -> String {
    """
    {"id":"\(metricId)","user_id":"\(me)","recorded_by":"\(author)","name":"Прыжок","unit":\(unit),"value":\(value),"recorded_date":"2026-11-05",
    "higher_is_better":true,"source":null,"comment":"Лучше прошлого","created_at":"2026-11-05T10:00:00Z","updated_at":"2026-11-05T10:00:00Z"}
    """
}

private let fullPlayerJSON = """
{"trainings_attended":9,"trainings_total":12,"attendance_rate":0.9,"training_minutes":545,"team_trainings_count":10,"personal_trainings_count":2,
"activity_streak":4,"tasks_total":5,"tasks_completed":3,"tasks_overdue":1,
"matches_history":[
 {"id":"\(UUID())","opponent_name":"А","match_date":"2026-10-01","our_score":2,"opponent_score":1,"status":"completed","team_name":"Т"},
 {"id":"\(UUID())","opponent_name":"Б","match_date":"2026-10-20","our_score":0,"opponent_score":3,"status":"completed","team_name":"Т"},
 {"id":"\(UUID())","opponent_name":"В","match_date":"2026-11-20","our_score":null,"opponent_score":null,"status":"scheduled","team_name":"Т"}],
"coach_comments":[{"context":"Задание «Бег»","comment":"Хорошо","commented_at":"2026-11-02T09:00:00Z"},{"context":"Отчёт","comment":"Больше растяжки","commented_at":null}],
"metrics":[\(metricJSON())],
"personal_records":[{"name":"Прыжок","unit":"см","value":12.5,"recorded_date":"2026-11-05","higher_is_better":true}]}
"""

struct PlayerStatsModelTests {
    @Test func everythingTheScreenShowsIsRead() throws {
        let stats = try APIClient.decoder.decode(PlayerStats.self, from: Data(fullPlayerJSON.utf8))
        #expect(stats.teamTrainingsCount == 10 && stats.personalTrainingsCount == 2 && stats.trainingMinutes == 545)
        #expect(stats.coachComments.map(\.comment) == ["Хорошо", "Больше растяжки"] && stats.coachComments[1].commentedAt == nil)
        #expect(stats.metrics.first?.name == "Прыжок" && stats.personalRecords.first?.valueText == "12,5 см")
        #expect(stats.hasActivity)
    }

    @Test func theMatchHistoryListsPlayedMatchesNewestFirst() throws {
        let stats = try APIClient.decoder.decode(PlayerStats.self, from: Data(fullPlayerJSON.utf8))
        #expect(stats.playedMatches.map(\.opponentName) == ["Б", "А"], "the one not played yet is not a result")
    }

    @Test func aServerWithoutTheNewFieldsStillGivesANumbersScreen() throws {
        let text = #"{"trainings_attended":0,"trainings_total":0,"attendance_rate":null,"training_minutes":0,"activity_streak":0,"tasks_total":0,"tasks_completed":0,"tasks_overdue":0}"#
        let stats = try APIClient.decoder.decode(PlayerStats.self, from: Data(text.utf8))
        #expect(stats.metrics.isEmpty && stats.coachComments.isEmpty && stats.personalRecords.isEmpty && stats.matchesHistory.isEmpty)
        #expect(!stats.hasActivity, "nothing yet: the screen says the numbers come later")
    }

    @Test func aSingleMeasuredValueIsActivity() throws {
        let text = #"{"trainings_attended":0,"trainings_total":0,"attendance_rate":null,"training_minutes":0,"activity_streak":0,"tasks_total":0,"tasks_completed":0,"tasks_overdue":0,"metrics":[\#(metricJSON())]}"#
        #expect(try APIClient.decoder.decode(PlayerStats.self, from: Data(text.utf8)).hasActivity)
    }

    @Test func aTeamWithoutHeldTrainingsTasksOrMatchesHasNothingToShow() throws {
        func stats(_ done: Int, _ tasks: Int, _ played: Int) throws -> TeamStats {
            let text = """
            {"members_count":3,"trainings_completed":\(done),"trainings_upcoming":4,"independent_trainings":0,"attendance_rate":null,"tasks_total":\(tasks),
            "tasks_completed":0,"tasks_overdue":0,"avg_difficulty":null,"avg_wellbeing":null,"matches_played":\(played),"matches_won":0,"matches_lost":0,
            "matches_drawn":0,"low_activity_players":[],"frequent_absence_players":[]}
            """
            return try APIClient.decoder.decode(TeamStats.self, from: Data(text.utf8))
        }
        #expect(try !stats(0, 0, 0).hasActivity, "only trainings still to come is not yet a history")
        #expect(try stats(1, 0, 0).hasActivity && stats(0, 1, 0).hasActivity && stats(0, 0, 1).hasActivity)
    }

    @Test func attendanceReadsWithTheRightEnding() {
        #expect(StatsFormat.attended(0, of: 0) == "0 из 0 тренировок" && StatsFormat.attended(1, of: 1) == "1 из 1 тренировки")
        #expect(StatsFormat.attended(9, of: 10) == "9 из 10 тренировок" && StatsFormat.attended(3, of: 11) == "3 из 11 тренировок")
        #expect(StatsFormat.attended(3, of: 21) == "3 из 21 тренировки" && StatsFormat.attended(3, of: 12) == "3 из 12 тренировок")
    }

    @Test func trainingTimeReadsInHoursAndMinutes() {
        #expect([0, 45, 60, 90, 545].map(StatsFormat.duration(minutes:)) == ["0 мин", "45 мин", "1 ч", "1 ч 30 мин", "9 ч 5 мин"])
    }
}

struct MetricTests {
    @Test func aMetricIsReadWithItsAuthor() throws {
        let metric = try APIClient.decoder.decode(Metric.self, from: Data(metricJSON().utf8))
        #expect(metric.id == metricId && metric.recordedDate == day && metric.higherIsBetter && metric.source == nil && metric.comment == "Лучше прошлого")
        #expect(metric.valueText == "12,5 см")
        #expect(metric.canBeChanged(by: coach) && !metric.canBeChanged(by: me), "only whoever wrote a value may change it")
    }

    @Test func aValueReadsWithTheRussianCommaAndWithoutNeedlessZeros() {
        #expect(MetricFormat.value(40, unit: nil) == "40" && MetricFormat.value(40, unit: "") == "40")
        #expect(MetricFormat.value(7.25, unit: "сек") == "7,25 сек" && MetricFormat.value(1200, unit: "м") == "1200 м")
        #expect(MetricFormat.value(0.1 + 0.2, unit: nil) == "0,3")
    }

    @Test func theFormIsTrimmedAndEmptyOptionalFieldsAreAbsent() throws {
        let input = try #require(MetricInput(name: "  Прыжок ", unit: " см ", value: 12.5, date: day, source: "  ", comment: " ок "))
        #expect(input.name == "Прыжок" && input.unit == "см" && input.source == nil && input.comment == "ок" && input.higherIsBetter)
    }

    @Test func aNameAndANumberAreRequired() {
        #expect(MetricInput(name: "  ", value: 1, date: day) == nil)
        #expect(MetricInput(name: "Прыжок", value: nil, date: day) == nil)
        #expect(MetricInput(name: "Прыжок", value: .infinity, date: day) == nil && MetricInput(name: "Прыжок", value: .nan, date: day) == nil)
        #expect(MetricInput.problem(name: "", unit: "", value: 1, source: "", comment: "") == "Назовите показатель.")
        #expect(MetricInput.problem(name: "Х", unit: "", value: nil, source: "", comment: "") == "Введите значение числом.")
    }

    @Test func theLimitsOfTheServerAreKept() {
        func make(name: Int = 5, unit: Int = 0, source: Int = 0, comment: Int = 0) -> MetricInput? {
            MetricInput(
                name: String(repeating: "я", count: name), unit: String(repeating: "я", count: unit), value: 1, date: day,
                source: String(repeating: "я", count: source), comment: String(repeating: "я", count: comment)
            )
        }
        #expect(make(name: 150) != nil && make(name: 151) == nil)
        #expect(make(unit: 30) != nil && make(unit: 31) == nil)
        #expect(make(source: 150) != nil && make(source: 151) == nil)
        #expect(make(comment: 1000) != nil && make(comment: 1001) == nil)
    }

    @Test func aSavedMetricBecomesTheFormsValuesAgain() throws {
        let metric = try APIClient.decoder.decode(Metric.self, from: Data(metricJSON().utf8))
        let input = MetricInput(metric)
        #expect(input.name == "Прыжок" && input.value == 12.5 && input.date == day && input.unit == "см" && input.comment == "Лучше прошлого")
    }

    @Test func theBodyHasTheDateAndExplicitNullsSoClearedFieldsAreReallyCleared() throws {
        let input = try #require(MetricInput(name: "Прыжок", value: 12.5, date: day, higherIsBetter: false))
        let body = try #require(try JSONSerialization.jsonObject(with: APIClient.encoder.encode(MetricBody(input))) as? [String: Any])
        #expect(body["name"] as? String == "Прыжок" && body["value"] as? Double == 12.5 && body["recorded_date"] as? String == "2026-11-05")
        #expect(body["higher_is_better"] as? Bool == false)
        #expect(body["unit"] is NSNull && body["source"] is NSNull && body["comment"] is NSNull)
    }
}

struct StatsServiceMetricTests {
    private func make(_ handler: @escaping MockServer.Handler) -> (StatsService, APIClient) {
        let api = APIClient(baseURL: host, session: MockServer.session(handler))
        return (StatsService(client: api), api)
    }

    @Test func addingPostsToThePlayerWithTheToken() async throws {
        let seen = RequestLog()
        let (service, api) = make { request in seen.add(request); return json(metricJSON()) }
        await api.setCSRFToken("csrf-s")
        let saved = try await service.addMetric(try #require(MetricInput(name: "Прыжок", value: 12.5, date: day)), for: me)
        let request = try #require(seen.all.first)
        #expect(saved.name == "Прыжок" && request.httpMethod == "POST" && request.url?.path == "/api/players/\(me.uuidString.lowercased())/metrics")
        #expect(request.value(forHTTPHeaderField: "X-CSRF-Token") == "csrf-s")
    }

    @Test func changingPutsTheMetricAndDeletingDeletesIt() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in
            seen.add(request)
            return request.httpMethod == "DELETE" ? (204, [:], Data()) : json(metricJSON())
        }
        _ = try await service.updateMetric(metricId, try #require(MetricInput(name: "Прыжок", value: 13, date: day)))
        try await service.deleteMetric(metricId)
        let calls = seen.all.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" }
        #expect(calls == ["PUT /api/metrics/\(metricId.uuidString.lowercased())", "DELETE /api/metrics/\(metricId.uuidString.lowercased())"])
    }

    @Test func someoneElsesValueIsNotFoundWhenChanging() async throws {
        let (service, _) = make { _ in json(#"{"error":{"code":"not_found","message":"metric not found","field":null,"retry_after":null}}"#, status: 404) }
        do {
            _ = try await service.updateMetric(metricId, try #require(MetricInput(name: "Х", value: 1, date: day)))
            Issue.record("should have thrown")
        } catch let error as APIError {
            #expect(error.status == 404 && error.code == "not_found")
        }
    }
}

struct AnalysisServiceTests {
    @Test func everyAnalysisHasItsOwnPathAndReturnsTheText() async throws {
        let seen = RequestLog()
        let api = APIClient(baseURL: host, session: MockServer.session { request in seen.add(request); return json(#"{"text":"Всё хорошо"}"#) })
        let service = StatsService(client: api)
        let team = UUID()
        let texts = [try await service.progressAnalysis(), try await service.teamSummary(team), try await service.attendanceAnalysis(team), try await service.reportAnalysis(team)]
        #expect(texts == Array(repeating: "Всё хорошо", count: 4))
        let id = team.uuidString.lowercased()
        #expect(seen.all.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" } == [
            "POST /api/ai/progress-analysis", "POST /api/teams/\(id)/ai/team-summary", "POST /api/teams/\(id)/ai/attendance-analysis", "POST /api/teams/\(id)/ai/report-analysis",
        ])
    }

    @Test func anAnalysisIsGivenTimeToBeWritten() async throws {
        let seen = RequestLog()
        let api = APIClient(baseURL: host, session: MockServer.session { request in seen.add(request); return json(#"{"text":"ок"}"#) })
        _ = try await StatsService(client: api).progressAnalysis()
        #expect(seen.all.first?.timeoutInterval == StatsService.analysisTimeout)
    }

    @Test func aMissingPlayerProfileKeepsItsCode() async throws {
        let api = APIClient(baseURL: host, session: MockServer.session { _ in
            json(#"{"error":{"code":"player_profile_required","message":"create a player profile","field":null,"retry_after":null}}"#, status: 409)
        })
        do {
            _ = try await StatsService(client: api).progressAnalysis()
            Issue.record("should have thrown")
        } catch let error as APIError {
            #expect(error.status == 409 && error.code == "player_profile_required")
        }
    }
}

struct TeamRoleTests {
    @Test func onlyPlayersAndTheCaptainHaveStatisticsToLookAt() {
        #expect(TeamRole.player.isPlayer && TeamRole.captain.isPlayer)
        #expect(!TeamRole.headCoach.isPlayer && !TeamRole.assistantCoach.isPlayer && !TeamRole(raw: "something").isPlayer)
    }
}
