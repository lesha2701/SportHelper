import Foundation
import Testing
@testable import SportArenaKit

struct ExerciseChecklistTests {
    @Test func theNumberedListWithCircuitAndNotesIsRead() throws {
        let text = "1. Берпи — 30 сек\n2. Планка — 45 сек\n\nКругов: 3 · Отдых между подходами и кругами: 60 сек\n\nПометки: пить воду"
        let list = try #require(ExerciseChecklist.parse(text))
        #expect(list.items.map(\.text) == ["Берпи", "Планка"] && list.items.map(\.durationSeconds) == [30, 45])
        #expect(list.rounds == 3 && list.restSeconds == 60 && list.notes == "пить воду" && list.isCircuit)
    }

    @Test func aPlanOfRepsStaysWholeAndIsNotACircuit() throws {
        let list = try #require(ExerciseChecklist.parse("1. Приседания — 3 подх. x 15 повт.\n2. Планка — 3 подх. x 45 сек\n3. Бег — 3000 м x 900 сек"))
        #expect(list.items.map(\.text) == ["Приседания — 3 подх. x 15 повт.", "Планка — 3 подх. x 45 сек", "Бег — 3000 м x 900 сек"])
        #expect(list.items.allSatisfy { $0.durationSeconds == nil } && !list.isCircuit && list.notes == nil)
    }

    @Test(arguments: ["", "   ", "Побегать и поприседать", "1. Бег\nпросто текст", "1. Бег\n\n2. Планка", "1.Бег"])
    func textWrittenByHandIsNotAList(text: String) {
        #expect(ExerciseChecklist.parse(text) == nil)
    }

    @Test func aTrainingFormTextIsReadBackWhatEverTheStyle() throws {
        var workout = PersonalWorkout(style: .reps, rows: [
            WorkoutRow(exercise: "Присед", kind: .reps, kindChosen: true, reps: 12, sets: 4),
            WorkoutRow(exercise: "Бег", kind: .distance, kindChosen: true, distanceMeters: 3000, timeMinutes: 15),
        ], notes: "Без спешки")
        let reps = try #require(ExerciseChecklist.parse(workout.text))
        #expect(reps.items.count == 2 && reps.notes == "Без спешки" && !reps.isCircuit)
        workout.style = .circuit
        let circuit = try #require(ExerciseChecklist.parse(workout.text))
        #expect(circuit.rounds == 3 && circuit.restSeconds == 60)
    }

    @Test func aCircuitIsPlayedRoundByRoundWithRestBetweenButNotAtTheEnd() throws {
        let list = try #require(ExerciseChecklist.parse("1. Берпи — 20 сек\n2. Планка\n\nКругов: 2 · Отдых между подходами и кругами: 10 сек"))
        let steps = list.circuitSteps
        // 2 rounds x (2 exercises) with a rest after each, except after the very last one.
        #expect(steps.count == 7)
        #expect(steps.first == .exercise(text: "Берпи", seconds: 20, round: 1, rounds: 2, index: 0, total: 2))
        #expect(steps[1] == .rest(seconds: 10, round: 1, rounds: 2))
        #expect(steps[2] == .exercise(text: "Планка", seconds: 30, round: 1, rounds: 2, index: 1, total: 2), "an exercise without a time lasts 30 seconds")
        #expect(steps.last == .exercise(text: "Планка", seconds: 30, round: 2, rounds: 2, index: 1, total: 2))
        let total = steps.map(\.seconds).reduce(0, +)
        #expect(total == 130)
    }

    @Test func withoutRestThereAreOnlyExercises() throws {
        let list = try #require(ExerciseChecklist.parse("1. Берпи — 20 сек\n\nКругов: 3 · Отдых между подходами и кругами: 0 сек"))
        #expect(list.circuitSteps.count == 3 && ExerciseChecklist.parse("1. Бег")?.circuitSteps.isEmpty == true)
    }
}

struct ExerciseTargetTests {
    @Test func theUnitsOfAPlanAreRead() {
        let reps = ExerciseTarget.parse("Приседания — 3 подх. x 15 повт.")
        #expect(reps.name == "Приседания" && reps.kind == .reps && reps.sets == 3 && reps.reps == 15)
        let time = ExerciseTarget.parse("Планка — 3 подх. x 45 сек")
        #expect(time.kind == .time && time.sets == 3 && time.seconds == 45)
        let run = ExerciseTarget.parse("Бег — 3000 м x 900 сек")
        #expect(run.kind == .distance && run.meters == 3000 && run.seconds == 900 && run.sets == nil)
    }

    @Test func kilometersAndDecimalsAreRead() {
        #expect(ExerciseTarget.parse("Бег — 1,5 км").meters == 1500)
        #expect(ExerciseTarget.parse("Бег — 2.5 км").meters == 2500)
        #expect(ExerciseTarget.parse("Прыжок — 2,5 м").meters == 2.5)
    }

    @Test(arguments: ["Приседания", "Присед — как получится", "Присед — 3 подх. x много", "Присед — 3 подх. y 5 повт.", "Присед — "])
    func aLineWithoutAPlanIsJustAName(line: String) {
        let target = ExerciseTarget.parse(line)
        #expect(target.kind == nil && target.sets == nil && target.reps == nil && target.name == line.trimmingCharacters(in: .whitespaces))
    }

    @Test func onlySetsLeaveTheKindToTheName() {
        let target = ExerciseTarget.parse("Приседания — 4 подх.")
        #expect(target.sets == 4 && target.kind == nil)
    }
}

struct WorkoutExerciseTests {
    @Test func aRepsLineBecomesSetsToFillInStartingFromThePlan() {
        let exercise = WorkoutExercise(planLine: "Приседания — 3 подх. x 15 повт.")
        #expect(exercise.metric == .reps && exercise.targetSets == 3 && exercise.targetReps == 15)
        #expect(exercise.sets == Array(repeating: WorkoutSet(reps: 15), count: 3))
    }

    @Test func aTimedLineStartsEverySetAtItsTime() {
        let exercise = WorkoutExercise(planLine: "Планка — 2 подх. x 45 сек")
        #expect(exercise.metric == .time && exercise.targetSeconds == 45 && exercise.targetReps == nil)
        #expect(exercise.sets == [WorkoutSet(seconds: 45), WorkoutSet(seconds: 45)])
    }

    @Test func aDistanceLineKeepsTheDistanceAndTheTime() {
        let exercise = WorkoutExercise(planLine: "Бег — 3000 м x 900 сек")
        #expect(exercise.metric == .distance && exercise.targetMeters == 3000 && exercise.targetSeconds == 900)
        #expect(exercise.sets == [WorkoutSet(seconds: 900, meters: 3000)], "a run is one set unless the plan says otherwise")
    }

    @Test func aBareNameTakesTheStartOfItsKind() {
        #expect(WorkoutExercise(planLine: "Подтягивания").sets == Array(repeating: WorkoutSet(reps: 10), count: 3))
        #expect(WorkoutExercise(planLine: "Планка").sets == Array(repeating: WorkoutSet(seconds: 30), count: 3))
        #expect(WorkoutExercise(planLine: "Скакалка").sets.first == WorkoutSet(seconds: 60))
        #expect(WorkoutExercise(planLine: "Бег").sets == [WorkoutSet(meters: 1000)])
        #expect(WorkoutExercise(planLine: "Прыжок в длину").sets == Array(repeating: WorkoutSet(meters: 2), count: 3))
    }

    @Test func aPlanWithUnitsOverridesTheNameGuess() {
        // «Бег на месте» is timed by its name, but the line says metres: the line wins.
        let exercise = WorkoutExercise(planLine: "Бег на месте — 100 м")
        #expect(exercise.metric == .distance && exercise.sets == [WorkoutSet(meters: 100)])
    }

    @Test func valuesTheServerWouldRefuseAreNotPlanned() {
        let big = WorkoutExercise(planLine: "Отжимания — 500 подх. x 99999 повт.")
        #expect(big.targetSets == nil && big.targetReps == nil && big.sets.count == 3)
        let many = WorkoutExercise(planLine: "Отжимания — 80 подх. x 5 повт.")
        #expect(many.targetSets == 80 && many.sets.count == WorkoutExercise.setsLimit, "no more than 60 sets are recorded")
        #expect(WorkoutExercise(planLine: "Отжимания — 0 подх.").targetSets == nil)
        #expect(WorkoutExercise(planLine: String(repeating: "я", count: 300)).name.count == WorkoutExercise.nameLimit)
    }

    @Test func aSetCanBeAddedUpToTheLimitAndTheLastOneRemovedUntilItIsDone() {
        var exercise = WorkoutExercise(planLine: "Присед — 2 подх. x 10 повт.")
        exercise.sets[1].weightKg = 40
        exercise.addSet()
        #expect(exercise.sets.count == 3 && exercise.sets[2] == WorkoutSet(reps: 10, weightKg: 40), "a new set repeats the last one")
        exercise.sets[2].done = true
        #expect(!exercise.canRemoveLastSet)
        exercise.removeLastSet()
        #expect(exercise.sets.count == 3)
        exercise.sets[2].done = false
        exercise.removeLastSet()
        #expect(exercise.sets.count == 2)
        var one = WorkoutExercise(planLine: "Присед — 1 подх.")
        one.removeLastSet()
        #expect(one.sets.count == 1, "one set always remains")
        var full = WorkoutExercise(planLine: "Присед — 60 подх.")
        full.addSet()
        #expect(full.sets.count == 60)
    }

    @Test func aDistanceIsSteppedByItsSize() {
        #expect(WorkoutExercise(planLine: "Прыжок в длину").meterStep == 0.1)
        #expect(WorkoutExercise(planLine: "Спринт — 100 м").meterStep == 5)
        #expect(WorkoutExercise(planLine: "Бег — 3000 м").meterStep == 100)
        #expect(WorkoutExercise(planLine: "Бег").meterStep == 100)
    }
}

struct WorkoutTotalsTests {
    @Test func onlyDoneSetsCountAndEachKindCountsItsOwn() {
        var reps = WorkoutExercise(planLine: "Жим — 3 подх. x 10 повт.")
        reps.sets[0].weightKg = 20
        reps.sets[0].done = true
        reps.sets[1].weightKg = 22.5
        reps.sets[1].reps = 8
        reps.sets[1].done = true
        var plank = WorkoutExercise(planLine: "Планка — 2 подх. x 40 сек")
        plank.sets[0].done = true
        plank.sets[0].seconds = 45
        var run = WorkoutExercise(planLine: "Бег — 2500 м")
        run.sets[0].done = true
        let totals = WorkoutTotals([reps, plank, run])
        #expect(totals.setsDone == 4 && totals.setsTotal == 6 && totals.reps == 18)
        #expect(totals.volumeKg == 380 && totals.seconds == 45 && totals.meters == 2500 && totals.exercisesDone == 1)
    }

    @Test func aSetWithoutWeightAddsNoTonnageAndNothingDoneIsZero() {
        var reps = WorkoutExercise(planLine: "Присед — 2 подх. x 10 повт.")
        reps.sets[0].done = true
        #expect(WorkoutTotals([reps]).volumeKg == 0 && WorkoutTotals([reps]).reps == 10)
        #expect(WorkoutTotals([]).setsTotal == 0 && WorkoutTotals([]).volumeKg == 0)
        #expect(WorkoutTotals([WorkoutExercise(planLine: "Присед")]).setsDone == 0)
    }
}

struct WorkoutFormatTests {
    @Test(arguments: [(0, "0:00"), (5, "0:05"), (83, "1:23"), (600, "10:00"), (3725, "1:02:05"), (-4, "0:00")])
    func aClock(seconds: Int, text: String) { #expect(WorkoutFormat.clock(seconds) == text) }

    @Test(arguments: [("12:30", 750), ("750", 750), (" 1:02:05 ", 3725), ("0:45", 45)] as [(String, Int?)])
    func aTypedTimeIsRead(text: String, seconds: Int?) { #expect(WorkoutFormat.parseClock(text) == seconds) }

    @Test(arguments: ["", "  ", "abc", "1:x", "1:2:3:4", "-5", "1,5", ":30"])
    func anythingElseIsNotATime(text: String) { #expect(WorkoutFormat.parseClock(text) == nil) }

    @Test(arguments: [(20.0, "20 кг"), (12.5, "12,5 кг"), (0.5, "0,5 кг"), (100.0, "100 кг")])
    func kilograms(kg: Double, text: String) { #expect(WorkoutFormat.kilograms(kg) == text) }

    @Test(arguments: [(1500.0, "1,5 км"), (800.0, "800 м"), (2.5, "2,5 м"), (1000.0, "1 км"), (3000.0, "3 км"), (42195.0, "42,2 км")])
    func meters(value: Double, text: String) { #expect(WorkoutFormat.meters(value) == text) }

    @Test(arguments: [(30, "30 с"), (60, "1 мин"), (90, "1:30"), (120, "2 мин")])
    func theRestChoices(seconds: Int, text: String) { #expect(WorkoutFormat.restTitle(seconds) == text) }

    @Test func thePlanAndTheResultsAreSaidInOneLine() {
        #expect(WorkoutFormat.plan(WorkoutExercise(planLine: "Присед — 3 подх. x 15 повт.")) == "3 подх. × 15 повт.")
        #expect(WorkoutFormat.plan(WorkoutExercise(planLine: "Планка — 3 подх. x 45 сек")) == "3 подх. × 0:45")
        #expect(WorkoutFormat.plan(WorkoutExercise(planLine: "Бег — 3000 м x 900 сек")) == "3 км за 15:00")
        #expect(WorkoutFormat.plan(WorkoutExercise(planLine: "Бег")) == "")
        var reps = WorkoutExercise(planLine: "Жим — 3 подх. x 10 повт.")
        reps.sets[0] = WorkoutSet(reps: 15, weightKg: 20, done: true)
        reps.sets[1] = WorkoutSet(reps: 14, done: true)
        #expect(WorkoutFormat.results(reps) == "15 × 20 кг, 14")
        var run = WorkoutExercise(planLine: "Бег — 1500 м")
        run.sets[0] = WorkoutSet(seconds: 750, meters: 1500, done: true)
        #expect(WorkoutFormat.results(run) == "1,5 км за 12:30")
        var plank = WorkoutExercise(planLine: "Планка — 2 подх. x 45 сек")
        plank.sets[0].done = true
        #expect(WorkoutFormat.results(plank) == "0:45" && WorkoutFormat.results(WorkoutExercise(planLine: "Планка")).isEmpty)
    }

    @Test func aLineOfThePlanIsShownWithWordsInsteadOfUnits() {
        #expect(WorkoutFormat.label(planLine: "Бег — 3000 м x 900 сек") == "Бег — 3 км за 15:00")
        #expect(WorkoutFormat.label(planLine: "Планка — 3 подх. x 45 сек") == "Планка — 3 подх. × 0:45")
        #expect(WorkoutFormat.label(planLine: "Подтягивания") == "Подтягивания")
        #expect(WorkoutFormat.label(planLine: "Присед — 4 подх.") == "Присед — 4 подх.", "a line with only sets is kept as it is")
    }

    @Test func theSummaryNamesOnlyWhatHappened() {
        var reps = WorkoutExercise(planLine: "Жим — 2 подх. x 10 повт.")
        reps.sets[0] = WorkoutSet(reps: 10, weightKg: 20, done: true)
        let text = WorkoutFormat.summary(WorkoutTotals([reps]), duration: 1865)
        #expect(text == "1 из 2 подходов · 10 повторений · 200 кг тоннаж · 31:05")
        #expect(WorkoutFormat.summary(WorkoutTotals([reps]), duration: nil) == "1 из 2 подходов · 10 повторений · 200 кг тоннаж")
    }
}
