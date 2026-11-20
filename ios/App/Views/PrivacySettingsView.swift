import SportArenaKit
import SwiftUI

/// «Конфиденциальность»: the one choice there is — whether a personal coach may use the person's data for an AI analysis.
struct PrivacySettingsView: View {
    @Environment(AuthStore.self) private var auth

    @State private var settings = LoadState<PrivacySettings>.loading
    @State private var busy = false
    @State private var notice: String?
    @State private var error: String?
    @State private var blocked = LoadState<[BlockedUser]>.loading

    var body: some View {
        List {
            Section(sag: "AI-анализ") {
                switch settings {
                case .loading:
                    ProgressView().frame(maxWidth: .infinity)
                case .failed(let message):
                    Text(message).foregroundStyle(.red)
                    Button("Повторить") { Task { await load() } }
                case .loaded(let value):
                    Toggle(isOn: binding(value)) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("AI-анализ для личных тренеров").font(Theme.body(16, weight: .semibold))
                            Text(
                                "Разрешить тренерам, у которых с вами есть подтверждённая личная тренировка, "
                                    + "использовать ваши спортивные данные для AI-анализа и подготовки к занятию."
                            )
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    .disabled(busy)
                    .accessibilityIdentifier("privacy.ai")
                }
                if let notice { AuthNotice(kind: .success, text: notice).accessibilityIdentifier("privacy.notice") }
                if let error { Text(error).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("privacy.error") }
            } footer: {
                Text(
                    "Используются статистика, история тренировок, посещаемость, спортивные показатели, задачи и отчёты. "
                        + "Фото и видео из отчётов тренеру не открываются. По умолчанию выключено; при отключении уже подготовленные анализы удаляются."
                )
            }

            Section(sag: "Заблокированные") {
                switch blocked {
                case .loading:
                    ProgressView().frame(maxWidth: .infinity)
                case .failed(let message):
                    Text(message).foregroundStyle(.red)
                    Button("Повторить") { Task { await loadBlocked() } }
                case .loaded(let people):
                    if people.isEmpty {
                        Text("Вы никого не блокировали").foregroundStyle(.secondary).accessibilityIdentifier("privacy.blocked.empty")
                    }
                    ForEach(people) { person in
                        HStack {
                            Text(person.fullName)
                            Spacer()
                            Button("Разблокировать") { Task { await unblock(person) } }
                                .font(.subheadline).buttonStyle(.borderless).disabled(busy)
                                .accessibilityIdentifier("privacy.unblock")
                        }
                    }
                }
            } footer: {
                Text("Сообщения заблокированных людей скрыты в чатах, и переписываться с ними нельзя. Заблокировать автора можно, удерживая его сообщение в чате.")
            }
        }
        .sagScreen()
        .navigationTitle("Конфиденциальность")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load(); await loadBlocked() }
        .refreshable { await load(); await loadBlocked() }
    }

    private func binding(_ value: PrivacySettings) -> Binding<Bool> {
        Binding(get: { value.allowAiAnalysisByPersonalCoach }, set: { newValue in Task { await save(newValue) } })
    }

    private func load() async {
        do {
            settings = .loaded(try await auth.account.privacy())
        } catch let error as APIError {
            if settings.value == nil { settings = .failed(error.message) }
        } catch {
            if settings.value == nil { settings = .failed(APIError.unknown.message) }
        }
    }

    private func loadBlocked() async {
        do {
            blocked = .loaded(try await auth.blocks.blocked())
        } catch let error as APIError {
            if blocked.value == nil { blocked = .failed(error.message) }
        } catch {
            if blocked.value == nil { blocked = .failed(APIError.unknown.message) }
        }
    }

    private func unblock(_ person: BlockedUser) async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await auth.blocks.unblock(person.userId)
            blocked = .loaded((blocked.value ?? []).filter { $0.userId != person.userId })
        } catch let failure as APIError {
            error = failure.message
        } catch {
            self.error = APIError.unknown.message
        }
    }

    /// The switch shows what the server kept, not what was tapped: a failed save leaves it where it was.
    private func save(_ allowed: Bool) async {
        busy = true
        notice = nil
        error = nil
        defer { busy = false }
        do {
            let kept = try await auth.account.setAiAnalysisAllowed(allowed)
            settings = .loaded(kept)
            notice = kept.allowAiAnalysisByPersonalCoach ? "AI-анализ для личных тренеров разрешён" : "AI-анализ для личных тренеров отключён"
        } catch let failure as APIError {
            error = failure.message
        } catch {
            self.error = APIError.unknown.message
        }
    }
}
