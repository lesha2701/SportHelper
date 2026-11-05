import Foundation

// A personal training can be done step by step in the app: every exercise of its description becomes a list of sets to fill in
// (repetitions with a weight, time, or distance), and the result is saved with the training (`PUT /api/trainings/{id}/workout`).
// The rules (how a line of the description is read, the starting values, the totals) are the site's, so both show the same.

// MARK: - Sets and exercises

/// One set of an exercise: repetitions with a weight, or a time, or a distance (with its time), and whether it is done.
public struct WorkoutSet: Codable, Equatable, Hashable, Sendable {
    public static let repsLimit = 10_000
    public static let weightLimit = 2000.0
    public static let secondsLimit = 86_400
    public static let metersLimit = 1_000_000.0

    public var reps: Int
    public var weightKg: Double?
    /// A timed exercise: how long the set lasted. A distance exercise: how long it took.
    public var seconds: Int?
    public var meters: Double?
    public var done: Bool

    public init(reps: Int = 0, weightKg: Double? = nil, seconds: Int? = nil, meters: Double? = nil, done: Bool = false) {
        self.reps = reps
        self.weightKg = weightKg
        self.seconds = seconds
        self.meters = meters
        self.done = done
    }

    /// A fresh set of the kind, starting from the plan's numbers (or the kind's usual ones).
    public static func fresh(_ kind: WorkoutKind, reps: Int? = nil, seconds: Int? = nil, meters: Double? = nil) -> WorkoutSet {
        let start = kind.profile.defaultValue
        switch kind {
        case .reps: return WorkoutSet(reps: reps ?? start)
        case .time: return WorkoutSet(seconds: seconds ?? start)
        case .distance: return WorkoutSet(seconds: seconds, meters: meters ?? Double(start))
        }
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        reps = try container.decodeIfPresent(Int.self, forKey: .reps) ?? 0
        weightKg = try container.decodeIfPresent(Double.self, forKey: .weightKg)
        seconds = try container.decodeIfPresent(Int.self, forKey: .seconds)
        meters = try container.decodeIfPresent(Double.self, forKey: .meters)
        done = try container.decodeIfPresent(Bool.self, forKey: .done) ?? false
    }
}

/// One exercise of a workout: the plan and the sets the person fills in.
public struct WorkoutExercise: Codable, Equatable, Hashable, Sendable {
    public static let nameLimit = 200
    public static let setsLimit = 60

    public var name: String
    public var metric: WorkoutKind
    public var targetSets: Int?
    public var targetReps: Int?
    public var targetSeconds: Int?
    public var targetMeters: Double?
    public var sets: [WorkoutSet]

    public init(
        name: String, metric: WorkoutKind = .reps, targetSets: Int? = nil, targetReps: Int? = nil, targetSeconds: Int? = nil,
        targetMeters: Double? = nil, sets: [WorkoutSet] = []
    ) {
        self.name = name
        self.metric = metric
        self.targetSets = targetSets
        self.targetReps = targetReps
        self.targetSeconds = targetSeconds
        self.targetMeters = targetMeters
        self.sets = sets
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decode(String.self, forKey: .name)
        // A result saved before exercises had kinds counted repetitions.
        metric = (try? container.decodeIfPresent(WorkoutKind.self, forKey: .metric)) ?? .reps
        targetSets = try container.decodeIfPresent(Int.self, forKey: .targetSets)
        targetReps = try container.decodeIfPresent(Int.self, forKey: .targetReps)
        targetSeconds = try container.decodeIfPresent(Int.self, forKey: .targetSeconds)
        targetMeters = try container.decodeIfPresent(Double.self, forKey: .targetMeters)
        sets = try container.decodeIfPresent([WorkoutSet].self, forKey: .sets) ?? []
    }

    /// The exercise for a line of the plan, with the sets to fill in. A line that only names the exercise keeps the starting numbers
    /// of the kind the name suggests.
    public init(planLine: String) {
        let target = ExerciseTarget.parse(planLine)
        let guessed = WorkoutKind.guess(target.name)
        let kind = target.kind ?? guessed.kind
        let profile = kind == guessed.kind ? guessed : kind.profile
        // The server takes up to 100 planned sets and up to 60 recorded ones.
        let planned = target.sets.flatMap { (1...100).contains($0) ? $0 : nil }
        let count = min(planned ?? profile.defaultSets, Self.setsLimit)
        self.init(
            name: String(target.name.prefix(Self.nameLimit)),
            metric: kind,
            targetSets: planned,
            targetReps: kind == .reps ? target.reps.flatMap { (1...WorkoutSet.repsLimit).contains($0) ? $0 : nil } : nil,
            targetSeconds: kind == .reps ? nil : target.seconds.flatMap { (1...WorkoutSet.secondsLimit).contains($0) ? $0 : nil },
            targetMeters: kind == .distance ? target.meters.flatMap { $0 <= WorkoutSet.metersLimit ? $0 : nil } : nil,
            sets: []
        )
        let start = (reps: targetReps ?? profile.defaultValue, seconds: targetSeconds ?? (kind == .time ? profile.defaultValue : nil),
                     meters: targetMeters ?? Double(profile.defaultValue))
        sets = (0..<count).map { _ in WorkoutSet.fresh(kind, reps: start.reps, seconds: start.seconds, meters: start.meters) }
    }

    public var isDone: Bool { !sets.isEmpty && sets.allSatisfy(\.done) }

    /// One tap of + / − on a distance, by its size: a jump is counted in tenths of a meter, a run in hundreds.
    public var meterStep: Double {
        let reference = targetMeters ?? sets.first?.meters ?? 1000
        if reference < 20 { return 0.1 }
        if reference < 200 { return 5 }
        return 100
    }

    public var canAddSet: Bool { sets.count < Self.setsLimit }
    /// The last set can go while it is not done and another one remains.
    public var canRemoveLastSet: Bool { sets.count > 1 && sets.last?.done == false }

    public mutating func addSet() {
        guard canAddSet else { return }
        let last = sets.last
        var set = WorkoutSet.fresh(metric, reps: last?.reps ?? targetReps, seconds: last?.seconds ?? targetSeconds, meters: last?.meters ?? targetMeters)
        set.weightKg = last?.weightKg
        sets.append(set)
    }

    public mutating func removeLastSet() {
        if canRemoveLastSet { sets.removeLast() }
    }
}

// MARK: - Totals and words

public struct WorkoutTotals: Equatable, Sendable {
    public var setsDone = 0
    public var setsTotal = 0
    public var reps = 0
    /// The sum of repetitions × weight over the sets that have a weight, in kilograms.
    public var volumeKg = 0.0
    public var exercisesDone = 0
    /// Time under load in the exercises measured in time.
    public var seconds = 0
    public var meters = 0.0

    public init(_ exercises: [WorkoutExercise]) {
        for exercise in exercises {
            setsTotal += exercise.sets.count
            let done = exercise.sets.filter(\.done)
            setsDone += done.count
            if exercise.isDone { exercisesDone += 1 }
            for set in done {
                switch exercise.metric {
                case .time: seconds += set.seconds ?? 0
                case .distance: meters += set.meters ?? 0
                case .reps:
                    reps += set.reps
                    if let weight = set.weightKg, weight > 0 { volumeKg += Double(set.reps) * weight }
                }
            }
        }
        volumeKg = (volumeKg * 10).rounded() / 10
        meters = (meters * 10).rounded() / 10
    }
}

public enum WorkoutFormat {
    private static func number(_ value: Double) -> String {
        (value == value.rounded() ? String(Int(value)) : String(value)).replacingOccurrences(of: ".", with: ",")
    }

    /// 20 → "20 кг", 12.5 → "12,5 кг"
    public static func kilograms(_ kg: Double) -> String {
        "\(kg == kg.rounded() ? String(Int(kg)) : String(format: "%.1f", kg).replacingOccurrences(of: ".", with: ",")) кг"
    }

    /// 83 → "1:23", 3725 → "1:02:05"
    public static func clock(_ totalSeconds: Int) -> String {
        let total = max(0, totalSeconds)
        let hours = total / 3600, minutes = (total % 3600) / 60, seconds = total % 60
        return hours > 0 ? String(format: "%d:%02d:%02d", hours, minutes, seconds) : String(format: "%d:%02d", minutes, seconds)
    }

    /// "12:30" or "750" (seconds) → seconds; nil when it is not a time.
    public static func parseClock(_ text: String) -> Int? {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        let parts = value.components(separatedBy: ":")
        guard parts.count <= 3, parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy { $0.isASCII && $0.isNumber } }) else { return nil }
        return parts.reduce(0) { $0 * 60 + (Int($1) ?? 0) }
    }

    /// The rest between sets as a choice: 30 → "30 с", 60 → "1 мин", 90 → "1:30", 120 → "2 мин".
    public static func restTitle(_ seconds: Int) -> String {
        if seconds < 60 { return "\(seconds) с" }
        return seconds % 60 == 0 ? "\(seconds / 60) мин" : clock(seconds)
    }

    /// 1500 → "1,5 км", 800 → "800 м", 2.5 → "2,5 м"
    public static func meters(_ meters: Double) -> String {
        if meters >= 1000 { return "\(number((meters / 100).rounded() / 10)) км" }
        return "\(number((meters * 10).rounded() / 10)) м"
    }

    /// The plan of an exercise in one line: "3 подх. × 15 повт.", "3 подх. × 0:45", "3 км за 15:00".
    public static func plan(_ exercise: WorkoutExercise) -> String {
        let sets = exercise.targetSets.map { "\($0) подх." }
        let parts: [String?]
        switch exercise.metric {
        case .time:
            parts = [sets, exercise.targetSeconds.map(clock)]
        case .distance:
            let distance = exercise.targetMeters.flatMap { $0 > 0 ? meters($0) : nil }
            let time = exercise.targetSeconds.map { "за \(clock($0))" }
            let both = [distance, time].compactMap { $0 }.joined(separator: " ")
            parts = [sets, both.isEmpty ? nil : both]
        case .reps:
            parts = [sets, exercise.targetReps.map { "\($0) повт." }]
        }
        return parts.compactMap { $0 }.joined(separator: " × ")
    }

    /// The line of the plan as it is read on the screen: "Бег — 3 км за 15:00" instead of the raw units.
    public static func label(planLine: String) -> String {
        let target = ExerciseTarget.parse(planLine)
        guard let kind = target.kind else { return planLine }
        let exercise = WorkoutExercise(
            name: target.name, metric: kind, targetSets: target.sets, targetReps: target.reps, targetSeconds: target.seconds, targetMeters: target.meters
        )
        let text = plan(exercise)
        return text.isEmpty ? target.name : "\(target.name) — \(text)"
    }

    /// The done sets of one exercise in one line: "15 × 20 кг, 14 × 20 кг", "0:45, 0:40" or "1,5 км за 12:30".
    public static func results(_ exercise: WorkoutExercise) -> String {
        exercise.sets.filter(\.done).map { set -> String in
            switch exercise.metric {
            case .time: return clock(set.seconds ?? 0)
            case .distance: return meters(set.meters ?? 0) + ((set.seconds ?? 0) > 0 ? " за \(clock(set.seconds ?? 0))" : "")
            case .reps:
                if let weight = set.weightKg, weight > 0 { return "\(set.reps) × \(kilograms(weight))" }
                return String(set.reps)
            }
        }.joined(separator: ", ")
    }

    /// "5 подходов, 60 повторений, 400 кг тоннаж, 1:30 под нагрузкой, 2 км, 35:10": what a workout came to.
    public static func summary(_ totals: WorkoutTotals, duration: Int?) -> String {
        var parts = ["\(totals.setsDone) из \(totals.setsTotal) подходов"]
        if totals.reps > 0 { parts.append("\(totals.reps) повторений") }
        if totals.volumeKg > 0 { parts.append("\(number(totals.volumeKg)) кг тоннаж") }
        if totals.seconds > 0 { parts.append("\(clock(totals.seconds)) под нагрузкой") }
        if totals.meters > 0 { parts.append(meters(totals.meters)) }
        if let duration, duration > 0 { parts.append(clock(duration)) }
        return parts.joined(separator: " · ")
    }
}
