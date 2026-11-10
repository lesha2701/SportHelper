import SportArenaKit
import SwiftUI

/// The parts of a plan (разминка, основная часть, игровая, заминка) while the plan is still being created: the coach picks exercises for each
/// part right away, and they are saved together with the plan.
struct PlanDraftSections: View {
    @Binding var items: [PlanExerciseInput]
    let exercises: [Exercise]

    var body: some View {
        ForEach(PlanSection.allCases) { section in
            Section(sag: section.title) {
                ForEach(items.filter { $0.section == section }, id: \.exerciseId) { item in
                    HStack {
                        Text(exercises.first { $0.id == item.exerciseId }?.name ?? "Упражнение")
                        Spacer()
                        Button(role: .destructive) { items.removeAll { $0.exerciseId == item.exerciseId && $0.section == section } } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Убрать из плана")
                    }
                }
                menu(for: section)
            }
        }
    }

    @ViewBuilder private func menu(for section: PlanSection) -> some View {
        let free = exercises.filter { exercise in !items.contains { $0.exerciseId == exercise.id && $0.section == section } }
        if exercises.isEmpty {
            Text("В библиотеке пока нет упражнений — их можно будет добавить в план позже.").font(.footnote).foregroundStyle(.secondary)
        } else if !free.isEmpty {
            Menu {
                ForEach(free) { exercise in Button(exercise.name) { add(exercise, to: section) } }
            } label: {
                Label("Добавить упражнение", systemImage: "plus.circle")
            }
            .accessibilityIdentifier("planForm.add.\(section.rawValue)")
        }
    }

    private func add(_ exercise: Exercise, to section: PlanSection) {
        var value = PlanExerciseInput(exerciseId: exercise.id, section: section, orderIndex: items.filter { $0.section == section }.count)
        (value.sets, value.reps, value.durationSeconds, value.restSeconds) = (exercise.sets, exercise.reps, exercise.durationSeconds, exercise.restSeconds)
        items.append(value)
    }
}
