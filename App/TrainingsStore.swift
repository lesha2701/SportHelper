import Foundation
import Observation
import SportArenaKit

/// Scheduling and changing trainings. Anything that changes a training tells the calendar to reload.
@MainActor
@Observable
final class TrainingsStore {
    private let service: TrainingsService
    /// Called after every change (the calendar reloads itself).
    var onChange: () -> Void = {}

    init(client: APIClient) { service = TrainingsService(client: client) }

    func teamTrainings(_ team: UUID) async -> Result<[Training], APIError> { await run { try await self.service.teamTrainings(team) } }

    func schedule(_ input: TrainingInput, for team: UUID) async -> Result<[Training], APIError> {
        changed(await run { try await self.service.schedule(input, for: team) })
    }

    func schedulePersonal(_ input: TrainingInput) async -> Result<[Training], APIError> {
        changed(await run { try await self.service.schedulePersonal(input) })
    }

    func personalDraft(style: WorkoutStyle, goals: String, durationMinutes: Int?) async -> Result<PersonalTrainingDraft, APIError> {
        await run { try await self.service.personalDraft(style: style, goals: goals, durationMinutes: durationMinutes) }
    }

    func workout(of id: UUID) async -> Result<TrainingWorkout?, APIError> { await run { try await self.service.workout(of: id) } }

    func saveWorkout(of id: UUID, _ result: WorkoutBody) async -> Result<TrainingWorkout, APIError> {
        await run { try await self.service.saveWorkout(of: id, result) }
    }

    func update(_ id: UUID, _ input: TrainingInput, status: TrainingStatus) async -> Result<Training, APIError> {
        changed(await run { try await self.service.update(id, input, status: status) })
    }

    func delete(_ id: UUID) async -> Result<Void, APIError> { changed(await run { try await self.service.delete(id) }) }

    func cancelSeries(of id: UUID) async -> Result<Void, APIError> { changed(await run { try await self.service.cancelSeries(of: id) }) }

    private func changed<Value>(_ result: Result<Value, APIError>) -> Result<Value, APIError> {
        if case .success = result { onChange() }
        return result
    }

    private func run<Value: Sendable>(_ work: @escaping () async throws -> Value) async -> Result<Value, APIError> {
        do {
            return .success(try await work())
        } catch let error as APIError {
            return .failure(Self.russian(error))
        } catch {
            return .failure(.unknown)
        }
    }

    /// The server's text for these cases is not always Russian: say them in the app's words.
    static func russian(_ error: APIError) -> APIError {
        let text: String? = switch error.code {
        case "responsible_player_required": "В команде нет капитана: выберите игрока, который будет отвечать за тренировку."
        case "invalid_training_type": "Личную тренировку нельзя сделать самостоятельной."
        case "player_profile_required": "Сначала заполните профиль игрока в разделе «Профиль»."
        // A server without the AI keys names its settings in the message: that is for the one who runs it, not for the person.
        case "ai_unavailable" where error.message.contains("YANDEX"): "ИИ сейчас недоступен. Попробуйте позже."
        default: nil
        }
        return text.map { APIError(status: error.status, code: error.code, message: $0, field: error.field, retryAfter: error.retryAfter) } ?? error
    }
}

extension LocalDate {
    /// This day as a `Date` at the start of the day in the person's own time zone (what a date picker shows).
    var startOfDay: Date {
        Calendar.current.date(from: DateComponents(year: year, month: month, day: day)) ?? Date()
    }
}

extension LocalTime {
    /// Today at this time, in the person's own time zone (what a time picker shows).
    var onToday: Date {
        Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: Date()) ?? Date()
    }

    init(from date: Date) {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        self = LocalTime(hour: parts.hour ?? 0, minute: parts.minute ?? 0) ?? LocalTime(hour: 0, minute: 0)!
    }
}
