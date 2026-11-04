import SportArenaKit
import SwiftUI

/// Editing (or first filling in) the profile: a player's or a coach's, by the role the person registered with.
struct ProfileEditView: View {
    @Environment(\.dismiss) private var dismiss
    let user: AuthUser
    let store: ProfileStore
    let current: ProfileMe

    @State private var fullName: String
    @State private var sport: String
    @State private var level: String
    @State private var age: String
    @State private var height: String
    @State private var weight: String
    @State private var position: String
    @State private var goals: String
    @State private var restrictions: String
    @State private var experience: String
    @State private var specialization: String
    @State private var about: String
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(user: AuthUser, store: ProfileStore, current: ProfileMe) {
        self.user = user
        self.store = store
        self.current = current
        let player = current.player
        let coach = current.coach
        _fullName = State(initialValue: (user.isCoach ? coach?.fullName : player?.fullName) ?? user.fullName)
        _sport = State(initialValue: (user.isCoach ? coach?.sport : player?.sport) ?? "")
        _level = State(initialValue: player?.level ?? "")
        _age = State(initialValue: player?.age.map(String.init) ?? "")
        _height = State(initialValue: player?.heightCm.map(String.init) ?? "")
        _weight = State(initialValue: player?.weightKg.map { $0.formatted() } ?? "")
        _position = State(initialValue: player?.position ?? "")
        _goals = State(initialValue: player?.goals ?? "")
        _restrictions = State(initialValue: player?.loadRestrictions ?? "")
        _experience = State(initialValue: coach?.experienceYears.map(String.init) ?? "")
        _specialization = State(initialValue: coach?.specialization ?? "")
        _about = State(initialValue: coach?.description ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                if let errorMessage {
                    Section { Label(errorMessage, systemImage: "exclamationmark.triangle").foregroundStyle(.red).accessibilityIdentifier("edit.error") }
                }
                Section("Основное") {
                    TextField("Имя", text: $fullName).accessibilityIdentifier("edit.fullName")
                    Picker("Вид спорта", selection: $sport) {
                        if sport.isEmpty { Text("Выберите").tag("") }
                        ForEach(sportOptions, id: \.self) { Text($0).tag($0) }
                    }
                }
                if user.isCoach { coachFields } else { playerFields }
            }
            .navigationTitle("Профиль")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await save() } } label: {
                        if isSaving { ProgressView() } else { Text("Сохранить").bold() }
                    }
                    .disabled(isSaving)
                    .accessibilityIdentifier("edit.save")
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .interactiveDismissDisabled(isSaving)
        }
    }

    /// The common sports, plus the person's own value when an older record holds one that is not on the list.
    private var sportOptions: [String] {
        CommonSports.all + (sport.isEmpty || CommonSports.all.contains(sport) ? [] : [sport])
    }

    private var playerFields: some View {
        Group {
            Section("Спортсмен") {
                Picker("Уровень", selection: $level) {
                    Text("Не указан").tag("")
                    ForEach(SkillLevel.allCases) { Text($0.title).tag($0.rawValue) }
                }
                TextField("Позиция", text: $position)
                number("Возраст", text: $age, id: "edit.age")
                number("Рост, см", text: $height, id: "edit.height")
                number("Вес, кг", text: $weight, id: "edit.weight", decimal: true)
            }
            Section("Цель") {
                TextField("Чего вы хотите добиться", text: $goals, axis: .vertical)
                    .lineLimit(2...6).accessibilityIdentifier("edit.goals")
            }
            Section("Ограничения по нагрузке") {
                TextField("Травмы, противопоказания", text: $restrictions, axis: .vertical).lineLimit(2...6)
            }
        }
    }

    private var coachFields: some View {
        Group {
            Section("Тренер") {
                number("Опыт, лет", text: $experience, id: "edit.experience")
                TextField("Специализация", text: $specialization)
            }
            Section("О себе") {
                TextField("Расскажите о себе", text: $about, axis: .vertical).lineLimit(3...8).accessibilityIdentifier("edit.about")
            }
        }
    }

    private func number(_ title: String, text: Binding<String>, id: String, decimal: Bool = false) -> some View {
        LabeledContent(title) {
            TextField("—", text: text)
                .keyboardType(decimal ? .decimalPad : .numberPad)
                .multilineTextAlignment(.trailing)
                .accessibilityIdentifier(id)
        }
    }

    // MARK: saving

    private func save() async {
        errorMessage = nil
        isSaving = true
        defer { isSaving = false }
        do {
            let message = user.isCoach ? await store.save(coach: try coachInput()) : await store.save(player: try playerInput())
            if let message { errorMessage = message } else { dismiss() }
        } catch let problem as FormProblem {
            errorMessage = problem.message
        } catch {
            errorMessage = APIError.unknown.message
        }
    }

    private func playerInput() throws -> PlayerProfileInput {
        let input = PlayerProfileInput(
            fullName: fullName.trimmed, sport: sport,
            age: try wholeNumber(age, "Возраст — целое число."), heightCm: try wholeNumber(height, "Рост — целое число."),
            weightKg: try decimalNumber(weight, "Вес — число, например 72,5."),
            position: nilIfEmpty(position), level: nilIfEmpty(level), goals: nilIfEmpty(goals), loadRestrictions: nilIfEmpty(restrictions)
        )
        if let problem = input.problem { throw FormProblem(problem) }
        return input
    }

    private func coachInput() throws -> CoachProfileInput {
        let input = CoachProfileInput(
            fullName: fullName.trimmed, sport: sport, experienceYears: try wholeNumber(experience, "Опыт — целое число лет."),
            specialization: nilIfEmpty(specialization), description: nilIfEmpty(about)
        )
        if let problem = input.problem { throw FormProblem(problem) }
        return input
    }

    private func nilIfEmpty(_ text: String) -> String? {
        let value = text.trimmed
        return value.isEmpty ? nil : value
    }

    /// Empty is allowed (the field is optional); anything else must be a number.
    private func wholeNumber(_ text: String, _ problem: String) throws -> Int? {
        let value = text.trimmed
        if value.isEmpty { return nil }
        guard let number = Int(value) else { throw FormProblem(problem) }
        return number
    }

    private func decimalNumber(_ text: String, _ problem: String) throws -> Double? {
        let value = text.trimmed.replacingOccurrences(of: ",", with: ".")
        if value.isEmpty { return nil }
        guard let number = Double(value) else { throw FormProblem(problem) }
        return number
    }
}

private struct FormProblem: Error {
    let message: String
    init(_ message: String) { self.message = message }
}
