import Foundation

/// Tasks of a team: the coaching staff gives and reviews them, a player does them and hands them in.
public final class TasksService: Sendable {
    private let client: APIClient

    public init(client: APIClient) { self.client = client }

    private func path(_ id: UUID, _ tail: String = "") -> String { "/api/tasks/\(id.uuidString.lowercased())\(tail)" }

    /// The staff sees every task of the team with everyone's part; a player only the tasks given to them.
    public func tasks(of team: UUID) async throws -> [TeamTask] {
        try await client.send(.get, "/api/teams/\(team.uuidString.lowercased())/tasks")
    }

    /// The person's own tasks from all teams.
    public func mine() async throws -> [MyTask] { try await client.send(.get, "/api/tasks/mine") }

    /// One task. For a player, opening it marks it as viewed.
    public func task(_ id: UUID) async throws -> TeamTask { try await client.send(.get, path(id)) }

    public func create(_ input: TaskInput, for team: UUID) async throws -> TeamTask {
        try await client.send(.post, "/api/teams/\(team.uuidString.lowercased())/tasks", body: TaskCreateBody(input))
    }

    /// Changes the text and the requirements. Who has the task cannot be changed.
    public func update(_ id: UUID, _ input: TaskInput) async throws -> TeamTask {
        try await client.send(.put, path(id), body: TaskUpdateBody(input: input))
    }

    public func delete(_ id: UUID) async throws { try await client.sendIgnoringResponse(.delete, path(id)) }

    public func start(_ id: UUID) async throws -> TaskAssignment { try await client.send(.post, path(id, "/start")) }

    public func submit(_ id: UUID, _ submission: TaskSubmission) async throws -> TaskAssignment {
        try await client.send(.post, path(id, "/submit"), body: TaskSubmissionBody(submission: submission))
    }

    /// Attaches the photo the task asks for (do it before `submit`, which checks that it is there).
    public func attachPhoto(_ photo: Data, filename: String, mimeType: String, to id: UUID) async throws -> TaskAssignment {
        try await client.upload(path(id, "/submit/photo"), file: UploadFile(filename: filename, mimeType: mimeType, data: photo))
    }

    /// Attaches the video the task asks for (do it before `submit`, which checks that it is there). A video takes a while to be stored.
    public func attachVideo(_ video: Data, filename: String, to id: UUID) async throws -> TaskAssignment {
        try await client.upload(
            path(id, "/submit/video"), file: UploadFile(filename: filename, mimeType: VideoRules.mimeType, data: video), timeout: Self.videoTimeout
        )
    }

    static let videoTimeout: TimeInterval = 180

    /// The coach accepts a submission or sends it back with a comment.
    public func review(_ id: UUID, player: UUID, decision: TaskDecision, comment: String) async throws -> TaskAssignment {
        let text = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        return try await client.send(
            .post, path(id, "/review/\(player.uuidString.lowercased())"),
            body: TaskReviewBody(decision: decision.rawValue, coachComment: text.isEmpty ? nil : text)
        )
    }
}
