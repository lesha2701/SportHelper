import Foundation
import Observation
import SportArenaKit

/// The coach's library (and what a team reads of it). Nothing is kept here - every screen asks the server again.
@MainActor
@Observable
final class LibraryStore {
    private let service: LibraryService

    init(client: APIClient) { service = LibraryService(client: client) }

    // exercises
    func exercises() async -> Result<[Exercise], APIError> { await run { try await self.service.exercises() } }
    func exercise(_ id: UUID) async -> Result<Exercise, APIError> { await run { try await self.service.exercise(id) } }
    func teamExercises(_ team: UUID) async -> Result<[Exercise], APIError> { await run { try await self.service.teamExercises(team) } }
    func createExercise(_ input: ExerciseInput) async -> Result<Exercise, APIError> { await run { try await self.service.createExercise(input) } }
    func updateExercise(_ id: UUID, _ input: ExerciseInput) async -> Result<Exercise, APIError> { await run { try await self.service.updateExercise(id, input) } }
    func deleteExercise(_ id: UUID) async -> Result<Void, APIError> { await run { try await self.service.deleteExercise(id) } }

    func shareExercise(_ id: UUID, team: UUID, on: Bool) async -> Result<Exercise, APIError> {
        await run { on ? try await self.service.shareExercise(id, with: team) : try await self.service.unshareExercise(id, from: team) }
    }

    func attachPhoto(_ photo: Data, to id: UUID) async -> Result<Exercise, APIError> {
        await run { try await self.service.attachPhoto(photo, filename: "photo.jpg", mimeType: "image/jpeg", to: id) }
    }

    // plans
    func plans() async -> Result<[Plan], APIError> { await run { try await self.service.plans() } }
    func plan(_ id: UUID) async -> Result<Plan, APIError> { await run { try await self.service.plan(id) } }
    func teamPlans(_ team: UUID) async -> Result<[Plan], APIError> { await run { try await self.service.teamPlans(team) } }
    func createPlan(_ input: PlanInput) async -> Result<Plan, APIError> { await run { try await self.service.createPlan(input) } }
    func updatePlan(_ id: UUID, _ input: PlanInput) async -> Result<Plan, APIError> { await run { try await self.service.updatePlan(id, input) } }
    func deletePlan(_ id: UUID) async -> Result<Void, APIError> { await run { try await self.service.deletePlan(id) } }
    func duplicatePlan(_ id: UUID) async -> Result<Plan, APIError> { await run { try await self.service.duplicatePlan(id) } }

    func sharePlan(_ id: UUID, team: UUID, on: Bool) async -> Result<Plan, APIError> {
        await run { on ? try await self.service.sharePlan(id, with: team) : try await self.service.unsharePlan(id, from: team) }
    }

    func addExercise(_ input: PlanExerciseInput, to plan: UUID) async -> Result<PlanExercise, APIError> {
        await run { try await self.service.addExercise(input, to: plan) }
    }

    func updateExercise(_ item: UUID, in plan: UUID, _ input: PlanExerciseInput) async -> Result<PlanExercise, APIError> {
        await run { try await self.service.updateExercise(item, in: plan, input) }
    }

    func removeExercise(_ item: UUID, from plan: UUID) async -> Result<Void, APIError> { await run { try await self.service.removeExercise(item, from: plan) } }

    // templates
    func templates() async -> Result<[TaskTemplate], APIError> { await run { try await self.service.templates() } }
    func createTemplate(_ input: TaskInput) async -> Result<TaskTemplate, APIError> { await run { try await self.service.createTemplate(input) } }
    func updateTemplate(_ id: UUID, _ input: TaskInput) async -> Result<TaskTemplate, APIError> { await run { try await self.service.updateTemplate(id, input) } }
    func deleteTemplate(_ id: UUID) async -> Result<Void, APIError> { await run { try await self.service.deleteTemplate(id) } }

    private func run<Value: Sendable>(_ work: @escaping @Sendable () async throws -> Value) async -> Result<Value, APIError> {
        await apiResult(translate: Self.russian, work)
    }

    /// The server's text for these cases is not always Russian: say them in the app's words.
    nonisolated static func russian(_ error: APIError) -> APIError {
        let text: String? = switch error.code {
        case "coach_profile_required": "Сначала заполните профиль тренера: Профиль → Редактировать профиль."
        case "unsupported_media_type": "Такой файл не подходит: нужно изображение."
        case "file_too_large": "Файл слишком большой."
        case "storage_error", "yandex_disk_not_configured": "Не удалось сохранить файл. Попробуйте позже."
        case "forbidden": "У вас нет доступа к этому."
        case "not_found": "Не найдено: возможно, это уже удалили."
        default: nil
        }
        return text.map(error.saying) ?? error
    }
}
