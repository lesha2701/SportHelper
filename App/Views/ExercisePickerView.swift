import SportArenaKit
import SwiftUI

/// Choosing the exercises of a task from the coach's library.
struct ExercisePickerView: View {
    let exercises: [Exercise]
    @Binding var selection: [UUID]

    var body: some View {
        List {
            if exercises.isEmpty { Text("В вашей библиотеке пока нет упражнений.").foregroundStyle(.secondary) }
            ForEach(exercises) { exercise in
                Button {
                    if let index = selection.firstIndex(of: exercise.id) {
                        selection.remove(at: index)
                    } else if selection.count < LibraryLimits.maxTemplateExercises {
                        selection.append(exercise.id)
                    }
                } label: {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(exercise.name).foregroundStyle(.primary)
                            Text(exercise.sport).font(.footnote).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if selection.contains(exercise.id) { Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.primary) }
                    }
                }
                .accessibilityIdentifier("picker.exercise")
                .accessibilityValue(selection.contains(exercise.id) ? "Выбрано" : "Не выбрано")
            }
            Section { Text("Не больше \(LibraryLimits.maxTemplateExercises) упражнений.").font(.footnote).foregroundStyle(.secondary) }
        }
        .sagScreen()
        .navigationTitle("Упражнения")
        .navigationBarTitleDisplayMode(.inline)
    }
}
