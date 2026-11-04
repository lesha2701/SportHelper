import SportArenaKit
import SwiftUI

/// One training: when, how long, where, what, and its state.
struct TrainingDetailView: View {
    let event: CalendarEvent
    let store: CalendarStore

    private enum Load {
        case loading
        case loaded(Training)
        case failed(String)
    }

    @State private var load = Load.loading

    var body: some View {
        Group {
            switch load {
            case .loading:
                ProgressView("Загрузка…")
            case .failed(let message):
                ContentUnavailableView {
                    Label("Не удалось загрузить тренировку", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Повторить") { Task { await fetch() } }
                }
            case .loaded(let training):
                details(training)
            }
        }
        .navigationTitle("Тренировка")
        .navigationBarTitleDisplayMode(.inline)
        .task { await fetch() }
    }

    private func details(_ training: Training) -> some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text(event.title).font(.title3.bold()).accessibilityIdentifier("training.title")
                    if let status = training.trainingStatus { statusPill(status) } else { statusPill(nil, raw: training.status) }
                }
            }
            Section {
                LabeledContent("Дата", value: LocalDateFormat.full(training.trainingDate))
                LabeledContent("Время", value: training.timeRange)
                LabeledContent("Длительность", value: "\(training.durationMinutes) мин")
                if let location = training.location, !location.isEmpty { LabeledContent("Место", value: location) }
                if let type = training.trainingType { LabeledContent("Тип", value: type.title) }
                if let team = event.teamName { LabeledContent("Команда", value: team) }
                if let minutes = training.reminderMinutesBefore { LabeledContent("Напоминание", value: reminder(minutes)) }
            }
            if let description = training.description, !description.isEmpty {
                Section("Описание") { Text(description) }
            }
        }
    }

    private func statusPill(_ status: TrainingStatus?, raw: String = "") -> some View {
        let text = status?.title ?? raw
        let color: Color = switch status {
        case .completed: .green
        case .cancelled: .secondary
        default: Theme.primary
        }
        return Text(text)
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 12).padding(.vertical, 4)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
    }

    private func reminder(_ minutes: Int) -> String {
        switch minutes {
        case 0: "в момент начала"
        case 60: "за 1 час"
        case let minutes where minutes % 60 == 0: "за \(minutes / 60) ч"
        default: "за \(minutes) мин"
        }
    }

    private func fetch() async {
        load = .loading
        do {
            load = .loaded(try await store.training(id: event.id))
        } catch let error as APIError {
            load = .failed(error.message)
        } catch {
            load = .failed(APIError.unknown.message)
        }
    }
}
