import Foundation
import Testing
@testable import SportArenaKit

private let host = URL(string: "https://sportarenaglobal.ru")!
private let trainingId = UUID(uuidString: "11111111-2222-4333-8444-555555555555")!

struct WorkoutSessionTests {
    private let start = Date(timeIntervalSince1970: 1_800_000_000)

    private func session(_ lines: [String] = ["Жим — 3 подх. x 10 повт.", "Планка — 2 подх. x 40 сек", "Бег — 1000 м"]) -> WorkoutSession {
        WorkoutSession(planLines: lines, startedAt: start)
    }

    @Test func aSessionStartsOnTheFirstExerciseWithAMinuteOfRest() {
        let workout = session()
        #expect(workout.exercises.count == 3 && workout.activeIndex == 0 && workout.restSeconds == 60 && !workout.canBeSaved)
        #expect(workout.totals.setsTotal == 3 + 2 + 1 && !workout.isOnLastExercise)
    }

    @Test func finishingASetStartsTheRestUnlessItWasTheLastOne() {
        var workout = session(["Присед — 2 подх. x 10 повт."])
        let first = workout.toggleDone(set: 0)
        let last = workout.toggleDone(set: 1)
        let undone = workout.toggleDone(set: 1)
        #expect(first, "a set is done and another is left: rest")
        #expect(!last, "the last set needs no rest")
        #expect(!undone, "undoing a set starts no rest")
        #expect(workout.totals.setsDone == 1 && workout.canBeSaved)
        workout.restSeconds = 0
        let withoutRest = workout.toggleDone(set: 1)
        #expect(!withoutRest, "without rest set up there is no rest")
    }

    @Test func theWeightIsTypedOnceAndCarriesToTheNextSetsWithoutOne() {
        var workout = session(["Жим — 3 подх. x 10 повт."])
        workout.setWeight(20, set: 0)
        workout.setWeight(25, set: 2)
        workout.toggleDone(set: 0)
        #expect(workout.active.sets.map(\.weightKg) == [20, 20, 25], "a weight already typed stays")
        workout.toggleDone(set: 1)
        workout.toggleDone(set: 1)
        #expect(workout.active.sets[1].done == false)
    }

    @Test func theWeightDoesNotCarryOverInATimedExercise() {
        var workout = session(["Планка — 2 подх. x 40 сек"])
        workout.setWeight(10, set: 0)
        workout.toggleDone(set: 0)
        #expect(workout.active.sets[1].weightKg == nil)
    }

    @Test func theStopwatchRecordsTheTimeAndMarksTheSetDone() {
        var workout = session(["Планка — 2 подх. x 40 сек"])
        let rests = workout.finishTimed(set: 0, seconds: 47)
        #expect(rests)
        #expect(workout.active.sets[0] == WorkoutSet(seconds: 47, done: true))
        let restsAfterLast = workout.finishTimed(set: 1, seconds: 0)
        #expect(!restsAfterLast, "the last set needs no rest")
        #expect(workout.active.sets[1].seconds == 1)
    }

    @Test func numbersStayInsideWhatTheServerAccepts() {
        var workout = session(["Жим — 1 подх. x 10 повт.", "Бег — 1000 м"])
        workout.setReps(-3, set: 0)
        #expect(workout.active.sets[0].reps == 0)
        workout.setReps(99_999, set: 0)
        #expect(workout.active.sets[0].reps == 10_000)
        workout.setWeight(5000, set: 0)
        #expect(workout.active.sets[0].weightKg == 2000)
        workout.setWeight(nil, set: 0)
        #expect(workout.active.sets[0].weightKg == nil)
        workout.go(to: 1)
        workout.setMeters(2_000_000, set: 0)
        #expect(workout.active.sets[0].meters == 1_000_000)
        workout.setMeters(12.34, set: 0)
        #expect(workout.active.sets[0].meters == 12.3)
        workout.setSeconds(999_999, set: 0)
        #expect(workout.active.sets[0].seconds == 86_400)
        workout.setReps(5, set: 7)
        workout.setSeconds(5, set: -1)
        #expect(workout.active.sets.count == 1, "a set that does not exist is ignored")
    }

    @Test func plusAndMinusStepTheTimeAndTheDistance() {
        var workout = session(["Планка — 1 подх. x 40 сек", "Бег — 3000 м", "Спринт — 100 м"])
        workout.stepSeconds(1, set: 0)
        workout.stepSeconds(1, set: 0)
        #expect(workout.active.sets[0].seconds == 50)
        for _ in 0..<20 { workout.stepSeconds(-1, set: 0) }
        #expect(workout.active.sets[0].seconds == 0, "never below zero")
        workout.go(to: 1)
        workout.stepMeters(1, set: 0)
        #expect(workout.active.sets[0].meters == 3100)
        workout.go(to: 2)
        workout.stepMeters(-1, set: 0)
        #expect(workout.active.sets[0].meters == 95)
    }

    @Test func movingBetweenExercisesStaysInsideTheList() {
        var workout = session()
        workout.go(to: 5)
        #expect(workout.activeIndex == 0)
        workout.goToNext()
        workout.goToNext()
        #expect(workout.activeIndex == 2 && workout.isOnLastExercise)
        workout.goToNext()
        #expect(workout.activeIndex == 2)
        workout.go(to: -1)
        #expect(workout.activeIndex == 2)
    }

    @Test func aSessionIsKeptAndRestoredWhileTheTrainingIsTheSame() throws {
        var workout = session()
        workout.toggleDone(set: 0)
        workout.goToNext()
        workout.restSeconds = 90
        let data = try #require(workout.kept)
        let back = try #require(WorkoutSession.restored(data, planLineCount: 3))
        #expect(back == workout && back.startedAt == start && back.restSeconds == 90 && back.activeIndex == 1)
        #expect(WorkoutSession.restored(data, planLineCount: 4) == nil, "the training's exercises changed: start again")
        #expect(WorkoutSession.restored(Data("{}".utf8), planLineCount: 3) == nil)
    }

    @Test func aTrainingWithManyExercisesKeepsTheFirstSixty() {
        let lines = (1...70).map { "Упражнение \($0)" }
        let workout = WorkoutSession(planLines: lines, startedAt: start)
        #expect(workout.exercises.count == 60)
        let data = workout.kept!
        #expect(WorkoutSession.restored(data, planLineCount: 70) != nil)
    }

    @Test func theResultCarriesTheTimesAndEverySet() throws {
        var workout = session(["Жим — 2 подх. x 10 повт."])
        workout.toggleDone(set: 0)
        let body = workout.result(finishedAt: start.addingTimeInterval(1800))
        let json = try #require(try JSONSerialization.jsonObject(with: APIClient.encoder.encode(body)) as? [String: Any])
        #expect(json["started_at"] as? String == "2027-01-15T08:00:00Z" && json["finished_at"] as? String == "2027-01-15T08:30:00Z")
        let exercise = try #require((json["exercises"] as? [[String: Any]])?.first)
        #expect(exercise["name"] as? String == "Жим" && exercise["metric"] as? String == "reps")
        #expect(exercise["target_sets"] as? Int == 2 && exercise["target_reps"] as? Int == 10)
        let sets = try #require(exercise["sets"] as? [[String: Any]])
        #expect(sets.count == 2 && sets[0]["done"] as? Bool == true && sets[1]["done"] as? Bool == false && sets[0]["reps"] as? Int == 10)
        #expect(sets[0]["weight_kg"] == nil, "what is not set is left out")
    }
}

struct WorkoutServiceTests {
    private func make(_ handler: @escaping MockServer.Handler) -> (TrainingsService, APIClient) {
        let api = APIClient(baseURL: host, session: MockServer.session(handler))
        return (TrainingsService(client: api), api)
    }

    private let saved = """
    {"training_id":"11111111-2222-4333-8444-555555555555","exercises":[
     {"name":"Жим","metric":"reps","target_sets":2,"target_reps":10,"target_seconds":null,"target_meters":null,
      "sets":[{"reps":10,"weight_kg":20.0,"seconds":null,"meters":null,"done":true},{"reps":8,"weight_kg":null,"seconds":null,"meters":null,"done":false}]},
     {"name":"Бег","metric":"distance","target_sets":null,"target_reps":null,"target_seconds":900,"target_meters":3000.0,
      "sets":[{"reps":0,"weight_kg":null,"seconds":850,"meters":3000.0,"done":true}]}],
    "wellbeing":null,"note":null,"started_at":"2026-11-05T10:00:00Z","finished_at":"2026-11-05T10:45:30.500000Z","updated_at":"2026-11-05T10:46:00Z"}
    """

    @Test func theSavedResultIsReadWithItsSetsAndTimes() async throws {
        let seen = RequestLog()
        let (service, _) = make { request in seen.add(request); return json(saved) }
        let workout = try #require(try await service.workout(of: trainingId))
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "GET" && request.url?.path == "/api/trainings/11111111-2222-4333-8444-555555555555/workout")
        #expect(workout.exercises.map(\.name) == ["Жим", "Бег"] && workout.exercises[1].metric == .distance && workout.exercises[1].targetSeconds == 900)
        #expect(workout.exercises[0].sets[0] == WorkoutSet(reps: 10, weightKg: 20, done: true))
        #expect(workout.totals.setsDone == 2 && workout.totals.volumeKg == 200 && workout.totals.meters == 3000)
        #expect(workout.duration == 2731 || workout.duration == 2730, "45 minutes and a half")
    }

    @Test func noSavedResultIsNull() async throws {
        let (service, _) = make { _ in json("null") }
        #expect(try await service.workout(of: trainingId) == nil)
    }

    @Test func aResultWithoutKindsIsReadAsRepetitions() async throws {
        let (service, _) = make { _ in
            json(#"""
            {"training_id":"11111111-2222-4333-8444-555555555555","exercises":[{"name":"Жим","sets":[{"reps":5,"weight_kg":null,"done":true}]}],
             "wellbeing":3,"note":"ok","started_at":null,"finished_at":null,"updated_at":"2026-11-05T10:46:00Z"}
            """#)
        }
        let workout = try #require(try await service.workout(of: trainingId))
        #expect(workout.exercises[0].metric == .reps && workout.exercises[0].sets[0].reps == 5 && workout.wellbeing == 3 && workout.note == "ok")
        #expect(workout.duration == nil && workout.startedAt == nil)
    }

    @Test func theResultIsPutToTheWorkoutPathWithTheCsrfToken() async throws {
        let seen = RequestLog()
        let (service, api) = make { request in seen.add(request); return json(saved) }
        await api.setCSRFToken("csrf-w")
        var session = WorkoutSession(planLines: ["Жим — 2 подх. x 10 повт."], startedAt: Date(timeIntervalSince1970: 1_800_000_000))
        session.toggleDone(set: 0)
        let result = try await service.saveWorkout(of: trainingId, session.result(finishedAt: Date(timeIntervalSince1970: 1_800_000_600)))
        let request = try #require(seen.all.first)
        #expect(request.httpMethod == "PUT" && request.url?.path == "/api/trainings/11111111-2222-4333-8444-555555555555/workout")
        #expect(request.value(forHTTPHeaderField: "X-CSRF-Token") == "csrf-w" && request.bodyJSON?["exercises"] != nil)
        #expect(result.exercises.count == 2)
    }

    @Test func aRefusedSaveIsAnError() async {
        let (service, _) = make { _ in
            let message = "workout results can only be recorded for a personal training"
            return (400, ["Content-Type": "application/json"], Data(#"{"error":{"code":"invalid_workout","message":"\#(message)"}}"#.utf8))
        }
        let session = WorkoutSession(planLines: ["Жим"])
        await #expect(throws: APIError.self) { _ = try await service.saveWorkout(of: trainingId, session.result(finishedAt: Date())) }
    }
}
