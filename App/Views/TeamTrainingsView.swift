import SportArenaKit
import SwiftUI

/// The trainings of one team: what is coming, and what was.
struct TeamTrainingsView: View {
    @Environment(AuthStore.self) private var auth
    let team: Team
    @State private var load: Load = .loading
    @State private var scheduling = false

    private enum Load: Equatable {
        case loading
        case loaded([Training])
        case failed(String)
    }

    var body: some View {
        Group {
            switch load {
            case .loading:
                ProgressView("Загрузка тренировок…")
            case .failed(let message):
                ContentUnavailableView {
                    Label("Не удалось загрузить тренировки", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Повторить") { Task { await fetch() } }
                }
            case .loaded(let trainings):
                list(trainings)
            }
        }
        .navigationTitle("Тренировки")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if team.canManage {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Назначить", systemImage: "plus") { scheduling = true }.accessibilityIdentifier("trainings.schedule")
                }
            }
        }
        .task { await fetch() }
        .sheet(isPresented: $scheduling) { TrainingFormView(mode: .schedule(team)) { Task { await fetch() } } }
    }

    private func list(_ trainings: [Training]) -> some View {
        let today = LocalDate.today()
        let upcoming = trainings.filter { $0.status == "scheduled" && $0.trainingDate >= today }
            .sorted { ($0.trainingDate, $0.startTime) < ($1.trainingDate, $1.startTime) }
        let rest = trainings.filter { !upcoming.contains($0) }
            .sorted { ($0.trainingDate, $0.startTime) > ($1.trainingDate, $1.startTime) }
        return List {
            if trainings.isEmpty {
                ContentUnavailableView(
                    "Тренировок нет", systemImage: "calendar",
                    description: Text(team.canManage ? "Назначьте первую тренировку кнопкой «+»." : "Тренер ещё не назначил тренировок.")
                )
                .listRowBackground(Color.clear)
            }
            section("Предстоящие", upcoming)
            section("Прошедшие и отменённые", rest)
        }
        .refreshable { await fetch() }
        .accessibilityIdentifier("trainings.list")
    }

    @ViewBuilder private func section(_ title: String, _ items: [Training]) -> some View {
        if !items.isEmpty {
            Section(title) {
                ForEach(items) { training in
                    NavigationLink {
                        TrainingDetailView(trainingId: training.id, title: training.trainingType?.title ?? "Тренировка", teamName: team.name)
                    } label: {
                        row(training)
                    }
                    .accessibilityIdentifier("trainings.row")
                }
            }
        }
    }

    private func row(_ training: Training) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("\(LocalDateFormat.full(training.trainingDate)), \(training.timeRange)").font(.headline)
            HStack(spacing: 8) {
                Text(training.trainingStatus?.title ?? training.status).font(.footnote)
                    .foregroundStyle(training.status == "cancelled" ? Color.secondary : Theme.primary)
                if let location = training.location, !location.isEmpty { Text(location).font(.footnote).foregroundStyle(.secondary) }
            }
            if training.type == "independent" { Text("Самостоятельная").font(.footnote).foregroundStyle(.secondary) }
        }
        .padding(.vertical, 2)
    }

    private func fetch() async {
        switch await auth.trainings.teamTrainings(team.id) {
        case .success(let trainings): load = .loaded(trainings)
        case .failure(let error): if case .loaded = load {} else { load = .failed(error.message) }
        }
    }
}
