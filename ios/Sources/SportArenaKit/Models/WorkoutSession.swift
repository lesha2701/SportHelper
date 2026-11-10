import Foundation

/// A workout under way: the exercises with their sets, the exercise on the screen, the rest between sets. It is kept on the device
/// while it goes on (and so is `Codable`), so a closed app or a locked phone never loses it.
public struct WorkoutSession: Codable, Equatable, Sendable {
    public static let restOptions = [0, 30, 60, 90, 120]
    /// One tap of + / − on the time of a timed set.
    public static let timeStep = 5
    public static let exercisesLimit = 60

    public private(set) var exercises: [WorkoutExercise]
    public private(set) var activeIndex: Int
    public var restSeconds: Int
    public let startedAt: Date

    public init(planLines: [String], startedAt: Date = Date(), restSeconds: Int = 60) {
        exercises = planLines.prefix(Self.exercisesLimit).map { WorkoutExercise(planLine: $0) }
        activeIndex = 0
        self.restSeconds = restSeconds
        self.startedAt = startedAt
    }

    /// A session kept from an earlier run, if it still fits the training's exercises.
    public static func restored(_ data: Data, planLineCount: Int) -> WorkoutSession? {
        guard let session = try? JSONDecoder().decode(WorkoutSession.self, from: data),
              session.exercises.count == min(planLineCount, exercisesLimit), session.activeIndex < session.exercises.count else { return nil }
        return session
    }

    public var kept: Data? { try? JSONEncoder().encode(self) }

    public var totals: WorkoutTotals { WorkoutTotals(exercises) }
    public var active: WorkoutExercise { exercises[activeIndex] }
    public var isOnLastExercise: Bool { activeIndex == exercises.count - 1 }
    /// Only a workout with something done is worth saving.
    public var canBeSaved: Bool { totals.setsDone > 0 }

    public mutating func go(to index: Int) {
        if exercises.indices.contains(index) { activeIndex = index }
    }

    public mutating func goToNext() { go(to: activeIndex + 1) }

    private mutating func changeActive(_ change: (inout WorkoutExercise) -> Void) { change(&exercises[activeIndex]) }

    private mutating func changeSet(_ index: Int, _ change: (inout WorkoutSet) -> Void) {
        guard exercises[activeIndex].sets.indices.contains(index) else { return }
        change(&exercises[activeIndex].sets[index])
    }

    /// Marks a set done or not. Returns true when the rest should start now: a set was finished and others are still to do.
    @discardableResult
    public mutating func toggleDone(set index: Int) -> Bool {
        guard active.sets.indices.contains(index) else { return false }
        let becomesDone = !active.sets[index].done
        let weight = active.sets[index].weightKg
        let isReps = active.metric == .reps
        changeActive { exercise in
            exercise.sets[index].done = becomesDone
            // The weight carries over to the next sets that have none yet, so it is typed once.
            guard becomesDone, isReps, let weight else { return }
            for next in exercise.sets.indices where next > index && !exercise.sets[next].done && exercise.sets[next].weightKg == nil {
                exercise.sets[next].weightKg = weight
            }
        }
        return becomesDone && startsRest
    }

    /// The stopwatch stopped on a timed set: its time is recorded and it is done. Returns true when the rest should start.
    @discardableResult
    public mutating func finishTimed(set index: Int, seconds: Int) -> Bool {
        guard active.sets.indices.contains(index) else { return false }
        changeSet(index) {
            $0.seconds = min(max(1, seconds), WorkoutSet.secondsLimit)
            $0.done = true
        }
        return startsRest
    }

    private var startsRest: Bool {
        let totals = totals
        return restSeconds > 0 && totals.setsDone < totals.setsTotal
    }

    public mutating func setReps(_ reps: Int, set index: Int) { changeSet(index) { $0.reps = min(max(0, reps), WorkoutSet.repsLimit) } }
    public mutating func setWeight(_ kg: Double?, set index: Int) { changeSet(index) { $0.weightKg = kg.map { min(max(0, $0), WorkoutSet.weightLimit) } } }
    public mutating func setSeconds(_ seconds: Int?, set index: Int) {
        changeSet(index) { $0.seconds = seconds.map { min(max(0, $0), WorkoutSet.secondsLimit) } }
    }

    public mutating func setMeters(_ meters: Double?, set index: Int) {
        changeSet(index) { $0.meters = meters.map { (min(max(0, $0), WorkoutSet.metersLimit) * 10).rounded() / 10 } }
    }

    /// + / − on the time of a timed set.
    public mutating func stepSeconds(_ direction: Int, set index: Int) {
        guard active.sets.indices.contains(index) else { return }
        setSeconds((active.sets[index].seconds ?? 0) + direction * Self.timeStep, set: index)
    }

    /// + / − on the distance of a set.
    public mutating func stepMeters(_ direction: Int, set index: Int) {
        guard active.sets.indices.contains(index) else { return }
        setMeters((active.sets[index].meters ?? 0) + Double(direction) * active.meterStep, set: index)
    }

    public mutating func addSet() { changeActive { $0.addSet() } }
    public mutating func removeLastSet() { changeActive { $0.removeLastSet() } }

    /// What is sent to the server once the workout is over.
    public func result(finishedAt: Date) -> WorkoutBody { WorkoutBody(exercises: exercises, startedAt: startedAt, finishedAt: finishedAt) }
}

/// The results of a workout as the server takes them.
public struct WorkoutBody: Encodable, Equatable, Sendable {
    public let exercises: [WorkoutExercise]
    public let startedAt: Date
    public let finishedAt: Date
}

/// The results the server keeps for a personal training.
public struct TrainingWorkout: Decodable, Equatable, Sendable {
    public let exercises: [WorkoutExercise]
    public let wellbeing: Int?
    public let note: String?
    public let startedAt: Date?
    public let finishedAt: Date?

    public var totals: WorkoutTotals { WorkoutTotals(exercises) }

    /// How long the workout took, in seconds.
    public var duration: Int? {
        guard let startedAt, let finishedAt else { return nil }
        return Int(finishedAt.timeIntervalSince(startedAt).rounded())
    }
}
