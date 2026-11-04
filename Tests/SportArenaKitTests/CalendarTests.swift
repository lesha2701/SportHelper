import Foundation
import Testing
@testable import SportArenaKit

private let base = URL(string: "https://sportarenaglobal.ru")!

struct LocalDateTests {
    @Test func aDateIsReadFromTheServersText() {
        #expect(LocalDate(iso: "2026-11-04") == LocalDate(year: 2026, month: 11, day: 4))
        #expect(LocalDate(year: 2026, month: 3, day: 9).iso == "2026-03-09")
    }

    @Test(arguments: ["2026-02-30", "2026-13-01", "2026-00-10", "26-11-04", "2026-1-4", "2026/11/04", "", "yesterday", "2026-11-04T10:00:00Z"])
    func anythingThatIsNotARealDayIsRefused(text: String) {
        #expect(LocalDate(iso: text) == nil)
    }

    @Test func leapDaysAreRealOnlyInLeapYears() {
        #expect(LocalDate(iso: "2028-02-29") != nil)
        #expect(LocalDate(iso: "2026-02-29") == nil)
    }

    @Test func daysAreOrderedByYearThenMonthThenDay() {
        #expect(LocalDate(year: 2026, month: 11, day: 30) < LocalDate(year: 2026, month: 12, day: 1))
        #expect(LocalDate(year: 2025, month: 12, day: 31) < LocalDate(year: 2026, month: 1, day: 1))
        #expect(!(LocalDate(year: 2026, month: 11, day: 4) < LocalDate(year: 2026, month: 11, day: 4)))
    }

    @Test func addingDaysCrossesMonthsYearsAndLeapDays() {
        #expect(LocalDate(iso: "2026-11-30")!.adding(days: 1).iso == "2026-12-01")
        #expect(LocalDate(iso: "2026-12-31")!.adding(days: 1).iso == "2027-01-01")
        #expect(LocalDate(iso: "2028-02-28")!.adding(days: 1).iso == "2028-02-29")
        #expect(LocalDate(iso: "2026-03-01")!.adding(days: -1).iso == "2026-02-28")
        #expect(LocalDate(iso: "2026-11-04")!.adding(days: 0).iso == "2026-11-04")
    }

    @Test func dayCountingIsNotShiftedByDaylightSavingChanges() {
        // The days around the clock changes in Europe and the US: always exactly one day per day.
        for start in ["2026-03-28", "2026-03-07", "2026-10-24", "2026-10-31", "2026-11-01"] {
            let day = LocalDate(iso: start)!
            #expect(day.adding(days: 3).days(until: day) == -3)
            #expect(day.days(until: day.adding(days: 3)) == 3)
            #expect(day.adding(days: 1).iso > start)
        }
    }

    @Test func theWeekStartsOnMonday() {
        let wednesday = LocalDate(iso: "2026-11-04")!  // a Wednesday
        #expect(wednesday.weekdayIndex == 2)
        #expect(wednesday.startOfWeek.iso == "2026-11-02")
        #expect(wednesday.weekDays.map(\.iso) == ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"])
        #expect(LocalDate(iso: "2026-11-08")!.weekdayIndex == 6)  // Sunday closes the week
        #expect(LocalDate(iso: "2026-11-09")!.startOfWeek.iso == "2026-11-09")
    }

    @Test func todayIsTheDayOnThePhoneNotInUTC() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Pacific/Auckland")!  // already tomorrow there
        let instant = Date(timeIntervalSince1970: 1_793_802_767)  // 2026-11-04 14:32 UTC = 2026-11-05 03:32 in Auckland
        #expect(LocalDate.today(now: instant, calendar: calendar).iso == "2026-11-05")
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        #expect(LocalDate.today(now: instant, calendar: calendar).iso == "2026-11-04")
    }
}

struct LocalTimeTests {
    @Test func aTimeIsReadWithOrWithoutSeconds() {
        #expect(LocalTime(string: "18:30:00") == LocalTime(hour: 18, minute: 30))
        #expect(LocalTime(string: "07:05")?.display == "07:05")
    }

    @Test(arguments: ["24:00:00", "12:60", "ab:cd", "12", "", "1:2:3:4"])
    func aNonsenseTimeIsRefused(text: String) {
        #expect(LocalTime(string: text) == nil)
    }

    @Test func addingMinutesWrapsPastMidnightAndSaysSo() {
        let late = LocalTime(hour: 23, minute: 30)!
        let result = late.adding(minutes: 60)
        #expect(result.time.display == "00:30" && result.nextDay)
        let morning = LocalTime(hour: 9, minute: 0)!.adding(minutes: 90)
        #expect(morning.time.display == "10:30" && !morning.nextDay)
    }
}

private let trainingJSON = """
{"id":"11111111-2222-4333-8444-555555555555","team_id":null,"created_by":"99999999-2222-4333-8444-555555555555","type":"personal",
 "plan_id":null,"training_date":"2026-11-04","start_time":"18:30:00","duration_minutes":60,"location":"Корт №3","description":"Подача",
 "status":"scheduled","reminder_minutes_before":30,"recurrence_group_id":null,"responsible_user_id":null,
 "created_at":"2026-11-01T10:00:00Z","updated_at":"2026-11-01T10:00:00Z"}
"""

private func event(_ kind: String = "training", date: String, time: String?, title: String = "Тренировка", status: String = "scheduled") -> CalendarEvent {
    let timeJSON = time.map { "\"\($0)\"" } ?? "null"
    let text = """
    {"id":"\(UUID().uuidString)","type":"\(kind)","date":"\(date)","time":\(timeJSON),"title":"\(title)","team_id":null,"team_name":null,"status":"\(status)"}
    """
    // swiftlint:disable:next force_try
    return try! APIClient.decoder.decode(CalendarEvent.self, from: Data(text.utf8))
}

struct CalendarModelTests {
    @Test func anEventIsReadWithItsDayAndTime() throws {
        let text = #"{"id":"11111111-2222-4333-8444-555555555555","type":"match","date":"2026-11-07","time":"12:00:00","title":"Матч","team_id":"99999999-2222-4333-8444-555555555555","team_name":"Ястребы","status":"scheduled"}"#
        let event = try APIClient.decoder.decode(CalendarEvent.self, from: Data(text.utf8))
        #expect(event.kind == .match && event.date.iso == "2026-11-07" && event.time?.display == "12:00")
        #expect(event.teamName == "Ястребы" && event.teamId != nil && !event.isTraining)
    }

    @Test func anEventWithoutATimeAndAKindWeDoNotKnowStillLoad() throws {
        let item = event("tournament", date: "2026-11-07", time: nil)
        #expect(item.kind == .other("tournament") && item.time == nil)
    }

    @Test func aWholeCalendarFailsNotOnOneBadDayButItIsReportedNotCrashed() throws {
        let text = """
        [{"id":"11111111-2222-4333-8444-555555555555","type":"training","date":"2026-02-30","time":null,"title":"x",
          "team_id":null,"team_name":null,"status":"scheduled"}]
        """
        #expect(throws: DecodingError.self) { try APIClient.decoder.decode([CalendarEvent].self, from: Data(text.utf8)) }
    }

    @Test func aTrainingNeverMarkedHeldIsOverdueOnlyOnceItsDayHasPassed() {
        let today = LocalDate(iso: "2026-11-04")!
        #expect(event(date: "2026-11-03", time: "10:00:00").isOverdue(today: today))
        #expect(!event(date: "2026-11-04", time: "10:00:00").isOverdue(today: today))  // today is not overdue yet
        #expect(!event(date: "2026-11-03", time: "10:00:00", status: "completed").isOverdue(today: today))
        #expect(!event(date: "2026-11-03", time: "10:00:00", status: "cancelled").isOverdue(today: today))
        #expect(!event("match", date: "2026-11-03", time: nil).isOverdue(today: today))  // only trainings can be overdue
    }

    @Test func aTrainingIsReadAndItsTimeRangeIsShown() throws {
        let training = try APIClient.decoder.decode(Training.self, from: Data(trainingJSON.utf8))
        #expect(training.trainingType == .personal && training.trainingStatus == .scheduled)
        #expect(training.timeRange == "18:30 – 19:30" && training.location == "Корт №3" && training.reminderMinutesBefore == 30)
        #expect(training.trainingType?.title == "Личная тренировка" && training.trainingStatus?.title == "Запланирована")
    }

    @Test func aLateTrainingSaysItEndsTheNextDay() throws {
        let late = trainingJSON.replacingOccurrences(of: "18:30:00", with: "23:30:00")
        #expect(try APIClient.decoder.decode(Training.self, from: Data(late.utf8)).timeRange == "23:30 – 00:30 (+1 день)")
    }

    @Test func aStatusOrTypeWeDoNotKnowIsKeptNotFatal() throws {
        let text = trainingJSON.replacingOccurrences(of: "\"personal\"", with: "\"clinic\"").replacingOccurrences(of: "\"scheduled\"", with: "\"postponed\"")
        let training = try APIClient.decoder.decode(Training.self, from: Data(text.utf8))
        #expect(training.type == "clinic" && training.trainingType == nil && training.status == "postponed" && training.trainingStatus == nil)
    }
}

struct CalendarGroupingTests {
    @Test func eventsAreGroupedByDayAndSortedByTime() {
        let days = CalendarGrouping.days([
            event(date: "2026-11-05", time: "09:00:00", title: "Б"),
            event(date: "2026-11-04", time: "18:00:00", title: "В"),
            event(date: "2026-11-04", time: "09:00:00", title: "А"),
            event("task_deadline", date: "2026-11-04", time: nil, title: "Срок"),
        ])
        #expect(days.map(\.date.iso) == ["2026-11-04", "2026-11-05"])
        #expect(days[0].events.map(\.title) == ["Срок", "А", "В"])  // no time first, then by the clock
    }

    @Test func aWeekAlwaysHasSevenDaysEvenWhenEmpty() {
        let monday = LocalDate(iso: "2026-11-02")!
        let week = CalendarGrouping.week([event(date: "2026-11-04", time: "10:00:00")], startingAt: monday)
        #expect(week.count == 7 && week.map(\.date.iso).first == "2026-11-02" && week.last?.date.iso == "2026-11-08")
        #expect(week.map(\.events.count) == [0, 0, 1, 0, 0, 0, 0])
    }

    @Test func theListPutsWhatNeedsAttentionFirstThenTheFutureThenThePast() {
        let today = LocalDate(iso: "2026-11-04")!
        let list = CalendarGrouping.list([
            event(date: "2026-11-01", time: "10:00:00", title: "забыли отметить"),
            event(date: "2026-11-02", time: "10:00:00", title: "проведена", status: "completed"),
            event(date: "2026-11-03", time: "10:00:00", title: "отменена", status: "cancelled"),
            event(date: "2026-11-04", time: "10:00:00", title: "сегодня"),
            event(date: "2026-11-10", time: "10:00:00", title: "позже"),
        ], today: today)
        #expect(list.overdue.flatMap(\.events).map(\.title) == ["забыли отметить"])
        #expect(list.upcoming.flatMap(\.events).map(\.title) == ["сегодня", "позже"])
        #expect(list.past.flatMap(\.events).map(\.title) == ["отменена", "проведена"])  // newest first
    }

    @Test func anEmptyCalendarGroupsToNothing() {
        let list = CalendarGrouping.list([], today: LocalDate(iso: "2026-11-04")!)
        #expect(list.overdue.isEmpty && list.upcoming.isEmpty && list.past.isEmpty)
        #expect(CalendarGrouping.days([]).isEmpty)
    }
}

struct CalendarServiceTests {
    @Test func theCalendarIsAskedForARangeOfDays() async throws {
        let seen = RequestLog()
        let api = APIClient(baseURL: base, session: MockServer.session { request in
            seen.add(request)
            return json("[]")
        })
        let events = try await CalendarService(client: api).events(from: LocalDate(iso: "2026-11-01")!, to: LocalDate(iso: "2026-11-30")!)
        #expect(events.isEmpty)
        #expect(seen.all.first?.url?.absoluteString == "https://sportarenaglobal.ru/api/calendar?date_from=2026-11-01&date_to=2026-11-30")
    }

    @Test func aTooLongRangeComesBackAsTheServersMessage() async {
        let api = APIClient(baseURL: base, session: MockServer.session { _ in
            json(#"{"error":{"code":"range_too_large","message":"date range must not exceed 120 days"}}"#, status: 400)
        })
        do {
            _ = try await CalendarService(client: api).events(from: LocalDate(iso: "2026-01-01")!, to: LocalDate(iso: "2026-12-31")!)
            Issue.record("expected an error")
        } catch let error as APIError {
            #expect(error.code == "range_too_large" && error.status == 400)
        } catch { Issue.record("wrong error \(error)") }
    }

    @Test func aTrainingIsFetchedById() async throws {
        let seen = RequestLog()
        let id = UUID(uuidString: "11111111-2222-4333-8444-555555555555")!
        let api = APIClient(baseURL: base, session: MockServer.session { request in seen.add(request); return json(trainingJSON) })
        let training = try await CalendarService(client: api).training(id: id)
        #expect(seen.all.first?.url?.path == "/api/trainings/11111111-2222-4333-8444-555555555555" && training.id == id)
    }
}
