import Foundation
import Testing
@testable import SportArenaKit

private let host = URL(string: "https://sportarenaglobal.ru")!
private let today = LocalDate(year: 2026, month: 11, day: 5)

private func activity(_ name: String, rate: Double?, absent: Int = 0, id: UUID = UUID()) -> String {
    """
    {"user_id":"\(id)","first_name":"\(name)","last_name":null,"present_count":3,"absent_count":\(absent),"attendance_rate":\(rate.map { String($0) } ?? "null")}
    """
}

private func teamStatsJSON(frequent: [String] = [], low: [String] = []) -> String {
    """
    {"members_count":8,"trainings_completed":12,"trainings_upcoming":3,"independent_trainings":1,"attendance_rate":0.756,"tasks_total":10,
    "tasks_completed":6,"tasks_overdue":2,"avg_difficulty":6.5,"avg_wellbeing":null,"matches_played":5,"matches_won":3,"matches_lost":1,"matches_drawn":1,
    "low_activity_players":[\(low.joined(separator: ","))],"frequent_absence_players":[\(frequent.joined(separator: ","))]}
    """
}

private func event(_ title: String, _ date: LocalDate, _ time: LocalTime?, status: String = "scheduled", kind: String = "training") -> CalendarEvent {
    CalendarEvent(
        id: UUID(), kind: CalendarEventKind(raw: kind), date: date, time: time, title: title, teamId: nil, teamName: nil, status: status
    )
}

private func match(_ opponent: String, _ date: LocalDate, ours: Int?, theirs: Int?, status: String = "completed") throws -> TeamMatch {
    let score = ours.map { "\"our_score\":\($0),\"opponent_score\":\(theirs ?? 0),\"result\":\"win\"" } ?? "\"our_score\":null,\"opponent_score\":null,\"result\":null"
    let text = """
    {"id":"\(UUID())","team_id":"\(UUID())","created_by":"\(UUID())","opponent_name":"\(opponent)","match_date":"\(date.iso)","start_time":"19:00:00",
    "location":null,"is_home":true,"tournament":null,"status":"\(status)",\(score),"comment":null,"created_at":"2026-11-01T10:00:00Z","updated_at":"2026-11-01T10:00:00Z"}
    """
    return try APIClient.decoder.decode(TeamMatch.self, from: Data(text.utf8))
}

struct StatsModelTests {
    @Test func teamNumbersAreRead() throws {
        let stats = try APIClient.decoder.decode(TeamStats.self, from: Data(teamStatsJSON().utf8))
        #expect(stats.membersCount == 8 && stats.trainingsUpcoming == 3 && stats.tasksOverdue == 2 && stats.avgWellbeing == nil)
        #expect(stats.recordText == "3–1–1" && stats.attendanceRate == 0.756)
    }

    @Test func thoseWhoNeedAttentionAreEachListedOnceTheLeastPresentFirst() throws {
        let both = UUID()
        let stats = try APIClient.decoder.decode(TeamStats.self, from: Data(teamStatsJSON(
            frequent: [activity("Борис", rate: 0.5, absent: 4, id: both), activity("Вера", rate: 0.7, absent: 3)],
            low: [activity("Борис", rate: 0.5, absent: 4, id: both), activity("Глеб", rate: nil), activity("Аня", rate: 0.2)]
        ).utf8))
        #expect(stats.needAttention.map(\.firstName) == ["Аня", "Борис", "Вера", "Глеб"], "a player without a rate goes last")
    }

    @Test func aPlayersNumbersAndRecentMatchesAreRead() throws {
        let text = """
        {"trainings_attended":9,"trainings_total":10,"attendance_rate":0.9,"training_minutes":540,"team_trainings_count":8,"personal_trainings_count":2,
        "activity_streak":4,"tasks_total":5,"tasks_completed":3,"tasks_overdue":1,"coach_comments":[],"metrics":[],"personal_records":[],
        "matches_history":[
         {"id":"\(UUID())","opponent_name":"А","match_date":"2026-10-01","our_score":2,"opponent_score":1,"status":"completed","team_name":"Т"},
         {"id":"\(UUID())","opponent_name":"Б","match_date":"2026-10-20","our_score":0,"opponent_score":3,"status":"completed","team_name":"Т"},
         {"id":"\(UUID())","opponent_name":"В","match_date":"2026-11-20","our_score":null,"opponent_score":null,"status":"scheduled","team_name":"Т"},
         {"id":"\(UUID())","opponent_name":"Г","match_date":"2026-10-10","our_score":1,"opponent_score":1,"status":"completed","team_name":null},
         {"id":"\(UUID())","opponent_name":"Д","match_date":"2026-09-10","our_score":5,"opponent_score":0,"status":"completed","team_name":"Т"}]}
        """
        let stats = try APIClient.decoder.decode(PlayerStats.self, from: Data(text.utf8))
        #expect(stats.activityStreak == 4 && stats.tasksCompleted == 3 && stats.attendanceRate == 0.9)
        #expect(stats.recentMatches().map(\.opponentName) == ["Б", "Г", "А"], "played ones only, the newest first, three of them")
        #expect(stats.recentMatches().map(\.outcome) == [.loss, .draw, .win] && stats.recentMatches().first?.scoreText == "0:3")
    }

    @Test func ratesAverageAndAbsencesReadAsAPersonWouldSayThem() {
        #expect(StatsFormat.rate(nil) == "—" && StatsFormat.rate(0.756) == "76%" && StatsFormat.rate(1) == "100%" && StatsFormat.rate(0) == "0%")
        #expect(StatsFormat.average(nil) == "—" && StatsFormat.average(6.5) == "6,5" && StatsFormat.average(7) == "7")
        #expect([1, 2, 5, 11, 12, 21, 22, 25].map(StatsFormat.absences) == [
            "1 пропуск", "2 пропуска", "5 пропусков", "11 пропусков", "12 пропусков", "21 пропуск", "22 пропуска", "25 пропусков",
        ])
    }
}

struct HomeLogicTests {
    @Test func theNextEventIsTheSoonestOneStillToCome() {
        let events = [
            event("Вчера", today.adding(days: -1), LocalTime(hour: 10, minute: 0)),
            event("Проведена сегодня", today, LocalTime(hour: 8, minute: 0), status: "completed"),
            event("Отменена", today, LocalTime(hour: 9, minute: 0), status: "cancelled"),
            event("Завтра вечером", today.adding(days: 1), LocalTime(hour: 19, minute: 0)),
            event("Завтра утром", today.adding(days: 1), LocalTime(hour: 7, minute: 0)),
            event("Дедлайн", today.adding(days: 1), nil, status: "pending", kind: "task_deadline"),
        ]
        #expect(HomeLogic.nextEvent(in: events, today: today)?.title == "Дедлайн", "an entry without a time comes first that day")
        #expect(HomeLogic.upcoming(events, today: today).map(\.title) == ["Дедлайн", "Завтра утром", "Завтра вечером"])
        #expect(HomeLogic.nextEvent(in: [], today: today) == nil)
        #expect(HomeLogic.nextEvent(in: [events[0], events[1], events[2]], today: today) == nil)
    }

    @Test func todayCountsAsStillToCome() {
        #expect(HomeLogic.nextEvent(in: [event("Сегодня", today, nil)], today: today)?.title == "Сегодня")
    }

    @Test func theTeamsLastMatchesArePlayedOnesNewestFirst() throws {
        let matches = [
            try match("Б", today.adding(days: -10), ours: 1, theirs: 0),
            try match("Будущий", today.adding(days: 5), ours: nil, theirs: nil, status: "scheduled"),
            try match("А", today.adding(days: -3), ours: 2, theirs: 2),
            try match("Отменён", today.adding(days: -2), ours: nil, theirs: nil, status: "cancelled"),
            try match("В", today.adding(days: -20), ours: 3, theirs: 0),
            try match("Г", today.adding(days: -30), ours: 0, theirs: 1),
        ]
        #expect(HomeLogic.recentMatches(matches).map(\.opponentName) == ["А", "Б", "В"])
        #expect(HomeLogic.recentMatches(matches, limit: 10).count == 4)
    }
}

struct StatsServiceTests {
    @Test func theNumbersAreAskedFromTheirOwnPaths() async throws {
        let seen = RequestLog()
        let api = APIClient(baseURL: host, session: MockServer.session { request in
            seen.add(request)
            return request.url?.path.contains("/players/") == true
                ? json(#"{"trainings_attended":0,"trainings_total":0,"attendance_rate":null,"training_minutes":0,"activity_streak":0,"tasks_total":0,"tasks_completed":0,"tasks_overdue":0,"matches_history":[]}"#)
                : json(teamStatsJSON())
        })
        let service = StatsService(client: api)
        let team = UUID(), user = UUID()
        _ = try await service.team(team)
        let player = try await service.player(user)
        #expect(player.attendanceRate == nil && player.matchesHistory.isEmpty)
        #expect(seen.all.map { $0.url?.path } == ["/api/teams/\(team.uuidString.lowercased())/stats", "/api/players/\(user.uuidString.lowercased())/stats"])
    }

    @Test func aPlayerIsRefusedAnotherTeamsNumbers() async throws {
        let api = APIClient(baseURL: host, session: MockServer.session { _ in
            json(#"{"error":{"code":"forbidden","message":"only the head coach","field":null,"retry_after":null}}"#, status: 403)
        })
        do {
            _ = try await StatsService(client: api).team(UUID())
            Issue.record("should have thrown")
        } catch let error as APIError {
            #expect(error.status == 403)
        }
    }
}
