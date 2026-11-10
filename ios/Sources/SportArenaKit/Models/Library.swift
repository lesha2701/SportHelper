import Foundation

public enum LibraryLimits {
    public static let maxSport = 50
    public static let maxName = 150
    public static let maxText = 2000
    public static let maxGoal = 500
    public static let maxEquipment = 500
    public static let maxWarnings = 1000
    public static let maxComment = 1000
    public static let maxNotes = 500
    public static let maxSets = 100
    public static let maxReps = 1000
    public static let maxSeconds = 36_000
    public static let maxPlanMinutes = 600
    public static let maxTemplateExercises = 30
}

public enum LibraryFormat {
    /// "90 с", "5 мин", "1 мин 30 с", "1 ч" — the way an exercise says how long it lasts.
    public static func duration(seconds: Int) -> String {
        if seconds < 60 { return "\(seconds) с" }
        let hours = seconds / 3600
        let minutes = seconds % 3600 / 60
        let rest = seconds % 60
        var parts: [String] = []
        if hours > 0 { parts.append("\(hours) ч") }
        if minutes > 0 { parts.append("\(minutes) мин") }
        if rest > 0 { parts.append("\(rest) с") }
        return parts.joined(separator: " ")
    }

    /// "3 × 10 · 45 с · отдых 1 мин" — what is prescribed, or nil when nothing is.
    public static func prescription(sets: Int?, reps: Int?, durationSeconds: Int?, restSeconds: Int?) -> String? {
        var parts: [String] = []
        switch (sets, reps) {
        case let (sets?, reps?): parts.append("\(sets) × \(reps)")
        case let (sets?, nil): parts.append("\(sets) подх.")
        case let (nil, reps?): parts.append("\(reps) повт.")
        default: break
        }
        if let durationSeconds { parts.append(duration(seconds: durationSeconds)) }
        if let restSeconds { parts.append("отдых \(duration(seconds: restSeconds))") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    fileprivate static func clean(_ text: String) -> String? {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    fileprivate static func tooLong(_ text: String, _ limit: Int) -> Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).count > limit
    }

    fileprivate static func outOfRange(_ value: Int?, _ limit: Int) -> Bool {
        guard let value else { return false }
        return !(0...limit).contains(value)
    }
}

// MARK: - Exercises

public struct Exercise: Decodable, Equatable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public let ownerId: UUID
    public let sport: String
    public let name: String
    public let description: String?
    public let goal: String?
    public let photoFileId: UUID?
    public let videoFileId: UUID?
    public let sets: Int?
    public let reps: Int?
    public let durationSeconds: Int?
    public let restSeconds: Int?
    public let equipment: String?
    public let difficultyRaw: String?
    public let technique: String?
    public let commonMistakes: String?
    public let warnings: String?
    public let coachComment: String?
    public let createdAt: Date
    public let updatedAt: Date
    /// The teams the exercise is open to.
    public let sharedTeamIds: [UUID]

    public var difficulty: TeamLevel? { difficultyRaw.flatMap(TeamLevel.init(rawValue:)) }
    public var prescription: String? { LibraryFormat.prescription(sets: sets, reps: reps, durationSeconds: durationSeconds, restSeconds: restSeconds) }

    private enum CodingKeys: String, CodingKey {
        case id, ownerId, sport, name, description, goal, photoFileId, videoFileId, sets, reps, durationSeconds, restSeconds, equipment
        case technique, commonMistakes, warnings, coachComment, createdAt, updatedAt, sharedTeamIds
        case difficultyRaw = "difficulty"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        ownerId = try container.decode(UUID.self, forKey: .ownerId)
        sport = try container.decode(String.self, forKey: .sport)
        name = try container.decode(String.self, forKey: .name)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        goal = try container.decodeIfPresent(String.self, forKey: .goal)
        photoFileId = try container.decodeIfPresent(UUID.self, forKey: .photoFileId)
        videoFileId = try container.decodeIfPresent(UUID.self, forKey: .videoFileId)
        sets = try container.decodeIfPresent(Int.self, forKey: .sets)
        reps = try container.decodeIfPresent(Int.self, forKey: .reps)
        durationSeconds = try container.decodeIfPresent(Int.self, forKey: .durationSeconds)
        restSeconds = try container.decodeIfPresent(Int.self, forKey: .restSeconds)
        equipment = try container.decodeIfPresent(String.self, forKey: .equipment)
        difficultyRaw = try container.decodeIfPresent(String.self, forKey: .difficultyRaw)
        technique = try container.decodeIfPresent(String.self, forKey: .technique)
        commonMistakes = try container.decodeIfPresent(String.self, forKey: .commonMistakes)
        warnings = try container.decodeIfPresent(String.self, forKey: .warnings)
        coachComment = try container.decodeIfPresent(String.self, forKey: .coachComment)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        updatedAt = try container.decode(Date.self, forKey: .updatedAt)
        sharedTeamIds = try container.decodeIfPresent([UUID].self, forKey: .sharedTeamIds) ?? []
    }
}

/// What the person fills in for an exercise. The texts are kept as typed; `problem` says why they cannot be sent, and the body trims them.
public struct ExerciseInput: Equatable, Sendable {
    public var sport = ""
    public var name = ""
    public var description = ""
    public var goal = ""
    public var sets: Int?
    public var reps: Int?
    public var durationSeconds: Int?
    public var restSeconds: Int?
    public var equipment = ""
    public var difficulty: TeamLevel?
    public var technique = ""
    public var commonMistakes = ""
    public var warnings = ""
    public var coachComment = ""

    public init() {}

    /// Why the values cannot be sent (Russian text for the form), or nil when they can. Nothing is said about a form still untouched.
    public var problem: String? {
        if LibraryFormat.clean(sport) == nil { return "Выберите вид спорта." }
        if LibraryFormat.tooLong(sport, LibraryLimits.maxSport) { return "Вид спорта не длиннее \(LibraryLimits.maxSport) символов." }
        if LibraryFormat.clean(name) == nil { return "Назовите упражнение." }
        if LibraryFormat.tooLong(name, LibraryLimits.maxName) { return "Название не длиннее \(LibraryLimits.maxName) символов." }
        let limits: [(String, Int, String)] = [
            (description, LibraryLimits.maxText, "Описание"), (goal, LibraryLimits.maxGoal, "Цель"),
            (equipment, LibraryLimits.maxEquipment, "Инвентарь"), (technique, LibraryLimits.maxText, "Техника"),
            (commonMistakes, LibraryLimits.maxText, "Частые ошибки"), (warnings, LibraryLimits.maxWarnings, "Предупреждения"),
            (coachComment, LibraryLimits.maxComment, "Комментарий"),
        ]
        for (text, limit, title) in limits where LibraryFormat.tooLong(text, limit) { return "\(title): не длиннее \(limit) символов." }
        if LibraryFormat.outOfRange(sets, LibraryLimits.maxSets) { return "Подходов — от 0 до \(LibraryLimits.maxSets)." }
        if LibraryFormat.outOfRange(reps, LibraryLimits.maxReps) { return "Повторов — от 0 до \(LibraryLimits.maxReps)." }
        if LibraryFormat.outOfRange(durationSeconds, LibraryLimits.maxSeconds) { return "Длительность — от 0 до \(LibraryLimits.maxSeconds) секунд." }
        if LibraryFormat.outOfRange(restSeconds, LibraryLimits.maxSeconds) { return "Отдых — от 0 до \(LibraryLimits.maxSeconds) секунд." }
        return nil
    }

    public var isValid: Bool { problem == nil }
}

public extension Exercise {
    /// The form's values for this exercise (to change it).
    var asInput: ExerciseInput {
        var input = ExerciseInput()
        input.sport = sport
        input.name = name
        input.description = description ?? ""
        input.goal = goal ?? ""
        input.sets = sets
        input.reps = reps
        input.durationSeconds = durationSeconds
        input.restSeconds = restSeconds
        input.equipment = equipment ?? ""
        input.difficulty = difficulty
        input.technique = technique ?? ""
        input.commonMistakes = commonMistakes ?? ""
        input.warnings = warnings ?? ""
        input.coachComment = coachComment ?? ""
        return input
    }
}

/// The body of "add / change an exercise": the server replaces everything, so cleared fields go as explicit nulls.
struct ExerciseBody: Encodable, Sendable {
    let input: ExerciseInput

    private enum CodingKeys: String, CodingKey {
        case sport, name, description, goal, sets, reps, durationSeconds, restSeconds, equipment, difficulty, technique, commonMistakes
        case warnings, coachComment
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(LibraryFormat.clean(input.sport), forKey: .sport)
        try c.encode(LibraryFormat.clean(input.name), forKey: .name)
        try c.encode(LibraryFormat.clean(input.description), forKey: .description)
        try c.encode(LibraryFormat.clean(input.goal), forKey: .goal)
        try c.encode(input.sets, forKey: .sets)
        try c.encode(input.reps, forKey: .reps)
        try c.encode(input.durationSeconds, forKey: .durationSeconds)
        try c.encode(input.restSeconds, forKey: .restSeconds)
        try c.encode(LibraryFormat.clean(input.equipment), forKey: .equipment)
        try c.encode(input.difficulty?.rawValue, forKey: .difficulty)
        try c.encode(LibraryFormat.clean(input.technique), forKey: .technique)
        try c.encode(LibraryFormat.clean(input.commonMistakes), forKey: .commonMistakes)
        try c.encode(LibraryFormat.clean(input.warnings), forKey: .warnings)
        try c.encode(LibraryFormat.clean(input.coachComment), forKey: .coachComment)
    }
}

// MARK: - Plans

public enum PlanSection: String, CaseIterable, Identifiable, Sendable {
    case warmup, main, game, cooldown
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .warmup: "Разминка"
        case .main: "Основная часть"
        case .game: "Игровая часть"
        case .cooldown: "Заминка"
        }
    }
}

/// An exercise inside a plan, with how it is done there.
public struct PlanExercise: Decodable, Equatable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public let planId: UUID
    public let exerciseId: UUID
    public let exerciseName: String?
    public let sectionRaw: String
    public let orderIndex: Int
    public let sets: Int?
    public let reps: Int?
    public let durationSeconds: Int?
    public let restSeconds: Int?
    public let notes: String?

    public var section: PlanSection? { PlanSection(rawValue: sectionRaw) }
    public var prescription: String? { LibraryFormat.prescription(sets: sets, reps: reps, durationSeconds: durationSeconds, restSeconds: restSeconds) }

    private enum CodingKeys: String, CodingKey {
        case id, planId, exerciseId, exerciseName, orderIndex, sets, reps, durationSeconds, restSeconds, notes
        case sectionRaw = "section"
    }
}

public struct Plan: Decodable, Equatable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public let ownerId: UUID
    public let sport: String
    public let name: String
    public let description: String?
    public let durationMinutes: Int?
    public let equipment: String?
    public let comment: String?
    public let createdAt: Date
    public let updatedAt: Date
    /// Only one plan brings them; the list of plans comes without.
    public let exercises: [PlanExercise]
    public let sharedTeamIds: [UUID]

    /// The exercises of one section, in the order of the plan.
    public func exercises(in section: PlanSection) -> [PlanExercise] {
        exercises.filter { $0.section == section }.sorted { ($0.orderIndex, $0.exerciseName ?? "") < ($1.orderIndex, $1.exerciseName ?? "") }
    }

    private enum CodingKeys: String, CodingKey {
        case id, ownerId, sport, name, description, durationMinutes, equipment, comment, createdAt, updatedAt, exercises, sharedTeamIds
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        ownerId = try container.decode(UUID.self, forKey: .ownerId)
        sport = try container.decode(String.self, forKey: .sport)
        name = try container.decode(String.self, forKey: .name)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        durationMinutes = try container.decodeIfPresent(Int.self, forKey: .durationMinutes)
        equipment = try container.decodeIfPresent(String.self, forKey: .equipment)
        comment = try container.decodeIfPresent(String.self, forKey: .comment)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        updatedAt = try container.decode(Date.self, forKey: .updatedAt)
        exercises = try container.decodeIfPresent([PlanExercise].self, forKey: .exercises) ?? []
        sharedTeamIds = try container.decodeIfPresent([UUID].self, forKey: .sharedTeamIds) ?? []
    }
}

public struct PlanInput: Equatable, Sendable {
    public var sport = ""
    public var name = ""
    public var description = ""
    public var durationMinutes: Int?
    public var equipment = ""
    public var comment = ""

    public init() {}

    public var problem: String? {
        if LibraryFormat.clean(sport) == nil { return "Выберите вид спорта." }
        if LibraryFormat.tooLong(sport, LibraryLimits.maxSport) { return "Вид спорта не длиннее \(LibraryLimits.maxSport) символов." }
        if LibraryFormat.clean(name) == nil { return "Назовите план." }
        if LibraryFormat.tooLong(name, LibraryLimits.maxName) { return "Название не длиннее \(LibraryLimits.maxName) символов." }
        if LibraryFormat.tooLong(description, LibraryLimits.maxText) { return "Описание не длиннее \(LibraryLimits.maxText) символов." }
        if LibraryFormat.tooLong(equipment, LibraryLimits.maxEquipment) { return "Инвентарь не длиннее \(LibraryLimits.maxEquipment) символов." }
        if LibraryFormat.tooLong(comment, LibraryLimits.maxComment) { return "Комментарий не длиннее \(LibraryLimits.maxComment) символов." }
        if LibraryFormat.outOfRange(durationMinutes, LibraryLimits.maxPlanMinutes) { return "Длительность — от 0 до \(LibraryLimits.maxPlanMinutes) минут." }
        return nil
    }

    public var isValid: Bool { problem == nil }
}

public extension Plan {
    var asInput: PlanInput {
        var input = PlanInput()
        input.sport = sport
        input.name = name
        input.description = description ?? ""
        input.durationMinutes = durationMinutes
        input.equipment = equipment ?? ""
        input.comment = comment ?? ""
        return input
    }
}

struct PlanBody: Encodable, Sendable {
    let input: PlanInput

    private enum CodingKeys: String, CodingKey { case sport, name, description, durationMinutes, equipment, comment }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(LibraryFormat.clean(input.sport), forKey: .sport)
        try c.encode(LibraryFormat.clean(input.name), forKey: .name)
        try c.encode(LibraryFormat.clean(input.description), forKey: .description)
        try c.encode(input.durationMinutes, forKey: .durationMinutes)
        try c.encode(LibraryFormat.clean(input.equipment), forKey: .equipment)
        try c.encode(LibraryFormat.clean(input.comment), forKey: .comment)
    }
}

/// Putting an exercise into a plan (or changing how it is done there).
public struct PlanExerciseInput: Equatable, Sendable {
    public var exerciseId: UUID
    public var section: PlanSection
    public var orderIndex: Int
    public var sets: Int?
    public var reps: Int?
    public var durationSeconds: Int?
    public var restSeconds: Int?
    public var notes = ""

    public init(exerciseId: UUID, section: PlanSection = .main, orderIndex: Int = 0) {
        self.exerciseId = exerciseId
        self.section = section
        self.orderIndex = orderIndex
    }

    public var problem: String? {
        if !(0...1000).contains(orderIndex) { return "Номер в плане — от 0 до 1000." }
        if LibraryFormat.outOfRange(sets, LibraryLimits.maxSets) { return "Подходов — от 0 до \(LibraryLimits.maxSets)." }
        if LibraryFormat.outOfRange(reps, LibraryLimits.maxReps) { return "Повторов — от 0 до \(LibraryLimits.maxReps)." }
        if LibraryFormat.outOfRange(durationSeconds, LibraryLimits.maxSeconds) { return "Длительность — от 0 до \(LibraryLimits.maxSeconds) секунд." }
        if LibraryFormat.outOfRange(restSeconds, LibraryLimits.maxSeconds) { return "Отдых — от 0 до \(LibraryLimits.maxSeconds) секунд." }
        if LibraryFormat.tooLong(notes, LibraryLimits.maxNotes) { return "Заметка не длиннее \(LibraryLimits.maxNotes) символов." }
        return nil
    }

    public var isValid: Bool { problem == nil }
}

public extension PlanExercise {
    var asInput: PlanExerciseInput {
        var input = PlanExerciseInput(exerciseId: exerciseId, section: section ?? .main, orderIndex: orderIndex)
        input.sets = sets
        input.reps = reps
        input.durationSeconds = durationSeconds
        input.restSeconds = restSeconds
        input.notes = notes ?? ""
        return input
    }
}

struct PlanExerciseBody: Encodable, Sendable {
    let input: PlanExerciseInput

    private enum CodingKeys: String, CodingKey { case exerciseId, section, orderIndex, sets, reps, durationSeconds, restSeconds, notes }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(input.exerciseId, forKey: .exerciseId)
        try c.encode(input.section.rawValue, forKey: .section)
        try c.encode(input.orderIndex, forKey: .orderIndex)
        try c.encode(input.sets, forKey: .sets)
        try c.encode(input.reps, forKey: .reps)
        try c.encode(input.durationSeconds, forKey: .durationSeconds)
        try c.encode(input.restSeconds, forKey: .restSeconds)
        try c.encode(LibraryFormat.clean(input.notes), forKey: .notes)
    }
}

struct ShareBody: Encodable, Sendable {
    let teamId: UUID
}

// MARK: - Task templates

/// A task a coach keeps to give again. It has the same fields as a task, without the deadline and the people.
public struct TaskTemplate: Decodable, Equatable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public let ownerId: UUID
    public let title: String
    public let description: String?
    public let planId: UUID?
    public let metricName: String?
    public let metricUnit: String?
    public let metricTarget: Double?
    public let requireComment: Bool
    public let requirePhoto: Bool
    public let requireVideo: Bool
    public let requireSetsReps: Bool
    public let requireDuration: Bool
    public let requireMetricValue: Bool
    public let requireDifficulty: Bool
    public let requireWellbeing: Bool
    public let createdAt: Date
    public let updatedAt: Date
    public let exercises: [TaskExercise]

    public var requirements: [TaskRequirement] {
        let flags: [(TaskRequirement, Bool)] = [
            (.comment, requireComment), (.photo, requirePhoto), (.video, requireVideo), (.setsReps, requireSetsReps),
            (.duration, requireDuration), (.metricValue, requireMetricValue), (.difficulty, requireDifficulty), (.wellbeing, requireWellbeing)
        ]
        return flags.filter(\.1).map(\.0)
    }

    private enum CodingKeys: String, CodingKey {
        case id, ownerId, title, description, planId, metricName, metricUnit, metricTarget, requireComment, requirePhoto, requireVideo
        case requireSetsReps, requireDuration, requireMetricValue, requireDifficulty, requireWellbeing, createdAt, updatedAt, exercises
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        ownerId = try container.decode(UUID.self, forKey: .ownerId)
        title = try container.decode(String.self, forKey: .title)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        planId = try container.decodeIfPresent(UUID.self, forKey: .planId)
        metricName = try container.decodeIfPresent(String.self, forKey: .metricName)
        metricUnit = try container.decodeIfPresent(String.self, forKey: .metricUnit)
        metricTarget = try container.decodeIfPresent(Double.self, forKey: .metricTarget)
        requireComment = try container.decode(Bool.self, forKey: .requireComment)
        requirePhoto = try container.decode(Bool.self, forKey: .requirePhoto)
        requireVideo = try container.decode(Bool.self, forKey: .requireVideo)
        requireSetsReps = try container.decode(Bool.self, forKey: .requireSetsReps)
        requireDuration = try container.decode(Bool.self, forKey: .requireDuration)
        requireMetricValue = try container.decode(Bool.self, forKey: .requireMetricValue)
        requireDifficulty = try container.decode(Bool.self, forKey: .requireDifficulty)
        requireWellbeing = try container.decode(Bool.self, forKey: .requireWellbeing)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        updatedAt = try container.decode(Date.self, forKey: .updatedAt)
        exercises = try container.decodeIfPresent([TaskExercise].self, forKey: .exercises) ?? []
    }
}

public extension TaskTemplate {
    /// The task form's values for this template (to change the template, or to give a task made from it).
    var asTaskInput: TaskInput? {
        var needs = TaskRequirements()
        for requirement in requirements { needs[requirement] = true }
        return TaskInput(
            title: title, description: description ?? "", metricName: metricName ?? "", metricUnit: metricUnit ?? "", metricTarget: metricTarget,
            requirements: needs, planId: planId, exerciseIds: exercises.sorted { $0.orderIndex < $1.orderIndex }.map(\.exerciseId)
        )
    }
}

/// The body of "save a task template" - the fields of a task without the deadline and the people (explicit nulls: the server replaces everything).
struct TaskTemplateBody: Encodable, Sendable {
    let input: TaskInput

    private enum CodingKeys: String, CodingKey {
        case title, description, planId, exerciseIds, metricName, metricUnit, metricTarget, requireComment, requirePhoto, requireVideo
        case requireSetsReps, requireDuration, requireMetricValue, requireDifficulty, requireWellbeing
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(input.title, forKey: .title)
        try c.encode(input.description, forKey: .description)
        try c.encode(input.planId, forKey: .planId)
        try c.encode(input.exerciseIds, forKey: .exerciseIds)
        try c.encode(input.metricName, forKey: .metricName)
        try c.encode(input.metricUnit, forKey: .metricUnit)
        try c.encode(input.metricTarget, forKey: .metricTarget)
        try c.encode(input.requirements.comment, forKey: .requireComment)
        try c.encode(input.requirements.photo, forKey: .requirePhoto)
        try c.encode(input.requirements.video, forKey: .requireVideo)
        try c.encode(input.requirements.setsReps, forKey: .requireSetsReps)
        try c.encode(input.requirements.duration, forKey: .requireDuration)
        try c.encode(input.requirements.metricValue, forKey: .requireMetricValue)
        try c.encode(input.requirements.difficulty, forKey: .requireDifficulty)
        try c.encode(input.requirements.wellbeing, forKey: .requireWellbeing)
    }
}
