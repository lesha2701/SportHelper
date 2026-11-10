import Foundation
import Observation
import SportArenaKit

/// A guided workout of a personal training that is being done: the sets being filled in, the rest between them, the stopwatch of a
/// timed set. The workout is kept on the device after every change, so a closed app or a locked phone never loses it.
@MainActor
@Observable
final class WorkoutRunner {
    enum Phase { case workout, summary, saved }

    let trainingId: UUID
    private(set) var phase = Phase.workout
    private(set) var finishedAt: Date?
    /// When the rest ends; nil when there is no rest going on.
    private(set) var restEndsAt: Date?
    /// The set whose stopwatch is running, and when it was started.
    private(set) var stopwatch: (set: Int, from: Date)?
    /// Counts the rests that ran out (the screen gives a tap of feedback for each).
    private(set) var restsOver = 0
    private(set) var saving = false
    var error: String?

    private(set) var session: WorkoutSession

    @ObservationIgnored private var restTask: Task<Void, Never>?
    @ObservationIgnored private let defaults: UserDefaults

    private static func key(_ id: UUID) -> String { "workout.draft.\(id.uuidString.lowercased())" }

    /// True when a workout of this training was started on this device and not finished or saved yet.
    static func hasDraft(for id: UUID, defaults: UserDefaults = .standard) -> Bool { defaults.data(forKey: key(id)) != nil }

    init(trainingId: UUID, planLines: [String], defaults: UserDefaults = .standard) {
        self.trainingId = trainingId
        self.defaults = defaults
        session = defaults.data(forKey: Self.key(trainingId)).flatMap { WorkoutSession.restored($0, planLineCount: planLines.count) }
            ?? WorkoutSession(planLines: planLines)
    }

    private func keep() {
        guard phase != .saved else { return }
        defaults.set(session.kept, forKey: Self.key(trainingId))
    }

    private func forget() { defaults.removeObject(forKey: Self.key(trainingId)) }

    /// Changes the workout (a field, a step, an added set).
    func change(_ edit: (inout WorkoutSession) -> Void) {
        var copy = session
        edit(&copy)
        session = copy
        keep()
    }

    // MARK: sets

    func toggleDone(set index: Int) {
        if stopwatch?.set == index { stopwatch = nil }
        var rests = false
        change { rests = $0.toggleDone(set: index) }
        if rests { startRest() } else { cancelRest() }
    }

    /// The first tap starts the stopwatch of a timed set, the second stops it, records the time and marks the set done.
    func toggleStopwatch(set index: Int, now: Date = Date()) {
        if let running = stopwatch, running.set == index {
            stopwatch = nil
            var rests = false
            change { rests = $0.finishTimed(set: index, seconds: Int(now.timeIntervalSince(running.from).rounded())) }
            if rests { startRest() }
        } else {
            cancelRest()
            stopwatch = (index, now)
        }
    }

    /// Moving to another exercise ends the rest and any stopwatch: they belonged to the exercise just left.
    func go(to index: Int) {
        cancelRest()
        stopwatch = nil
        change { $0.go(to: index) }
    }

    func goToNext() { go(to: session.activeIndex + 1) }

    // MARK: rest

    func startRest() { scheduleRest(until: Date().addingTimeInterval(Double(session.restSeconds))) }

    func extendRest(by seconds: Int = 15) {
        if let end = restEndsAt { scheduleRest(until: end.addingTimeInterval(Double(seconds))) }
    }

    func cancelRest() {
        restTask?.cancel()
        restEndsAt = nil
    }

    private func scheduleRest(until end: Date) {
        restTask?.cancel()
        restEndsAt = end
        restTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(max(0, end.timeIntervalSinceNow)))
            guard !Task.isCancelled, let self, self.restEndsAt == end else { return }
            self.restEndsAt = nil
            self.restsOver += 1
        }
    }

    // MARK: finishing

    func finish(now: Date = Date()) {
        cancelRest()
        stopwatch = nil
        finishedAt = now
        phase = .summary
    }

    func backToWorkout() {
        finishedAt = nil
        phase = .workout
    }

    /// Saves the results with the training. The workout stays on the device until it is saved.
    func save(using trainings: TrainingsStore) async -> TrainingWorkout? {
        saving = true
        error = nil
        defer { saving = false }
        switch await trainings.saveWorkout(of: trainingId, session.result(finishedAt: finishedAt ?? Date())) {
        case .success(let saved):
            phase = .saved
            forget()
            return saved
        case .failure(let failure):
            error = failure.message + " Результат остаётся на этом устройстве — попробуйте ещё раз."
            return nil
        }
    }

    /// Throws the workout away.
    func discard() {
        cancelRest()
        forget()
    }
}
