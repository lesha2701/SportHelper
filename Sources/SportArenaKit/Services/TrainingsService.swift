import Foundation

/// Scheduling and changing trainings (for the coaching staff of a team).
public final class TrainingsService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    private func path(_ id: UUID, _ tail: String = "") -> String { "/api/trainings/\(id.uuidString.lowercased())\(tail)" }

    public func teamTrainings(_ team: UUID) async throws -> [Training] {
        try await client.send(.get, "/api/teams/\(team.uuidString.lowercased())/trainings")
    }

    /// One training, or the whole series when the input repeats weekly.
    public func schedule(_ input: TrainingInput, for team: UUID) async throws -> [Training] {
        try await client.send(.post, "/api/teams/\(team.uuidString.lowercased())/trainings", body: TrainingCreateBody(input))
    }

    /// A training of the person's own (no team). One training, or the whole series when the input repeats weekly.
    public func schedulePersonal(_ input: TrainingInput) async throws -> [Training] {
        try await client.send(.post, "/api/trainings/personal", body: TrainingCreateBody(input))
    }

    /// A training the assistant suggests. Needs a player profile (409 `player_profile_required`); it takes a while to be written.
    public func personalDraft(style: WorkoutStyle, goals: String, durationMinutes: Int?) async throws -> PersonalTrainingDraft {
        try await client.send(
            .post, "/api/ai/personal-training-draft", body: PersonalDraftBody(style: style, goals: goals, durationMinutes: durationMinutes),
            timeout: StatsService.analysisTimeout
        )
    }

    /// What the person recorded in the guided workout of a personal training; nil while nothing was saved.
    public func workout(of id: UUID) async throws -> TrainingWorkout? {
        try await client.send(.get, path(id, "/workout"))
    }

    /// Saves (replaces) the results of a guided workout. Only the owner of a personal training can.
    public func saveWorkout(of id: UUID, _ result: WorkoutBody) async throws -> TrainingWorkout {
        try await client.send(.put, path(id, "/workout"), body: result)
    }

    public func update(_ id: UUID, _ input: TrainingInput, status: TrainingStatus) async throws -> Training {
        try await client.send(.put, path(id), body: TrainingUpdateBody(input: input, status: status.rawValue))
    }

    public func delete(_ id: UUID) async throws { try await client.sendIgnoringResponse(.delete, path(id)) }

    /// Cancels every training of the series this one belongs to.
    public func cancelSeries(of id: UUID) async throws { try await client.sendIgnoringResponse(.post, path(id, "/cancel-series")) }
}
