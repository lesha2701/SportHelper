import SportArenaKit
import SwiftUI

/// One training: when, how long, where, what, and its state. The coaching staff of the team can change it from here.
struct TrainingDetailView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    let trainingId: UUID
    let title: String
    let teamName: String?

    private enum Load {
        case loading
        case loaded(Training)
        case failed(String)
    }

    private enum Confirmation: Identifiable {
        case delete, cancelSeries
        var id: Self { self }
    }

    @State private var load = Load.loading
    @State private var editing: Training?
    @State private var confirming: Confirmation?
    @State private var notice: (text: String, isError: Bool)?
    @State private var working = false

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
        .toolbar {
            if case .loaded(let training) = load, canManage(training) { ToolbarItem(placement: .topBarTrailing) { actionsMenu(training) } }
        }
        .task {
            if case .loading = auth.teams.mine { await auth.teams.reloadMine() }
            await fetch()
        }
        .sheet(item: $editing) { training in TrainingFormView(mode: .edit(training)) { Task { await fetch() } } }
        .confirmationDialog(
            confirming == .delete ? "Удалить тренировку?" : "Отменить всю серию?",
            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }), titleVisibility: .visible
        ) {
            if confirming == .delete {
                Button("Удалить", role: .destructive) { Task { await delete() } }
            } else {
                Button("Отменить все тренировки серии", role: .destructive) { Task { await cancelSeries() } }
            }
        } message: {
            Text(confirming == .delete ? deleteWarning : "Все тренировки серии получат статус «Отменена».")
        }
    }

    private var deleteWarning: String {
        if case .loaded(let training) = load, training.type == "personal" { return "Она исчезнет из вашего календаря." }
        return "Она исчезнет из расписания команды."
    }

    // MARK: rights

    /// Team and independent trainings are managed by the team's coaching staff, a personal one by the person who made it.
    private func canManage(_ training: Training) -> Bool {
        if training.type == "personal" { return training.createdBy == auth.user?.id }
        guard let teamId = training.teamId, case .loaded(let teams) = auth.teams.mine else { return false }
        return teams.first { $0.id == teamId }?.canManage ?? false
    }

    private func actionsMenu(_ training: Training) -> some View {
        Menu {
            Button("Изменить", systemImage: "pencil") { editing = training }.accessibilityIdentifier("training.edit")
            if training.status == "scheduled" {
                Button("Отметить проведённой", systemImage: "checkmark.circle") { Task { await setStatus(training, .completed) } }
                    .accessibilityIdentifier("training.complete")
                Button("Отменить тренировку", systemImage: "xmark.circle") { Task { await setStatus(training, .cancelled) } }
                    .accessibilityIdentifier("training.cancel")
            } else if training.status == "cancelled" {
                Button("Запланировать снова", systemImage: "arrow.uturn.backward") { Task { await setStatus(training, .scheduled) } }
            }
            if training.recurrenceGroupId != nil {
                Button("Отменить всю серию", systemImage: "calendar.badge.minus") { confirming = .cancelSeries }
            }
            Button("Удалить", systemImage: "trash", role: .destructive) { confirming = .delete }.accessibilityIdentifier("training.delete")
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .disabled(working)
        .accessibilityLabel("Действия с тренировкой")
        .accessibilityIdentifier("training.actions")
    }

    // MARK: actions

    private func setStatus(_ training: Training, _ status: TrainingStatus) async {
        guard let input = training.asInput else {
            notice = ("Не удалось прочитать данные тренировки.", true)
            return
        }
        await perform("Статус изменён: \(status.title.lowercased()).") {
            if case .failure(let error) = await auth.trainings.update(training.id, input, status: status) { throw error }
        }
    }

    private func cancelSeries() async {
        await perform("Все тренировки серии отменены.") {
            if case .failure(let error) = await auth.trainings.cancelSeries(of: trainingId) { throw error }
        }
    }

    private func delete() async {
        working = true
        defer { working = false }
        switch await auth.trainings.delete(trainingId) {
        case .success: dismiss()
        case .failure(let error): notice = (error.message, true)
        }
    }

    private func perform(_ success: String, _ work: () async throws -> Void) async {
        working = true
        defer { working = false }
        do {
            try await work()
            notice = (success, false)
            await fetch()
        } catch let error as APIError {
            notice = (error.message, true)
        } catch {
            notice = (APIError.unknown.message, true)
        }
    }

    // MARK: content

    private func details(_ training: Training) -> some View {
        List {
            if let notice {
                Section {
                    Label(notice.text, systemImage: notice.isError ? "exclamationmark.triangle" : "checkmark.circle")
                        .foregroundStyle(notice.isError ? .red : .green)
                        .accessibilityIdentifier("training.notice")
                }
            }
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text(title).font(.title3.bold()).accessibilityIdentifier("training.title")
                    if let status = training.trainingStatus { statusPill(status) } else { statusPill(nil, raw: training.status) }
                }
            }
            Section {
                LabeledContent("Дата", value: LocalDateFormat.full(training.trainingDate))
                LabeledContent("Время", value: training.timeRange)
                LabeledContent("Длительность", value: "\(training.durationMinutes) мин")
                if let location = training.location, !location.isEmpty { LabeledContent("Место", value: location) }
                if let type = training.trainingType { LabeledContent("Тип", value: type.title) }
                if let team = teamName { LabeledContent("Команда", value: team) }
                if let minutes = training.reminderMinutesBefore { LabeledContent("Напоминание", value: TrainingReminder.title(minutes)) }
                if training.recurrenceGroupId != nil { LabeledContent("Повтор", value: "Каждую неделю") }
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

    private func fetch() async {
        if case .loaded = load {} else { load = .loading }
        do {
            load = .loaded(try await auth.calendar.training(id: trainingId))
        } catch let error as APIError {
            load = .failed(error.message)
        } catch {
            load = .failed(APIError.unknown.message)
        }
    }
}
