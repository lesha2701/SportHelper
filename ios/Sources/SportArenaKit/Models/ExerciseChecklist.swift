import Foundation

// The exercises of a personal training as the training form writes them into its description, and how they are read back.

private func captures(_ pattern: String, in text: String) -> [String]? {
    guard let regex = try? NSRegularExpression(pattern: pattern),
          let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
    return (1..<match.numberOfRanges).map { index in Range(match.range(at: index), in: text).map { String(text[$0]) } ?? "" }
}

/// One line of the exercise list.
public struct ChecklistItem: Equatable, Sendable {
    public let text: String
    /// The seconds written after the name ("Берпи — 30 сек"): the time of an exercise in a circuit.
    public let durationSeconds: Int?
}

/// The exercises of a personal training as the training form writes them into the description: a numbered list, then optionally
/// «Кругов: N · Отдых между подходами и кругами: R сек» (a circuit), then optionally «Пометки: …». A description written by hand in
/// another shape is not a list.
public struct ExerciseChecklist: Equatable, Sendable {
    public let items: [ChecklistItem]
    /// Set for a circuit (the exercises are done one after another, round after round).
    public let rounds: Int?
    public let restSeconds: Int?
    public let notes: String?

    public var isCircuit: Bool { rounds != nil }

    public static func parse(_ description: String) -> ExerciseChecklist? {
        let blocks = description.components(separatedBy: "\n\n").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        var notes: String?
        var rounds: Int?
        var rest: Int?
        var remaining: [String] = []
        for block in blocks {
            if block.hasPrefix("Пометки: ") {
                notes = String(block.dropFirst("Пометки: ".count)).trimmingCharacters(in: .whitespacesAndNewlines)
            } else if let found = captures("^Кругов: ([0-9]+) · Отдых.*?: ([0-9]+) сек$", in: block), found.count == 2 {
                rounds = Int(found[0])
                rest = Int(found[1])
            } else {
                remaining.append(block)
            }
        }
        guard remaining.count == 1, let body = remaining.first else { return nil }
        let lines = body.components(separatedBy: "\n").filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        guard !lines.isEmpty, lines.allSatisfy({ $0.range(of: "^[0-9]+\\.\\s+\\S", options: .regularExpression) != nil }) else { return nil }
        let items = lines.map { line -> ChecklistItem in
            let text = line.replacingOccurrences(of: "^[0-9]+\\.\\s+", with: "", options: .regularExpression)
            if let found = captures("^(.*) — ([0-9]+) сек$", in: text), found.count == 2 {
                return ChecklistItem(text: found[0], durationSeconds: Int(found[1]))
            }
            return ChecklistItem(text: text, durationSeconds: nil)
        }
        return ExerciseChecklist(items: items, rounds: rounds, restSeconds: rest, notes: notes)
    }
}

/// What a line of the plan says: «Приседания — 3 подх. x 15 повт.», «Планка — 3 подх. x 45 сек», «Бег — 3000 м x 900 сек».
public struct ExerciseTarget: Equatable, Sendable {
    public var name: String
    /// What the line says the exercise is measured in; nil when the line only names the exercise (or only its sets).
    public var kind: WorkoutKind?
    public var sets: Int?
    public var reps: Int?
    public var seconds: Int?
    public var meters: Double?

    private init(name: String) { self.name = name }

    /// A line that is only a name, or whose tail is not understood, is just a name.
    public static func parse(_ text: String) -> ExerciseTarget {
        let whole = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let separator = text.range(of: " — ") else { return ExerciseTarget(name: whole) }
        var target = ExerciseTarget(name: String(text[..<separator.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines))
        let tail = String(text[separator.upperBound...])
        guard !tail.isEmpty else { return ExerciseTarget(name: whole) }
        let tokens = tail.replacingOccurrences(of: "\\s+x\\s+", with: "\u{1}", options: .regularExpression).components(separatedBy: "\u{1}")
        for token in tokens where !target.read(token.trimmingCharacters(in: .whitespacesAndNewlines)) { return ExerciseTarget(name: whole) }
        if target.meters != nil {
            target.kind = .distance
        } else if target.seconds != nil {
            target.kind = .time
        } else if target.reps != nil {
            target.kind = .reps
        }
        return target
    }

    /// One piece of the plan: "3 подх.", "15 повт.", "45 сек", "3000 м", "1,5 км".
    private mutating func read(_ token: String) -> Bool {
        if let found = captures("^([0-9]+) подх\\.$", in: token) {
            sets = Int(found[0])
        } else if let found = captures("^([0-9]+) повт\\.$", in: token) {
            reps = Int(found[0])
        } else if let found = captures("^([0-9]+) сек$", in: token) {
            seconds = Int(found[0])
        } else if let found = captures("^([0-9]+(?:[.,][0-9]+)?) (м|км)$", in: token), found.count == 2,
                let value = Double(found[0].replacingOccurrences(of: ",", with: ".")) {
            meters = (value * (found[1] == "км" ? 1000 : 1) * 10).rounded() / 10
        } else { return false }
        return true
    }
}

/// A circuit is done on the clock: each exercise for its time, a rest after it, round after round.
public enum CircuitStep: Equatable, Sendable {
    case exercise(text: String, seconds: Int, round: Int, rounds: Int, index: Int, total: Int)
    case rest(seconds: Int, round: Int, rounds: Int)

    public var seconds: Int {
        switch self {
        case .exercise(_, let seconds, _, _, _, _), .rest(let seconds, _, _): seconds
        }
    }
}

public extension ExerciseChecklist {
    static let defaultExerciseSeconds = 30

    /// The steps of a circuit; empty for a list that is not a circuit.
    var circuitSteps: [CircuitStep] {
        guard let rounds, rounds > 0 else { return [] }
        let rest = restSeconds ?? 0
        var steps: [CircuitStep] = []
        for round in 1...rounds {
            for (index, item) in items.enumerated() {
                let seconds = item.durationSeconds ?? Self.defaultExerciseSeconds
                steps.append(.exercise(text: item.text, seconds: seconds, round: round, rounds: rounds, index: index, total: items.count))
                let isLast = round == rounds && index == items.count - 1
                if rest > 0 && !isLast { steps.append(.rest(seconds: rest, round: round, rounds: rounds)) }
            }
        }
        return steps
    }
}
