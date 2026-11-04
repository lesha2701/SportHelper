import Foundation

/// The coach's library: exercises, training plans (built from exercises) and task templates. All of it belongs to the coach; exercises
/// and plans can be opened to the teams the coach runs, and the members of such a team read them.
public final class LibraryService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    private func id(_ value: UUID) -> String { value.uuidString.lowercased() }

    // MARK: exercises

    public func exercises() async throws -> [Exercise] { try await client.send(.get, "/api/exercises/mine") }
    public func exercise(_ exercise: UUID) async throws -> Exercise { try await client.send(.get, "/api/exercises/\(id(exercise))") }
    public func teamExercises(_ team: UUID) async throws -> [Exercise] { try await client.send(.get, "/api/teams/\(id(team))/exercises") }

    public func createExercise(_ input: ExerciseInput) async throws -> Exercise {
        try await client.send(.post, "/api/exercises", body: ExerciseBody(input: input))
    }

    public func updateExercise(_ exercise: UUID, _ input: ExerciseInput) async throws -> Exercise {
        try await client.send(.put, "/api/exercises/\(id(exercise))", body: ExerciseBody(input: input))
    }

    public func deleteExercise(_ exercise: UUID) async throws { try await client.sendIgnoringResponse(.delete, "/api/exercises/\(id(exercise))") }

    public func shareExercise(_ exercise: UUID, with team: UUID) async throws -> Exercise {
        try await client.send(.post, "/api/exercises/\(id(exercise))/share", body: ShareBody(teamId: team))
    }

    public func unshareExercise(_ exercise: UUID, from team: UUID) async throws -> Exercise {
        try await client.send(.delete, "/api/exercises/\(id(exercise))/share/\(id(team))")
    }

    public func attachPhoto(_ photo: Data, filename: String, mimeType: String, to exercise: UUID) async throws -> Exercise {
        try await client.upload("/api/exercises/\(id(exercise))/photo", file: UploadFile(filename: filename, mimeType: mimeType, data: photo))
    }

    // MARK: plans

    /// The plans, without their exercises (open one to get them).
    public func plans() async throws -> [Plan] { try await client.send(.get, "/api/plans/mine") }
    public func plan(_ plan: UUID) async throws -> Plan { try await client.send(.get, "/api/plans/\(id(plan))") }
    public func teamPlans(_ team: UUID) async throws -> [Plan] { try await client.send(.get, "/api/teams/\(id(team))/plans") }

    public func createPlan(_ input: PlanInput) async throws -> Plan { try await client.send(.post, "/api/plans", body: PlanBody(input: input)) }

    public func updatePlan(_ plan: UUID, _ input: PlanInput) async throws -> Plan {
        try await client.send(.put, "/api/plans/\(id(plan))", body: PlanBody(input: input))
    }

    public func deletePlan(_ plan: UUID) async throws { try await client.sendIgnoringResponse(.delete, "/api/plans/\(id(plan))") }

    /// A copy named "… (копия)" with the same exercises.
    public func duplicatePlan(_ plan: UUID) async throws -> Plan { try await client.send(.post, "/api/plans/\(id(plan))/duplicate") }

    public func sharePlan(_ plan: UUID, with team: UUID) async throws -> Plan {
        try await client.send(.post, "/api/plans/\(id(plan))/share", body: ShareBody(teamId: team))
    }

    public func unsharePlan(_ plan: UUID, from team: UUID) async throws -> Plan {
        try await client.send(.delete, "/api/plans/\(id(plan))/share/\(id(team))")
    }

    public func addExercise(_ input: PlanExerciseInput, to plan: UUID) async throws -> PlanExercise {
        try await client.send(.post, "/api/plans/\(id(plan))/exercises", body: PlanExerciseBody(input: input))
    }

    public func updateExercise(_ item: UUID, in plan: UUID, _ input: PlanExerciseInput) async throws -> PlanExercise {
        try await client.send(.put, "/api/plans/\(id(plan))/exercises/\(id(item))", body: PlanExerciseBody(input: input))
    }

    public func removeExercise(_ item: UUID, from plan: UUID) async throws {
        try await client.sendIgnoringResponse(.delete, "/api/plans/\(id(plan))/exercises/\(id(item))")
    }

    // MARK: task templates

    public func templates() async throws -> [TaskTemplate] { try await client.send(.get, "/api/task-templates/mine") }
    public func template(_ template: UUID) async throws -> TaskTemplate { try await client.send(.get, "/api/task-templates/\(id(template))") }

    /// Saves a template. Only the text, the metric, the requirements, the plan and the exercises of the input are used.
    public func createTemplate(_ input: TaskInput) async throws -> TaskTemplate {
        try await client.send(.post, "/api/task-templates", body: TaskTemplateBody(input: input))
    }

    public func updateTemplate(_ template: UUID, _ input: TaskInput) async throws -> TaskTemplate {
        try await client.send(.put, "/api/task-templates/\(id(template))", body: TaskTemplateBody(input: input))
    }

    public func deleteTemplate(_ template: UUID) async throws {
        try await client.sendIgnoringResponse(.delete, "/api/task-templates/\(id(template))")
    }
}
