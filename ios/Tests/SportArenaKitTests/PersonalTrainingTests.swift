import Foundation
import Testing
@testable import SportArenaKit

private let host = URL(string: "https://sportarenaglobal.ru")!
private let day = LocalDate(year: 2026, month: 11, day: 7)

private func row(_ name: String, _ kind: WorkoutKind, reps: Int? = nil, sets: Int? = nil, seconds: Int? = nil, meters: Int? = nil, minutes: Double? = nil) -> WorkoutRow {
    WorkoutRow(exercise: name, kind: kind, kindChosen: true, reps: reps, sets: sets, durationSeconds: seconds, distanceMeters: meters, timeMinutes: minutes)
}

struct WorkoutKindTests {
    @Test(arguments: [
        ("Бег", WorkoutKind.distance), ("Лёгкий бег 5 км", .distance), ("Плавание", .distance), ("Прыжок в длину", .distance), ("Метание мяча", .distance),
        ("Планка", .time), ("Скакалка", .time), ("Бег на месте", .time), ("Растяжка", .time), ("Вис на турнике", .time), ("Йога", .time),
        ("Приседания", .reps), ("Отжимания", .reps), ("", .reps), ("Подтягивания", .reps),
    ])
    func theKindFollowsTheNameLikeOnTheSite(name: String, kind: WorkoutKind) {
        #expect(WorkoutKind.detect(name) == kind)
    }

    @Test func aWordThatOnlyContainsARuleIsNotMatchedInTheMiddle() {
        #expect(WorkoutKind.detect("Забег") == .reps, "«бег» counts at the start of a word only")
        #expect(WorkoutKind.detect("Спринт 100 м") == .distance)
    }
}

struct WorkoutRowTests {
    @Test func theKindFollowsTheNameUntilItIsPickedByHand() {
        var line = WorkoutRow()
        line.rename("Бег")
        #expect(line.kind == .distance)
        line.rename("Планка")
        #expect(line.kind == .time)
        line.choose(.reps)
        line.rename("Бег")
        #expect(line.kind == .reps, "a kind chosen by hand is kept")
    }

    @Test func aRepsLineIsWrittenWithItsUnits() {
        #expect(row("Приседания", .reps, reps: 15, sets: 3).plan == "Приседания — 3 подх. x 15 повт.")
        #expect(row("Приседания", .reps, reps: 15).plan == "Приседания — 15 повт.")
        #expect(row("Приседания", .reps, sets: 4).plan == "Приседания — 4 подх.")
        #expect(row("Отжимания", .reps).plan == "Отжимания", "only a name when nothing is planned")
        #expect(row("Отжимания", .reps, reps: 0, sets: 0).plan == "Отжимания", "zero is nothing")
    }

    @Test func aTimedLineAlwaysHasSetsAndSeconds() {
        #expect(row("Планка", .time, sets: 3, seconds: 45).plan == "Планка — 3 подх. x 45 сек")
        #expect(row("Планка", .time).plan == "Планка — 1 подх. x 30 сек")
    }

    @Test func aDistanceLineHasMetersAndAnOptionalTime() {
        #expect(row("Бег", .distance, meters: 3000, minutes: 15).plan == "Бег — 3000 м x 900 сек")
        #expect(row("Бег", .distance).plan == "Бег — 1000 м")
        #expect(row("Спринт", .distance, sets: 5, meters: 100).plan == "Спринт — 5 подх. x 100 м")
        #expect(row("Бег", .distance, sets: 1, meters: 400).plan == "Бег — 400 м", "one set is not written")
        #expect(row("Бег", .distance, meters: 1000, minutes: 7.5).plan == "Бег — 1000 м x 450 сек")
    }
}

struct PersonalWorkoutTests {
    @Test func aRepsTrainingIsANumberedList() {
        let workout = PersonalWorkout(style: .reps, rows: [
            row("Приседания", .reps, reps: 15, sets: 3), row("", .reps), row("Планка", .time, sets: 3, seconds: 45), row("Бег", .distance, meters: 3000, minutes: 15),
        ])
        #expect(workout.text == "1. Приседания — 3 подх. x 15 повт.\n2. Планка — 3 подх. x 45 сек\n3. Бег — 3000 м x 900 сек", "an empty line is skipped, the numbering goes on")
    }

    @Test func aCircuitHasSecondsRoundsAndRest() {
        let workout = PersonalWorkout(style: .circuit, rows: [row("Берпи", .time, seconds: 40), row("Скакалка", .time)], notes: "  Без перерыва  ", circuitRounds: 4, circuitRestSeconds: 30)
        #expect(workout.text == "1. Берпи — 40 сек\n2. Скакалка\n\nКругов: 4 · Отдых между подходами и кругами: 30 сек\n\nПометки: Без перерыва")
    }

    @Test func notesStandAloneWhenThereAreNoExercises() {
        #expect(PersonalWorkout(style: .reps, notes: "Лёгкая пробежка").text == "Пометки: Лёгкая пробежка")
        #expect(PersonalWorkout().text.isEmpty && !PersonalWorkout().hasExercises)
    }

    @Test func aCircuitWithoutRoundsAndRestSaysNothingAboutThem() {
        let workout = PersonalWorkout(style: .circuit, rows: [row("Берпи", .time, seconds: 40)], circuitRounds: 0, circuitRestSeconds: 0)
        #expect(workout.text == "1. Берпи — 40 сек")
    }

    @Test func thereIsAlwaysALineToTypeIn() {
        var workout = PersonalWorkout(rows: [])
        #expect(workout.rows.count == 1)
        let only = workout.rows[0].id
        workout.removeRow(only)
        #expect(workout.rows.count == 1, "the last line stays")
        workout.addRow()
        workout.removeRow(only)
        #expect(workout.rows.count == 1 && workout.rows[0].id != only)
    }

    @Test func theLimitsAreChecked() {
        #expect(PersonalWorkout().problem == nil)
        #expect(PersonalWorkout(rows: [WorkoutRow(exercise: String(repeating: "я", count: 151))]).problem != nil)
        #expect(PersonalWorkout(notes: String(repeating: "я", count: 1001)).problem != nil)
        #expect(PersonalWorkout(style: .circuit, circuitRounds: 21).problem != nil && PersonalWorkout(style: .circuit, circuitRounds: 0).problem != nil)
        #expect(PersonalWorkout(style: .circuit, circuitRestSeconds: 601).problem != nil)
        #expect(PersonalWorkout(style: .reps, circuitRounds: 99).problem == nil, "rounds matter in a circuit only")
        let many = (0..<80).map { row("Упражнение номер \($0)", .reps, reps: 10, sets: 3) }
        #expect(PersonalWorkout(rows: many).problem?.contains("слишком длинное") == true, "the description is limited to 2000 characters")
    }
}

struct PersonalDraftTests {
    private func decode(_ json: String) throws -> PersonalTrainingDraft {
        try APIClient.decoder.decode(PersonalTrainingDraft.self, from: Data(json.utf8))
    }

    @Test func aRepsDraftBecomesRowsWithTheirKinds() throws {
        let draft = try decode("""
        {"style":"reps","exercises":[
         {"exercise":"Приседания","type":"reps","reps":12,"sets":3,"duration_seconds":null,"distance_meters":null},
         {"exercise":"Планка","type":"time","reps":null,"sets":3,"duration_seconds":40,"distance_meters":null},
         {"exercise":"Бег","type":"distance","reps":null,"sets":1,"duration_seconds":900,"distance_meters":3000}],
        "notes":"Разминка 5 минут","duration_minutes":45}
        """)
        let workout = draft.workout
        #expect(workout.style == .reps && workout.notes == "Разминка 5 минут" && draft.durationMinutes == 45)
        #expect(workout.rows.map(\.kind) == [.reps, .time, .distance])
        #expect(workout.rows[2].timeMinutes == 15 && workout.rows[2].durationSeconds == nil, "a run's time is kept in minutes")
        #expect(workout.text.hasPrefix("1. Приседания — 3 подх. x 12 повт.\n2. Планка — 3 подх. x 40 сек\n3. Бег — 3000 м x 900 сек"))
    }

    @Test func aCircuitDraftIsJustTimedExercises() throws {
        let workout = try decode(#"{"style":"circuit","exercises":[{"exercise":"Берпи","type":"reps","reps":10,"duration_seconds":30}],"notes":null,"duration_minutes":null}"#).workout
        #expect(workout.style == .circuit && workout.rows.map(\.kind) == [.time] && workout.rows[0].durationSeconds == 30 && workout.notes.isEmpty)
        #expect(workout.rows[0].kindChosen == false)
    }

    @Test func anUnknownKindOrStyleFallsBackToRepetitions() throws {
        let draft = try decode(#"{"style":"zzz","exercises":[{"exercise":"Х","type":"zzz"}],"notes":null,"duration_minutes":null}"#)
        #expect(draft.style == .reps && draft.exercises[0].kind == .reps)
    }

    @Test func anEmptyDraftStillLeavesALineToType() throws {
        #expect(try decode(#"{"style":"reps","exercises":[],"notes":null,"duration_minutes":null}"#).workout.rows.count == 1)
    }
}

struct PersonalTrainingServiceTests {
    private func make(_ handler: @escaping MockServer.Handler) -> (TrainingsService, APIClient) {
        let api = APIClient(baseURL: host, session: MockServer.session(handler))
        return (TrainingsService(client: api), api)
    }

    private let created = """
    [{"id":"11111111-2222-4333-8444-555555555555","team_id":null,"created_by":"22222222-2222-4333-8444-555555555555","type":"personal","plan_id":null,
    "training_date":"2026-11-07","start_time":"18:00:00","duration_minutes":60,"location":null,"description":"Пометки: ок","status":"scheduled",
    "reminder_minutes_before":60,"recurrence_group_id":null,"responsible_user_id":null,"created_at":"2026-11-05T10:00:00Z","updated_at":"2026-11-05T10:00:00Z"}]
    """

    @Test func aPersonalTrainingIsPostedToItsOwnPathWithoutATeamOrAPlan() async throws {
        let seen = RequestLog()
        let (service, api) = make { request in seen.add(request); return json(created) }
        await api.setCSRFToken("csrf-p")
        let input = try #require(TrainingInput(date: day, time: LocalTime(hour: 18, minute: 0)!, durationMinutes: 60, description: "Пометки: ок", reminderMinutesBefore: 60))
        let trainings = try await service.schedulePersonal(input)
        let request = try #require(seen.all.first)
        #expect(trainings.count == 1 && trainings[0].type == "personal" && trainings[0].teamId == nil)
        #expect(request.httpMethod == "POST" && request.url?.path == "/api/trainings/personal" && request.value(forHTTPHeaderField: "X-CSRF-Token") == "csrf-p")
        let body = try #require(request.bodyJSON)
        #expect(body["training_date"] as? String == "2026-11-07" && body["start_time"] as? String == "18:00:00" && body["is_independent"] as? Bool == false)
        #expect(body["plan_id"] == nil && body["team_id"] == nil && body["reminder_minutes_before"] as? Int == 60)
    }

    @Test func aWeeklySeriesIsRequestedWithItsLastDay() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in seen.add(request); return json(created) }
        let input = try #require(TrainingInput(date: day, time: LocalTime(hour: 18, minute: 0)!, durationMinutes: 60, repeatWeeklyUntil: day.adding(days: 28)))
        _ = try await service.schedulePersonal(input)
        #expect(seen.all.first?.bodyJSON?["repeat_weekly_until"] as? String == "2026-12-05")
    }

    @Test func theSuggestionIsAskedWithTheWishAndAClampedDuration() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in
            seen.add(request)
            return json(#"{"style":"circuit","exercises":[],"notes":null,"duration_minutes":30}"#)
        }
        let draft = try await service.personalDraft(style: .circuit, goals: "  скорость  ", durationMinutes: 5)
        let request = try #require(seen.all.first)
        #expect(draft.style == .circuit && request.url?.path == "/api/ai/personal-training-draft" && request.httpMethod == "POST")
        #expect(request.bodyJSON?["style"] as? String == "circuit" && request.bodyJSON?["goals"] as? String == "скорость")
        #expect(request.bodyJSON?["duration_minutes"] as? Int == 10, "the suggestion needs at least ten minutes")
        #expect(request.timeoutInterval == StatsService.analysisTimeout)
    }

    @Test func noWishAndNoDurationAreSimplyLeftOut() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in seen.add(request); return json(#"{"style":"reps","exercises":[],"notes":null,"duration_minutes":null}"#) }
        _ = try await service.personalDraft(style: .reps, goals: "   ", durationMinutes: nil)
        let body = try #require(seen.all.first?.bodyJSON)
        #expect(body["goals"] == nil && body["duration_minutes"] == nil)
        #expect(PersonalDraftBody(style: .reps, goals: "", durationMinutes: 999).durationMinutes == 300)
    }

    @Test func aMissingPlayerProfileKeepsItsCode() async throws {
        let (service, _) = make { _ in json(#"{"error":{"code":"player_profile_required","message":"create a player profile","field":null,"retry_after":null}}"#, status: 409) }
        do {
            _ = try await service.personalDraft(style: .reps, goals: "", durationMinutes: nil)
            Issue.record("should have thrown")
        } catch let error as APIError {
            #expect(error.status == 409 && error.code == "player_profile_required")
        }
    }
}

struct WorkoutExerciseNameTests {
    @Test func theUntouchedFirstLineIsFine() {
        let workout = PersonalWorkout()
        #expect(workout.unnamedRowIDs.isEmpty)
        #expect(workout.problem == nil)
    }

    @Test func aSingleLineWithNumbersAndNoNameIsAProblem() {
        let nameless = row("", .reps, reps: 10)
        let workout = PersonalWorkout(rows: [nameless])
        #expect(workout.unnamedRowIDs == [nameless.id])
        #expect(workout.problem == "Укажите название каждого упражнения или уберите лишние строки.")
    }

    @Test func everyEmptyLineBesideOthersMustBeNamedOrRemoved() {
        let named = row("Приседания", .reps, reps: 15)
        let empty = row("", .reps)
        var workout = PersonalWorkout(rows: [named, empty])
        #expect(workout.unnamedRowIDs == [empty.id])
        #expect(workout.problem != nil)
        workout.removeRow(empty.id)
        #expect(workout.unnamedRowIDs.isEmpty)
        #expect(workout.problem == nil)
    }

    @Test func aNameOfOnlySpacesCountsAsNoName() {
        let spaces = row("   ", .reps)
        #expect(PersonalWorkout(rows: [row("Планка", .time, seconds: 45), spaces]).unnamedRowIDs == [spaces.id])
    }

    @Test func aFullyNamedListHasNoProblem() {
        #expect(PersonalWorkout(rows: [row("Приседания", .reps, reps: 15), row("Планка", .time, seconds: 45)]).problem == nil)
    }
}
