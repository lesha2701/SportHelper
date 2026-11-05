import Foundation

/// Where one player stands with a task.
public enum AssignmentStatus: Equatable, Hashable, Sendable {
    case assigned, viewed, inProgress, submitted, accepted, needsRevision, overdue, missed, cancelled
    case other(String)

    public init(raw: String) {
        switch raw {
        case "assigned": self = .assigned
        case "viewed": self = .viewed
        case "in_progress": self = .inProgress
        case "submitted": self = .submitted
        case "accepted": self = .accepted
        case "needs_revision": self = .needsRevision
        case "overdue": self = .overdue
        case "missed": self = .missed
        case "cancelled": self = .cancelled
        default: self = .other(raw)
        }
    }

    public var title: String {
        switch self {
        case .assigned: "Назначено"
        case .viewed: "Просмотрено"
        case .inProgress: "Выполняется"
        case .submitted: "Ждёт проверки"
        case .accepted: "Принято"
        case .needsRevision: "На доработке"
        case .overdue: "Просрочено"
        case .missed: "Пропущено"
        case .cancelled: "Отменено"
        case .other(let raw): raw
        }
    }

    /// The player can still do the task (or do it again).
    public var canSubmit: Bool {
        switch self {
        case .assigned, .viewed, .inProgress, .needsRevision, .overdue: true
        default: false
        }
    }

    /// The player has not started yet: "Начать" makes sense.
    public var canStart: Bool { self == .assigned || self == .viewed }

    /// Nothing more is expected of the player.
    public var isClosed: Bool {
        switch self {
        case .accepted, .missed, .cancelled: true
        default: false
        }
    }
}

/// An exercise attached to a task or to a task template (the server names the owner `task_id` or `template_id`; neither is needed here).
public struct TaskExercise: Decodable, Equatable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public let exerciseId: UUID
    public let exerciseName: String?
    public let orderIndex: Int
}

/// One player's part of a task: their status and what they handed in.
public struct TaskAssignment: Decodable, Equatable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public let taskId: UUID
    public let userId: UUID
    public let firstName: String
    public let lastName: String?
    public let photoUrl: String?
    public let position: String?
    public let statusRaw: String
    public let comment: String?
    public let photoFileId: UUID?
    public let videoFileId: UUID?
    public let sets: Int?
    public let reps: Int?
    public let durationMinutes: Int?
    public let metricValue: Double?
    public let difficulty: Int?
    public let wellbeing: Int?
    public let coachComment: String?
    public let reviewedBy: UUID?
    public let reviewedAt: Date?
    public let viewedAt: Date?
    public let submittedAt: Date?
    public let createdAt: Date
    public let updatedAt: Date

    public var status: AssignmentStatus { AssignmentStatus(raw: statusRaw) }
    public var fullName: String { [firstName, lastName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ") }

    private enum CodingKeys: String, CodingKey {
        case id, taskId, userId, firstName, lastName, photoUrl, position, comment, photoFileId, videoFileId, sets, reps
        case durationMinutes, metricValue, difficulty, wellbeing, coachComment, reviewedBy, reviewedAt, viewedAt, submittedAt
        case createdAt, updatedAt
        case statusRaw = "status"
    }
}

/// Who a task is given to.
public enum TaskTarget: String, Sendable {
    case team, players, position, absentees
    public var title: String {
        switch self {
        case .team: "Вся команда"
        case .players: "Выбранные игроки"
        case .position: "Игроки на позиции"
        case .absentees: "Не пришедшие на тренировку"
        }
    }
}

/// What a player has to hand in, as the task asks for it.
public enum TaskRequirement: String, CaseIterable, Identifiable, Sendable {
    case comment, photo, video, setsReps, duration, metricValue, difficulty, wellbeing
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .comment: "Комментарий"
        case .photo: "Фото"
        case .video: "Видео"
        case .setsReps: "Подходы и повторы"
        case .duration: "Длительность"
        case .metricValue: "Результат"
        case .difficulty: "Сложность (1–10)"
        case .wellbeing: "Самочувствие (1–5)"
        }
    }
}

/// A task a coach gave to a team.
public struct TeamTask: Decodable, Equatable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public let teamId: UUID
    public let createdBy: UUID
    public let title: String
    public let description: String?
    public let planId: UUID?
    public let deadline: Date?
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
    public let targetTypeRaw: String
    public let targetPosition: String?
    public let targetTrainingId: UUID?
    public let createdAt: Date
    public let updatedAt: Date
    public let exercises: [TaskExercise]
    /// A coach sees everyone's part; a player only their own.
    public let assignments: [TaskAssignment]

    public var target: TaskTarget? { TaskTarget(rawValue: targetTypeRaw) }

    /// What a player must hand in, in the order of the form.
    public var requirements: [TaskRequirement] {
        let flags: [(TaskRequirement, Bool)] = [
            (.comment, requireComment), (.photo, requirePhoto), (.video, requireVideo), (.setsReps, requireSetsReps),
            (.duration, requireDuration), (.metricValue, requireMetricValue), (.difficulty, requireDifficulty), (.wellbeing, requireWellbeing)
        ]
        return flags.filter(\.1).map(\.0)
    }

    /// "Время, сек" / "Вес (кг)" - the metric as a person reads it.
    public var metricTitle: String? {
        guard let name = metricName, !name.isEmpty else { return nil }
        guard let unit = metricUnit, !unit.isEmpty else { return name }
        return "\(name), \(unit)"
    }

    /// Parts that still count: a cancelled one no longer belongs to anybody.
    public var activeAssignments: [TaskAssignment] { assignments.filter { $0.status != .cancelled } }
    public var acceptedCount: Int { activeAssignments.filter { $0.status == .accepted }.count }
    public var waitingForReviewCount: Int { activeAssignments.filter { $0.status == .submitted }.count }

    public func assignment(of user: UUID) -> TaskAssignment? { assignments.first { $0.userId == user } }

    private enum CodingKeys: String, CodingKey {
        case id, teamId, createdBy, title, description, planId, deadline, metricName, metricUnit, metricTarget, requireComment
        case requirePhoto, requireVideo, requireSetsReps, requireDuration, requireMetricValue, requireDifficulty, requireWellbeing
        case targetPosition, targetTrainingId, createdAt, updatedAt, exercises, assignments
        case targetTypeRaw = "targetType"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        teamId = try c.decode(UUID.self, forKey: .teamId)
        createdBy = try c.decode(UUID.self, forKey: .createdBy)
        title = try c.decode(String.self, forKey: .title)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        planId = try c.decodeIfPresent(UUID.self, forKey: .planId)
        deadline = try c.decodeIfPresent(Date.self, forKey: .deadline)
        metricName = try c.decodeIfPresent(String.self, forKey: .metricName)
        metricUnit = try c.decodeIfPresent(String.self, forKey: .metricUnit)
        metricTarget = try c.decodeIfPresent(Double.self, forKey: .metricTarget)
        requireComment = try c.decode(Bool.self, forKey: .requireComment)
        requirePhoto = try c.decode(Bool.self, forKey: .requirePhoto)
        requireVideo = try c.decode(Bool.self, forKey: .requireVideo)
        requireSetsReps = try c.decode(Bool.self, forKey: .requireSetsReps)
        requireDuration = try c.decode(Bool.self, forKey: .requireDuration)
        requireMetricValue = try c.decode(Bool.self, forKey: .requireMetricValue)
        requireDifficulty = try c.decode(Bool.self, forKey: .requireDifficulty)
        requireWellbeing = try c.decode(Bool.self, forKey: .requireWellbeing)
        targetTypeRaw = try c.decode(String.self, forKey: .targetTypeRaw)
        targetPosition = try c.decodeIfPresent(String.self, forKey: .targetPosition)
        targetTrainingId = try c.decodeIfPresent(UUID.self, forKey: .targetTrainingId)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        updatedAt = try c.decode(Date.self, forKey: .updatedAt)
        exercises = try c.decodeIfPresent([TaskExercise].self, forKey: .exercises) ?? []
        assignments = try c.decodeIfPresent([TaskAssignment].self, forKey: .assignments) ?? []
    }
}

/// A task together with the part that belongs to the person (`GET /api/tasks/mine`).
public struct MyTask: Decodable, Equatable, Hashable, Identifiable, Sendable {
    public let task: TeamTask
    public let assignment: TaskAssignment
    public var id: UUID { assignment.id }
}

// MARK: - Giving a task

public enum TaskLimits {
    public static let maxTitle = 150
    public static let maxDescription = 2000
    public static let maxMetricName = 100
    public static let maxMetricUnit = 30
    public static let maxComment = 2000
    public static let maxReviewComment = 1000
    public static let maxPlayers = 50
}

/// Which requirements a task has (the checkboxes of the form).
public struct TaskRequirements: Equatable, Sendable {
    public var comment = false
    public var photo = false
    public var video = false
    public var setsReps = false
    public var duration = false
    public var metricValue = false
    public var difficulty = false
    public var wellbeing = false

    public init() {}

    public subscript(requirement: TaskRequirement) -> Bool {
        get {
            switch requirement {
            case .comment: comment
            case .photo: photo
            case .video: video
            case .setsReps: setsReps
            case .duration: duration
            case .metricValue: metricValue
            case .difficulty: difficulty
            case .wellbeing: wellbeing
            }
        }
        set {
            switch requirement {
            case .comment: comment = newValue
            case .photo: photo = newValue
            case .video: video = newValue
            case .setsReps: setsReps = newValue
            case .duration: duration = newValue
            case .metricValue: metricValue = newValue
            case .difficulty: difficulty = newValue
            case .wellbeing: wellbeing = newValue
            }
        }
    }
}

/// Who gets a new task. «Absentees» are the players marked absent at one of the team's trainings.
public enum TaskAudience: Equatable, Sendable {
    case team
    case players([UUID])
    case position(String)
    case absentees(training: UUID?)
}

/// What the person fills in to give a task or to change one.
public struct TaskInput: Equatable, Sendable {
    public let title: String
    public let description: String?
    public let deadline: Date?
    public let metricName: String?
    public let metricUnit: String?
    public let metricTarget: Double?
    public let requirements: TaskRequirements
    /// Only when giving the task.
    public let audience: TaskAudience
    /// Kept as they are when a task is changed: the update replaces everything, so missing ones would detach the plan and the exercises.
    public let planId: UUID?
    public let exerciseIds: [UUID]

    /// Trims the text; empty optional fields become absent. nil when a value is impossible (see `problem`).
    public init?(
        title: String, description: String = "", deadline: Date? = nil, metricName: String = "", metricUnit: String = "",
        metricTarget: Double? = nil, requirements: TaskRequirements = TaskRequirements(), audience: TaskAudience = .team,
        planId: UUID? = nil, exerciseIds: [UUID] = []
    ) {
        if Self.problem(
            title: title, description: description, metricName: metricName, metricUnit: metricUnit, metricTarget: metricTarget,
            requirements: requirements, audience: audience
        ) != nil { return nil }
        func clean(_ text: String) -> String? {
            let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return value.isEmpty ? nil : value
        }
        self.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        self.description = clean(description)
        self.deadline = deadline
        self.metricName = clean(metricName)
        self.metricUnit = self.metricName == nil ? nil : clean(metricUnit)
        self.metricTarget = self.metricName == nil ? nil : metricTarget
        self.requirements = requirements
        self.audience = audience
        self.planId = planId
        self.exerciseIds = exerciseIds
    }

    /// Why the values cannot be sent (Russian text for the form), or nil when they can.
    public static func problem(
        title: String, description: String, metricName: String, metricUnit: String, metricTarget: Double?,
        requirements: TaskRequirements, audience: TaskAudience
    ) -> String? {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { return "Назовите задание." }
        if name.count > TaskLimits.maxTitle { return "Название не длиннее \(TaskLimits.maxTitle) символов." }
        if description.trimmingCharacters(in: .whitespacesAndNewlines).count > TaskLimits.maxDescription {
            return "Описание не длиннее \(TaskLimits.maxDescription) символов."
        }
        let metric = metricName.trimmingCharacters(in: .whitespacesAndNewlines)
        if metric.count > TaskLimits.maxMetricName { return "Название показателя не длиннее \(TaskLimits.maxMetricName) символов." }
        if metricUnit.trimmingCharacters(in: .whitespacesAndNewlines).count > TaskLimits.maxMetricUnit {
            return "Единица измерения не длиннее \(TaskLimits.maxMetricUnit) символов."
        }
        if let metricTarget, !metricTarget.isFinite { return "Цель показателя — число." }
        if requirements.metricValue && metric.isEmpty { return "Чтобы просить результат, назовите показатель." }
        switch audience {
        case .team: break
        case .players(let ids):
            if ids.isEmpty { return "Выберите хотя бы одного игрока." }
            if ids.count > TaskLimits.maxPlayers { return "Не больше \(TaskLimits.maxPlayers) игроков." }
        case .position(let name):
            if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Выберите позицию." }
        case .absentees(let training):
            if training == nil { return "Выберите тренировку, которую пропустили." }
        }
        return nil
    }
}

public extension TeamTask {
    /// The form's values for this task (to change it). The audience cannot be changed afterwards.
    var asInput: TaskInput? {
        var needs = TaskRequirements()
        for requirement in requirements { needs[requirement] = true }
        return TaskInput(
            title: title, description: description ?? "", deadline: deadline, metricName: metricName ?? "", metricUnit: metricUnit ?? "",
            metricTarget: metricTarget, requirements: needs, planId: planId, exerciseIds: exercises.sorted { $0.orderIndex < $1.orderIndex }.map(\.exerciseId)
        )
    }
}

/// The body of "give a task". Cleared optional fields are absent, as the server's defaults want.
struct TaskCreateBody: Encodable, Sendable {
    let title: String
    let description: String?
    let planId: UUID?
    let exerciseIds: [UUID]
    let deadline: Date?
    let metricName: String?
    let metricUnit: String?
    let metricTarget: Double?
    let requireComment: Bool
    let requirePhoto: Bool
    let requireVideo: Bool
    let requireSetsReps: Bool
    let requireDuration: Bool
    let requireMetricValue: Bool
    let requireDifficulty: Bool
    let requireWellbeing: Bool
    let targetType: String
    let playerIds: [UUID]
    let position: String?
    let trainingId: UUID?

    init(_ input: TaskInput) {
        title = input.title
        description = input.description
        planId = input.planId
        exerciseIds = input.exerciseIds
        deadline = input.deadline
        metricName = input.metricName
        metricUnit = input.metricUnit
        metricTarget = input.metricTarget
        requireComment = input.requirements.comment
        requirePhoto = input.requirements.photo
        requireVideo = input.requirements.video
        requireSetsReps = input.requirements.setsReps
        requireDuration = input.requirements.duration
        requireMetricValue = input.requirements.metricValue
        requireDifficulty = input.requirements.difficulty
        requireWellbeing = input.requirements.wellbeing
        switch input.audience {
        case .team:
            targetType = "team"
            playerIds = []
            position = nil
            trainingId = nil
        case .players(let ids):
            targetType = "players"
            playerIds = ids
            position = nil
            trainingId = nil
        case .position(let name):
            targetType = "position"
            playerIds = []
            position = name.trimmingCharacters(in: .whitespacesAndNewlines)
            trainingId = nil
        case .absentees(let training):
            targetType = "absentees"
            playerIds = []
            position = nil
            trainingId = training
        }
    }
}

/// The body of "change a task": the server replaces everything, so cleared fields go as explicit nulls (otherwise removing the
/// deadline in the form would silently keep the old one).
struct TaskUpdateBody: Encodable, Sendable {
    let input: TaskInput

    private enum CodingKeys: String, CodingKey {
        case title, description, planId, exerciseIds, deadline, metricName, metricUnit, metricTarget, requireComment, requirePhoto
        case requireVideo, requireSetsReps, requireDuration, requireMetricValue, requireDifficulty, requireWellbeing
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(input.title, forKey: .title)
        try c.encode(input.description, forKey: .description)
        try c.encode(input.planId, forKey: .planId)
        try c.encode(input.exerciseIds, forKey: .exerciseIds)
        try c.encode(input.deadline, forKey: .deadline)
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

// MARK: - Handing a task in

/// What a player hands in. Every field is sent (the server replaces the previous submission), those not filled in as nulls.
public struct TaskSubmission: Equatable, Sendable {
    public let comment: String?
    public let sets: Int?
    public let reps: Int?
    public let durationMinutes: Int?
    public let metricValue: Double?
    public let difficulty: Int?
    public let wellbeing: Int?

    public init?(
        comment: String = "", sets: Int? = nil, reps: Int? = nil, durationMinutes: Int? = nil, metricValue: Double? = nil,
        difficulty: Int? = nil, wellbeing: Int? = nil
    ) {
        if Self.problem(comment: comment, sets: sets, reps: reps, durationMinutes: durationMinutes, metricValue: metricValue, difficulty: difficulty, wellbeing: wellbeing) != nil {
            return nil
        }
        let text = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        self.comment = text.isEmpty ? nil : text
        self.sets = sets
        self.reps = reps
        self.durationMinutes = durationMinutes
        self.metricValue = metricValue
        self.difficulty = difficulty
        self.wellbeing = wellbeing
    }

    public static func problem(
        comment: String, sets: Int?, reps: Int?, durationMinutes: Int?, metricValue: Double?, difficulty: Int?, wellbeing: Int?
    ) -> String? {
        if comment.trimmingCharacters(in: .whitespacesAndNewlines).count > TaskLimits.maxComment {
            return "Комментарий не длиннее \(TaskLimits.maxComment) символов."
        }
        if let sets, !(0...100).contains(sets) { return "Подходов — от 0 до 100." }
        if let reps, !(0...1000).contains(reps) { return "Повторов — от 0 до 1000." }
        if let durationMinutes, !(0...1000).contains(durationMinutes) { return "Длительность — от 0 до 1000 минут." }
        if let metricValue, !metricValue.isFinite { return "Результат — число." }
        if let difficulty, !(1...10).contains(difficulty) { return "Сложность — от 1 до 10." }
        if let wellbeing, !(1...5).contains(wellbeing) { return "Самочувствие — от 1 до 5." }
        return nil
    }

    /// What the task asks for and this does not have yet (Russian names). A photo or a video already uploaded counts.
    public func missing(for task: TeamTask, assignment: TaskAssignment?) -> [TaskRequirement] {
        task.requirements.filter { requirement in
            switch requirement {
            case .comment: comment == nil
            case .photo: assignment?.photoFileId == nil
            case .video: assignment?.videoFileId == nil
            case .setsReps: sets == nil || reps == nil
            case .duration: durationMinutes == nil
            case .metricValue: metricValue == nil
            case .difficulty: difficulty == nil
            case .wellbeing: wellbeing == nil
            }
        }
    }
}

struct TaskSubmissionBody: Encodable, Sendable {
    let submission: TaskSubmission

    private enum CodingKeys: String, CodingKey { case comment, sets, reps, durationMinutes, metricValue, difficulty, wellbeing }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(submission.comment, forKey: .comment)
        try c.encode(submission.sets, forKey: .sets)
        try c.encode(submission.reps, forKey: .reps)
        try c.encode(submission.durationMinutes, forKey: .durationMinutes)
        try c.encode(submission.metricValue, forKey: .metricValue)
        try c.encode(submission.difficulty, forKey: .difficulty)
        try c.encode(submission.wellbeing, forKey: .wellbeing)
    }
}

/// The coach's verdict on a submission.
public enum TaskDecision: String, Sendable {
    case accepted
    case needsRevision = "needs_revision"
}

struct TaskReviewBody: Encodable, Sendable {
    let decision: String
    let coachComment: String?

    private enum CodingKeys: String, CodingKey { case decision, coachComment }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(decision, forKey: .decision)
        try c.encode(coachComment, forKey: .coachComment)
    }
}
