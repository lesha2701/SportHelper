import Foundation

/// What one set of an exercise is measured in.
public enum WorkoutKind: String, CaseIterable, Identifiable, Sendable {
    case reps, time, distance

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .reps: "Повторения"
        case .time: "Время"
        case .distance: "Расстояние"
        }
    }

    /// Guesses from the name how an exercise is measured ("Бег" is a distance, "Планка" is time); anything unknown is repetitions.
    /// The same rules as the site's training form, so both suggest the same.
    public static func detect(_ name: String) -> WorkoutKind {
        let lower = name.lowercased()
        func matches(_ pattern: String) -> Bool { lower.range(of: pattern, options: .regularExpression) != nil }
        if matches("скакалк") { return .time }
        if matches("на месте|планк|растяжк|стойк|удержан|статик|(^|\\s)вис($|\\s)|йога|разминк|заминк|кардио|медитац|дыхани") { return .time }
        if matches("(^|\\s)(бег|пробеж|кросс|спринт|ходьб|плаван|заплыв|велосипед|велотрен|лыж|гребл|марафон)") { return .distance }
        if matches("прыж\\S* в длину|в длину|прыж\\S* в высоту|в высоту|метани|толкани") { return .distance }
        return .reps
    }
}

/// «На повторения» lists exercises with their plan; «Круговая» lists exercises done one after another for several rounds.
public enum WorkoutStyle: String, CaseIterable, Identifiable, Sendable {
    case reps, circuit

    public var id: String { rawValue }
    public var title: String { self == .reps ? "На повторения" : "Круговая" }
}

/// One exercise of a personal training as the form edits it.
public struct WorkoutRow: Equatable, Identifiable, Sendable {
    public static let nameLimit = 150

    public let id: UUID
    public private(set) var exercise: String
    public private(set) var kind: WorkoutKind
    /// While the kind was not picked by hand it follows the name.
    public private(set) var kindChosen: Bool
    public var reps: Int?
    public var sets: Int?
    public var durationSeconds: Int?
    public var distanceMeters: Int?
    /// The target time of a distance exercise ("15 min" is easier to plan a run with than "900 s").
    public var timeMinutes: Double?

    public init(
        id: UUID = UUID(), exercise: String = "", kind: WorkoutKind = .reps, kindChosen: Bool = false, reps: Int? = nil, sets: Int? = nil,
        durationSeconds: Int? = nil, distanceMeters: Int? = nil, timeMinutes: Double? = nil
    ) {
        self.id = id
        self.exercise = exercise
        self.kind = kind
        self.kindChosen = kindChosen
        self.reps = reps
        self.sets = sets
        self.durationSeconds = durationSeconds
        self.distanceMeters = distanceMeters
        self.timeMinutes = timeMinutes
    }

    public mutating func rename(_ name: String) {
        exercise = name
        if !kindChosen { kind = .detect(name) }
    }

    public mutating func choose(_ newKind: WorkoutKind) {
        kind = newKind
        kindChosen = true
    }

    public var name: String { exercise.trimmingCharacters(in: .whitespacesAndNewlines) }
    public var isNamed: Bool { !name.isEmpty }

    private static func positive(_ value: Int?) -> Int? { (value ?? 0) > 0 ? value : nil }

    /// "Приседания — 3 подх. x 15 повт.", "Планка — 3 подх. x 45 сек", "Бег — 3000 м x 900 сек": the plan with its units, as the site
    /// writes it (and reads it back in its workout screen).
    var plan: String {
        let sets = Self.positive(sets)
        switch kind {
        case .time:
            return "\(name) — \(sets ?? 1) подх. x \(Self.positive(durationSeconds) ?? 30) сек"
        case .distance:
            var parts: [String] = []
            if let sets, sets > 1 { parts.append("\(sets) подх.") }
            parts.append("\(Self.positive(distanceMeters) ?? 1000) м")
            if let timeMinutes, timeMinutes > 0 { parts.append("\(Int((timeMinutes * 60).rounded())) сек") }
            return "\(name) — \(parts.joined(separator: " x "))"
        case .reps:
            var parts: [String] = []
            if let sets { parts.append("\(sets) подх.") }
            if let reps = Self.positive(reps) { parts.append("\(reps) повт.") }
            return parts.isEmpty ? name : "\(name) — \(parts.joined(separator: " x "))"
        }
    }
}

/// A personal training's exercises: written into the training's description the way the site does, so the site reads it too.
public struct PersonalWorkout: Equatable, Sendable {
    public static let notesLimit = 1000
    public static let roundsRange = 1...20
    public static let restRange = 0...600

    public var style: WorkoutStyle
    public var rows: [WorkoutRow]
    public var notes: String
    public var circuitRounds: Int
    public var circuitRestSeconds: Int

    public init(
        style: WorkoutStyle = .reps, rows: [WorkoutRow] = [WorkoutRow()], notes: String = "", circuitRounds: Int = 3, circuitRestSeconds: Int = 60
    ) {
        self.style = style
        self.rows = rows.isEmpty ? [WorkoutRow()] : rows
        self.notes = notes
        self.circuitRounds = circuitRounds
        self.circuitRestSeconds = circuitRestSeconds
    }

    public var hasExercises: Bool { rows.contains(where: \.isNamed) }

    public mutating func addRow() { rows.append(WorkoutRow()) }

    /// The last row cannot be removed: the form always has a line to type in.
    public mutating func removeRow(_ id: UUID) {
        guard rows.count > 1 else { return }
        rows.removeAll { $0.id == id }
    }

    /// The text for the training's description; empty when there is nothing to say.
    public var text: String {
        let lines = rows.filter(\.isNamed).enumerated().map { index, row -> String in
            switch style {
            case .reps: "\(index + 1). \(row.plan)"
            case .circuit: "\(index + 1). \(row.name)" + ((row.durationSeconds ?? 0) > 0 ? " — \(row.durationSeconds ?? 0) сек" : "")
            }
        }
        var text = lines.joined(separator: "\n")
        if style == .circuit, circuitRounds > 0 || circuitRestSeconds > 0 {
            text += (text.isEmpty ? "" : "\n\n") + "Кругов: \(circuitRounds > 0 ? circuitRounds : 1) · Отдых между подходами и кругами: \(max(circuitRestSeconds, 0)) сек"
        }
        let note = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        if !note.isEmpty { text += (text.isEmpty ? "" : "\n\n") + "Пометки: \(note)" }
        return text
    }

    /// What is wrong with the exercises (Russian, for the form), or nil.
    public var problem: String? {
        if rows.contains(where: { $0.name.count > WorkoutRow.nameLimit }) { return "Название упражнения не длиннее \(WorkoutRow.nameLimit) знаков." }
        if notes.trimmingCharacters(in: .whitespacesAndNewlines).count > Self.notesLimit { return "Пометки не длиннее \(Self.notesLimit) знаков." }
        if style == .circuit {
            if !Self.roundsRange.contains(circuitRounds) { return "Кругов — от \(Self.roundsRange.lowerBound) до \(Self.roundsRange.upperBound)." }
            if !Self.restRange.contains(circuitRestSeconds) { return "Отдых — от 0 до \(Self.restRange.upperBound) секунд." }
        }
        if text.count > TrainingLimits.maxDescription { return "Описание тренировки слишком длинное: сократите упражнения или пометки." }
        return nil
    }
}

/// A training the assistant suggests (`POST /api/ai/personal-training-draft`).
public struct PersonalTrainingDraft: Decodable, Equatable, Sendable {
    public struct Exercise: Decodable, Equatable, Sendable {
        public let exercise: String
        public let kind: WorkoutKind
        public let reps: Int?
        public let sets: Int?
        public let durationSeconds: Int?
        public let distanceMeters: Int?

        private enum CodingKeys: String, CodingKey { case exercise, type, reps, sets, durationSeconds, distanceMeters }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            exercise = try c.decode(String.self, forKey: .exercise)
            kind = (try c.decodeIfPresent(String.self, forKey: .type)).flatMap(WorkoutKind.init(rawValue:)) ?? .reps
            reps = try c.decodeIfPresent(Int.self, forKey: .reps)
            sets = try c.decodeIfPresent(Int.self, forKey: .sets)
            durationSeconds = try c.decodeIfPresent(Int.self, forKey: .durationSeconds)
            distanceMeters = try c.decodeIfPresent(Int.self, forKey: .distanceMeters)
        }
    }

    public let style: WorkoutStyle
    public let exercises: [Exercise]
    public let notes: String?
    public let durationMinutes: Int?

    private enum CodingKeys: String, CodingKey { case style, exercises, notes, durationMinutes }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        style = (try c.decodeIfPresent(String.self, forKey: .style)).flatMap(WorkoutStyle.init(rawValue:)) ?? .reps
        exercises = try c.decodeIfPresent([Exercise].self, forKey: .exercises) ?? []
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
        durationMinutes = try c.decodeIfPresent(Int.self, forKey: .durationMinutes)
    }

    /// The form's rows for the suggestion. In a circular training an exercise is just timed.
    public var workout: PersonalWorkout {
        let rows = exercises.map { e -> WorkoutRow in
            if style == .circuit {
                return WorkoutRow(exercise: e.exercise, kind: .time, kindChosen: false, durationSeconds: e.durationSeconds)
            }
            let minutes = e.kind == .distance ? e.durationSeconds.map { (Double($0) / 60 * 10).rounded() / 10 } : nil
            return WorkoutRow(
                exercise: e.exercise, kind: e.kind, kindChosen: true, reps: e.reps, sets: e.sets,
                durationSeconds: e.kind == .distance ? nil : e.durationSeconds, distanceMeters: e.distanceMeters, timeMinutes: minutes
            )
        }
        return PersonalWorkout(style: style, rows: rows, notes: notes ?? "")
    }
}

/// The wish for a suggested training.
struct PersonalDraftBody: Encodable, Sendable {
    let style: String
    let goals: String?
    let durationMinutes: Int?

    init(style: WorkoutStyle, goals: String, durationMinutes: Int?) {
        self.style = style.rawValue
        let wish = goals.trimmingCharacters(in: .whitespacesAndNewlines)
        self.goals = wish.isEmpty ? nil : String(wish.prefix(1000))
        // The suggestion needs 10 to 300 minutes: a shorter or longer value the person typed is brought into the range.
        self.durationMinutes = durationMinutes.map { min(max($0, 10), 300) }
    }
}
