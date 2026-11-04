import Foundation
import Observation
import SportArenaKit

/// Tasks of a team: giving, doing, handing in and reviewing. Nothing is kept here - every screen asks the server again.
@MainActor
@Observable
final class TasksStore {
    private let service: TasksService
    /// The tasks waiting for the person (to do, or to review) are counted by the screens that show them.
    init(client: APIClient) { service = TasksService(client: client) }

    func tasks(of team: UUID) async -> Result<[TeamTask], APIError> { await run { try await self.service.tasks(of: team) } }
    func mine() async -> Result<[MyTask], APIError> { await run { try await self.service.mine() } }
    func task(_ id: UUID) async -> Result<TeamTask, APIError> { await run { try await self.service.task(id) } }
    func create(_ input: TaskInput, for team: UUID) async -> Result<TeamTask, APIError> { await run { try await self.service.create(input, for: team) } }
    func update(_ id: UUID, _ input: TaskInput) async -> Result<TeamTask, APIError> { await run { try await self.service.update(id, input) } }
    func delete(_ id: UUID) async -> Result<Void, APIError> { await run { try await self.service.delete(id) } }
    func start(_ id: UUID) async -> Result<TaskAssignment, APIError> { await run { try await self.service.start(id) } }

    /// Hands the task in. A photo the task asks for goes first (the server checks that it is there).
    func submit(_ id: UUID, _ submission: TaskSubmission, photo: Data?) async -> Result<TaskAssignment, APIError> {
        await run {
            if let photo { _ = try await self.service.attachPhoto(photo, filename: "photo.jpg", mimeType: "image/jpeg", to: id) }
            return try await self.service.submit(id, submission)
        }
    }

    func review(_ id: UUID, player: UUID, decision: TaskDecision, comment: String) async -> Result<TaskAssignment, APIError> {
        await run { try await self.service.review(id, player: player, decision: decision, comment: comment) }
    }

    private func run<Value: Sendable>(_ work: @escaping @Sendable () async throws -> Value) async -> Result<Value, APIError> {
        await apiResult(translate: Self.russian, work)
    }

    /// The server's text for these cases is not always Russian: say them in the app's words.
    nonisolated static func russian(_ error: APIError) -> APIError {
        let text: String? = switch error.code {
        case "players_required": "Выберите хотя бы одного игрока."
        case "position_required": "Выберите позицию."
        case "no_recipients": "Под этот выбор не попал ни один игрок: задание некому давать."
        case "submission_incomplete": "Заполните всё, что просит задание."
        case "task_cancelled": "Это задание отменено."
        case "invalid_status": "С этим заданием это уже нельзя сделать."
        case "unsupported_media_type": "Такой файл не подходит: нужно изображение."
        case "file_too_large": "Файл слишком большой."
        case "storage_error", "yandex_disk_not_configured": "Не удалось сохранить файл. Попробуйте позже."
        case "forbidden": "У вас нет доступа к этому заданию."
        case "not_found": "Задание не найдено: возможно, его удалили."
        default: nil
        }
        return text.map(error.saying) ?? error
    }
}
