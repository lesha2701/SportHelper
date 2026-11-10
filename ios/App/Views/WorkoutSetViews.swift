import SportArenaKit
import SwiftUI

// MARK: - A set

/// One set: the numbers by the exercise's kind, and the button that marks it done.
struct SetRow: View {
    let runner: WorkoutRunner
    let index: Int
    let set: WorkoutSet
    let metric: WorkoutKind

    var body: some View {
        HStack(spacing: 8) {
            Text("\(index + 1)").font(.headline).foregroundStyle(.secondary).frame(width: 22)
            switch metric {
            case .reps: reps
            case .time: time
            case .distance: distance
            }
            Spacer(minLength: 0)
            doneButton
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(set.done ? Color.green.opacity(0.14) : Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("workout.set.\(index)")
    }

    private var reps: some View {
        HStack(spacing: 6) {
            StepButton(symbol: "minus", label: "Меньше повторений") { runner.change { $0.setReps(set.reps - 1, set: index) } }
            NumberCell(
                value: Double(set.reps), placeholder: "0", decimals: false, width: 48, label: "Повторения, подход \(index + 1)", identifier: "workout.reps.\(index)"
            ) { typed in
                runner.change { $0.setReps(Int(typed ?? 0), set: index) }
            }
            StepButton(symbol: "plus", label: "Больше повторений") { runner.change { $0.setReps(set.reps + 1, set: index) } }
            NumberCell(
                value: set.weightKg, placeholder: "кг", decimals: true, width: 56, label: "Вес, кг, подход \(index + 1)", identifier: "workout.weight.\(index)"
            ) { typed in
                runner.change { $0.setWeight(typed, set: index) }
            }
        }
    }

    private var time: some View {
        let running = runner.stopwatch?.set == index
        return HStack(spacing: 6) {
            StepButton(symbol: "minus", label: "Меньше времени") { runner.change { $0.stepSeconds(-1, set: index) } }.disabled(running)
            Group {
                if running, let from = runner.stopwatch?.from {
                    ElapsedClock(since: from).foregroundStyle(Theme.primary)
                } else {
                    Text(WorkoutFormat.clock(set.seconds ?? 0))
                }
            }
            .font(.title3.monospacedDigit()).frame(minWidth: 64)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Время, подход \(index + 1)")
            .accessibilityValue(running ? "идёт" : WorkoutFormat.clock(set.seconds ?? 0))
            .accessibilityIdentifier("workout.time.\(index)")
            StepButton(symbol: "plus", label: "Больше времени") { runner.change { $0.stepSeconds(1, set: index) } }.disabled(running)
            Button { runner.toggleStopwatch(set: index) } label: {
                Image(systemName: running ? "stop.fill" : "play.fill").frame(width: 38, height: 38)
                    .foregroundStyle(running ? Color.white : Theme.primary)
                    .background(running ? AnyShapeStyle(Theme.primary) : AnyShapeStyle(Theme.primary.opacity(0.15)), in: Circle())
            }
            .accessibilityLabel(running ? "Остановить секундомер" : "Запустить секундомер")
            .accessibilityIdentifier("workout.stopwatch.\(index)")
        }
    }

    private var distance: some View {
        HStack(spacing: 6) {
            StepButton(symbol: "minus", label: "Меньше") { runner.change { $0.stepMeters(-1, set: index) } }
            NumberCell(
                value: set.meters, placeholder: "м", decimals: true, width: 64, label: "Расстояние, м, подход \(index + 1)", identifier: "workout.meters.\(index)"
            ) { typed in
                runner.change { $0.setMeters(typed, set: index) }
            }
            StepButton(symbol: "plus", label: "Больше") { runner.change { $0.stepMeters(1, set: index) } }
            ClockCell(seconds: set.seconds, label: "Время, подход \(index + 1)", identifier: "workout.seconds.\(index)") { typed in
                runner.change { $0.setSeconds(typed, set: index) }
            }
        }
    }

    private var doneButton: some View {
        Button { runner.toggleDone(set: index) } label: {
            Image(systemName: set.done ? "checkmark.circle.fill" : "circle").font(.system(size: 30)).foregroundStyle(set.done ? Color.green : Color.secondary)
        }
        .accessibilityLabel(set.done ? "Подход \(index + 1) выполнен, отменить" : "Отметить подход \(index + 1) выполненным")
        .accessibilityAddTraits(set.done ? .isSelected : [])
        .accessibilityIdentifier("workout.done.\(index)")
    }
}

struct StepButton: View {
    let symbol: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.subheadline.weight(.bold)).frame(width: 32, height: 32)
                .background(Color(.tertiarySystemFill), in: Circle())
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(label)
    }
}

/// A number typed into a set; it is written back as it is typed and shows the stepped value when it is not being edited.
struct NumberCell: View {
    let value: Double?
    let placeholder: String
    let decimals: Bool
    let width: CGFloat
    let label: String
    let identifier: String
    let onChange: (Double?) -> Void

    @State private var text = ""
    @FocusState private var focused: Bool

    /// «3000» and «80,5»: no thousands separator, or the field could not be read back when edited.
    private func shown() -> String {
        value.map { $0.formatted(.number.grouping(.never).precision(.fractionLength(0...2)).locale(Locale(identifier: "ru_RU"))) } ?? ""
    }

    var body: some View {
        TextField(placeholder, text: $text)
            .keyboardType(decimals ? .decimalPad : .numberPad)
            .multilineTextAlignment(.center)
            .focused($focused)
            .frame(width: width, height: 36)
            .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 8))
            .accessibilityLabel(label)
            .accessibilityIdentifier(identifier)
            .onAppear { text = shown() }
            .onChange(of: value) { if !focused { text = shown() } }
            .onChange(of: focused) { if !focused { text = shown() } }
            .onChange(of: text) { _, new in
                guard focused else { return }
                onChange(LocalDateFormat.parseNumber(new.filter { !$0.isWhitespace }))
            }
    }
}

/// A time typed as «мин:сек» (or plain seconds); it is applied when the field is left, so typing is never fought.
struct ClockCell: View {
    let seconds: Int?
    let label: String
    let identifier: String
    let onChange: (Int?) -> Void

    @State private var text = ""
    @FocusState private var focused: Bool

    private func shown() -> String { seconds.map(WorkoutFormat.clock) ?? "" }

    var body: some View {
        TextField("м:сс", text: $text)
            .keyboardType(.numbersAndPunctuation)
            .multilineTextAlignment(.center)
            .focused($focused)
            .frame(width: 64, height: 36)
            .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 8))
            .accessibilityLabel(label)
            .accessibilityIdentifier(identifier)
            .onAppear { text = shown() }
            .onChange(of: seconds) { if !focused { text = shown() } }
            .onChange(of: focused) {
                guard !focused else { return }
                onChange(WorkoutFormat.parseClock(text))
                text = shown()
            }
    }
}

// MARK: - Clocks

/// The time since a moment, ticking twice a second (it is read from the clock, so a locked screen does not make it lose time).
struct ElapsedClock: View {
    let since: Date
    var until: Date?

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { context in
            Text(WorkoutFormat.clock(Int((until ?? context.date).timeIntervalSince(since))))
        }
    }
}

/// The seconds left until a moment.
struct CountdownClock: View {
    let until: Date

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { context in
            Text(WorkoutFormat.clock(Int(max(0, until.timeIntervalSince(context.date)).rounded(.up))))
        }
    }
}
