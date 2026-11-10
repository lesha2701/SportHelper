import SportArenaKit
import SwiftUI

/// The exercises and plans the coach opened to this team.
struct TeamLibraryView: View {
    @Environment(AuthStore.self) private var auth
    let team: Team
    @State private var showsPlans = false
    @State private var exercises: LoadState<[Exercise]> = .loading
    @State private var plans: LoadState<[Plan]> = .loading
    @State private var sharing = false

    var body: some View {
        VStack(spacing: 0) {
            Picker("Раздел", selection: $showsPlans) {
                Text("Упражнения").tag(false)
                Text("Планы").tag(true)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.bottom, 8)
            .accessibilityIdentifier("teamLibrary.section")
            if team.canManage {
                Button { sharing = true } label: {
                    Label(showsPlans ? "Открыть команде планы" : "Открыть команде упражнения", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(.sag)
                .padding(.horizontal).padding(.bottom, 8)
                .accessibilityIdentifier("teamLibrary.share")
            }
            if showsPlans {
                LoadStateView(state: plans, loading: "Загрузка планов…", failure: "Не удалось загрузить планы", retry: { Task { await fetch() } }) { items in
                    List {
                        if items.isEmpty { empty(forPlans: true) }
                        ForEach(items) { plan in
                            NavigationLink { PlanDetailView(planId: plan.id, readOnly: true) } label: { PlanRow(plan: plan) }
                                .accessibilityIdentifier("teamLibrary.row")
                        }
                    }
                    .refreshable { await fetch() }
                }
            } else {
                LoadStateView(state: exercises, loading: "Загрузка упражнений…", failure: "Не удалось загрузить упражнения", retry: { Task { await fetch() } }) { items in
                    List {
                        if items.isEmpty { empty(forPlans: false) }
                        ForEach(items) { exercise in
                            NavigationLink { ExerciseDetailView(exerciseId: exercise.id, readOnly: true) } label: { ExerciseRow(exercise: exercise) }
                                .accessibilityIdentifier("teamLibrary.row")
                        }
                    }
                    .refreshable { await fetch() }
                }
            }
        }
        .sagScreen()
        .navigationTitle("Упражнения и планы")
        .navigationBarTitleDisplayMode(.inline)
        .task { await fetch() }
        .sheet(isPresented: $sharing) {
            TeamLibraryShareSheet(team: team, plans: showsPlans) { Task { await fetch() } }
        }
    }

    private func empty(forPlans plans: Bool) -> some View {
        let coach = "Откройте команде свои \(plans ? "планы" : "упражнения") кнопкой выше."
        let player = "Тренер ещё не открыл команде ни одного \(plans ? "плана" : "упражнения")."
        return ContentUnavailableView(
            plans ? "Планов нет" : "Упражнений нет", systemImage: plans ? "list.bullet.clipboard" : "figure.strengthtraining.traditional",
            description: Text(team.canManage ? coach : player)
        )
        .listRowBackground(Color.clear)
    }

    private func fetch() async {
        switch await auth.library.teamExercises(team.id) {
        case .success(let items): exercises = .loaded(items)
        case .failure(let error): if exercises.value == nil { exercises = .failed(error.message) }
        }
        switch await auth.library.teamPlans(team.id) {
        case .success(let items): plans = .loaded(items)
        case .failure(let error): if plans.value == nil { plans = .failed(error.message) }
        }
    }
}
