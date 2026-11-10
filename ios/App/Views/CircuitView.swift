import SportArenaKit
import SwiftUI

/// A circuit done on the clock: each exercise for its time, a rest after it, round after round. Nothing is recorded: the clock is the plan.
struct CircuitView: View {
    @Environment(\.dismiss) private var dismiss
    let steps: [CircuitStep]

    @State private var index = 0
    @State private var endsAt = Date()
    @State private var pausedLeft: Int?
    @State private var now = Date()

    private var step: CircuitStep? { steps.indices.contains(index) ? steps[index] : nil }
    private var left: Int { pausedLeft ?? max(0, Int(endsAt.timeIntervalSince(now).rounded(.up))) }

    var body: some View {
        NavigationStack {
            Group {
                if let step { running(step) } else { finished }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.systemGroupedBackground))
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Завершить") { dismiss() }.accessibilityIdentifier("circuit.close")
                }
            }
            .navigationBarTitleDisplayMode(.inline)
        }
        .interactiveDismissDisabled()
        .sensoryFeedback(.impact, trigger: index)
        .task(id: index) { await run() }
    }

    /// Counts the step down by the clock (so a locked screen does not make it lose time) and moves on when it runs out.
    private func run() async {
        guard let step else { return }
        endsAt = Date().addingTimeInterval(Double(step.seconds))
        pausedLeft = nil
        now = Date()
        while !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(250))
            now = Date()
            if pausedLeft == nil && left == 0 {
                try? await Task.sleep(for: .milliseconds(400))
                if !Task.isCancelled { index += 1 }
                return
            }
        }
    }

    private func running(_ step: CircuitStep) -> some View {
        VStack(spacing: 18) {
            Spacer()
            switch step {
            case .exercise(let text, _, let round, let rounds, let position, let total):
                Text("Круг \(round) из \(rounds)").font(.subheadline).foregroundStyle(.secondary)
                Text("Упражнение \(position + 1) из \(total)").font(.footnote.weight(.semibold)).foregroundStyle(Theme.primary)
                Text(text).font(.largeTitle.bold()).multilineTextAlignment(.center).accessibilityIdentifier("circuit.exercise")
            case .rest(_, let round, let rounds):
                Text("Круг \(round) из \(rounds)").font(.subheadline).foregroundStyle(.secondary)
                Text("Отдых").font(.largeTitle.bold()).foregroundStyle(.green).accessibilityIdentifier("circuit.rest")
            }
            Text("\(left)").font(.system(size: 110, weight: .bold, design: .rounded).monospacedDigit())
                .foregroundStyle(isRest(step) ? Color.green : Color.primary)
                .accessibilityIdentifier("circuit.seconds")
            Spacer()
            HStack(spacing: 12) {
                Button { togglePause() } label: { Text(pausedLeft == nil ? "Пауза" : "Продолжить").frame(maxWidth: .infinity) }
                    .accessibilityIdentifier("circuit.pause")
                Button { index += 1 } label: { Text("Пропустить").frame(maxWidth: .infinity) }
                    .accessibilityIdentifier("circuit.skip")
            }
            .buttonStyle(.bordered).controlSize(.large)
            .padding(.horizontal, 16).padding(.bottom, 16)
        }
    }

    private func isRest(_ step: CircuitStep) -> Bool {
        if case .rest = step { return true }
        return false
    }

    private func togglePause() {
        if let paused = pausedLeft {
            endsAt = Date().addingTimeInterval(Double(paused))
            pausedLeft = nil
        } else {
            pausedLeft = left
        }
    }

    private var finished: some View {
        ContentUnavailableView {
            Label("Тренировка завершена!", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
        } actions: {
            Button("Готово") { dismiss() }.buttonStyle(.borderedProminent).tint(Theme.primary).accessibilityIdentifier("circuit.done")
        }
    }
}
